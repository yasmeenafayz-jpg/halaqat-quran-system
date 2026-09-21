import { writeAudit } from "./_auth.js";

const MAX_EVENT_POINTS = 1000;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function safePoints(value) {
  const points = Number(value);

  if (!Number.isFinite(points) || points === 0) {
    throw new Error("INVALID_POINTS");
  }

  if (Math.abs(points) > MAX_EVENT_POINTS) {
    throw new Error("POINTS_LIMIT_EXCEEDED");
  }

  return Math.round(points * 100) / 100;
}

function safeJson(value) {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    JSON.parse(value);
    return value;
  }

  return JSON.stringify(value);
}

/**
 * إضافة حدث نقاط بشكل idempotent.
 *
 * المبدأ:
 * - لا نعدل الرصيد مباشرة.
 * - كل تغيير يسجل كحدث مستقل.
 * - idempotency_key يمنع التكرار.
 * - التصحيح يكون بحدث عكسي بدل حذف الحدث الأصلي.
 */

/**
 * قواعد نقاط التحفيز المركزية.
 *
 * مبدأ التصميم:
 * - كل قواعد احتساب النقاط في مكان واحد.
 * - الوحدات الأخرى تطلب القاعدة ولا تحمل أرقامًا مستقلة.
 * - هذه النقاط تحفيزية وليست درجات تقييم أكاديمي.
 * - الحد النهائي لكل حدث يظل محكومًا بـ safePoints().
 */
const MOTIVATION_RULES = Object.freeze({
  quran_progress: Object.freeze({
    new_memorization: 5,
    review: 3,
    memorization_review: 6,
    tamkeen: 5,
    cumulative_recitation: 4,
    default: 2,
  }),

  wird_completion: 3,

  buddy_followup: 2,

  attendance: Object.freeze({
    present: 2,
    punctual: 1,
    consistent: 2,
  }),

  test: Object.freeze({
    completed: 3,
    excellent: 5,
  }),
});

function getMotivationPoints(
  eventType,
  options = {}
) {
  const type = clean(eventType);

  if (!type) {
    throw new Error("EVENT_TYPE_REQUIRED");
  }

  if (type === "quran_progress") {
    const activityType =
      clean(options.activityType) || "default";

    const basePoints =
      MOTIVATION_RULES.quran_progress[
        activityType
      ] ??
      MOTIVATION_RULES.quran_progress.default;

    const rawAyahCount =
      Number(options.ayahCount);

    const ayahCount =
      Number.isInteger(rawAyahCount) &&
      rawAyahCount > 0
        ? Math.min(rawAyahCount, 50)
        : 1;

    const ayahBonus =
      Math.min(
        Math.floor(ayahCount / 5),
        10
      );

    return Math.min(
      basePoints + ayahBonus,
      20
    );
  }

  if (type === "wird_completion") {
    return MOTIVATION_RULES.wird_completion;
  }

  if (type === "buddy_followup") {
    return MOTIVATION_RULES.buddy_followup;
  }

  if (type === "attendance") {
    const attendanceType =
      clean(options.attendanceType) ||
      "present";

    return (
      MOTIVATION_RULES.attendance[
        attendanceType
      ] ?? 0
    );
  }

  if (type === "test") {
    const testType =
      clean(options.testType) ||
      "completed";

    return (
      MOTIVATION_RULES.test[
        testType
      ] ?? MOTIVATION_RULES.test.completed
    );
  }

  throw new Error(
    "UNKNOWN_MOTIVATION_EVENT_TYPE"
  );
}

async function awardPoints(
  db,
  {
    studentId,
    eventType,
    sourceType = null,
    sourceId = null,
    points,
    reason,
    idempotencyKey,
    metadata = null,
    awardedBy = null,
  }
) {
  if (!studentId) throw new Error("STUDENT_REQUIRED");
  if (!eventType) throw new Error("EVENT_TYPE_REQUIRED");
  if (!reason) throw new Error("POINT_REASON_REQUIRED");
  if (!idempotencyKey) throw new Error("IDEMPOTENCY_KEY_REQUIRED");

  const normalizedPoints = safePoints(points);
  const normalizedKey = clean(idempotencyKey);

  if (!normalizedKey) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }

  if (normalizedKey.length > 180) {
    throw new Error("IDEMPOTENCY_KEY_TOO_LONG");
  }

  const existing = await db
    .prepare(`
      SELECT
        id,
        student_id,
        event_type,
        source_type,
        source_id,
        points,
        reason,
        idempotency_key,
        awarded_at
      FROM student_point_events
      WHERE idempotency_key = ?
      LIMIT 1
    `)
    .bind(normalizedKey)
    .first();

  if (existing) {
    return {
      created: false,
      duplicate: true,
      event: existing,
    };
  }

  const metadataJson = safeJson(metadata);

  let result;

  try {
    result = await db
      .prepare(`
        INSERT INTO student_point_events (
          student_id,
          event_type,
          source_type,
          source_id,
          points,
          reason,
          idempotency_key,
          metadata_json,
          awarded_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        Number(studentId),
        clean(eventType),
        clean(sourceType),
        sourceId === null || sourceId === undefined
          ? null
          : Number(sourceId),
        normalizedPoints,
        clean(reason),
        normalizedKey,
        metadataJson,
        awardedBy ? Number(awardedBy) : null
      )
      .run();
  } catch (error) {
    /*
     * في حالة وصول طلبين متزامنين بنفس idempotency_key:
     * - الطلب الأول ينجح.
     * - UNIQUE constraint يمنع الطلب الثاني.
     * - نعيد الحدث الموجود بدل تحويل العملية إلى خطأ.
     */
    const message = String(error?.message || "").toLowerCase();

    if (
      message.includes("unique") &&
      message.includes("idempotency")
    ) {
      const duplicate = await db
        .prepare(`
          SELECT
            id,
            student_id,
            event_type,
            source_type,
            source_id,
            points,
            reason,
            idempotency_key,
            metadata_json,
            awarded_by,
            awarded_at
          FROM student_point_events
          WHERE idempotency_key = ?
          LIMIT 1
        `)
        .bind(normalizedKey)
        .first();

      if (duplicate) {
        return {
          created: false,
          duplicate: true,
          event: duplicate,
        };
      }
    }

    throw error;
  }

  const eventId = result.meta?.last_row_id;

  if (awardedBy) {
    try {
      await writeAudit(db, {
        userId: Number(awardedBy),
        action: "motivation.points.awarded",
        entityType: "student_point_event",
        entityId: eventId || null,
        metadata: {
          student_id: Number(studentId),
          event_type: eventType,
          source_type: sourceType,
          source_id: sourceId,
          points: normalizedPoints,
          idempotency_key: normalizedKey,
        },
      });
    } catch {
      // فشل سجل التدقيق لا يلغي عملية النقاط
    }
  }

  const event = await db
    .prepare(`
      SELECT
        id,
        student_id,
        event_type,
        source_type,
        source_id,
        points,
        reason,
        idempotency_key,
        metadata_json,
        awarded_by,
        awarded_at
      FROM student_point_events
      WHERE id = ?
      LIMIT 1
    `)
    .bind(eventId)
    .first();

  return {
    created: true,
    duplicate: false,
    event,
  };
}

async function getStudentPoints(db, studentId) {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(SUM(points), 0) AS total_points,
        COUNT(*) AS event_count
      FROM student_point_events
      WHERE student_id = ?
    `)
    .bind(Number(studentId))
    .first();

  return {
    totalPoints: Number(row?.total_points || 0),
    eventCount: Number(row?.event_count || 0),
  };
}

async function getStudentLevel(db, totalPoints) {
  const level = await db
    .prepare(`
      SELECT
        id,
        code,
        name,
        description,
        min_points,
        icon,
        sort_order
      FROM motivation_levels
      WHERE is_active = 1
        AND min_points <= ?
      ORDER BY min_points DESC, sort_order DESC
      LIMIT 1
    `)
    .bind(Number(totalPoints))
    .first();

  return level || null;
}

async function getStudentMotivationSummary(db, studentId) {
  const points = await getStudentPoints(db, studentId);
  const level = await getStudentLevel(db, points.totalPoints);

  const nextLevel = await db
    .prepare(`
      SELECT
        id,
        code,
        name,
        description,
        min_points,
        icon,
        sort_order
      FROM motivation_levels
      WHERE is_active = 1
        AND min_points > ?
      ORDER BY min_points ASC, sort_order ASC
      LIMIT 1
    `)
    .bind(points.totalPoints)
    .first();

  const achievements = await db
    .prepare(`
      SELECT
        sa.id,
        sa.achievement_id,
        ad.code,
        ad.name,
        ad.description,
        ad.achievement_type,
        ad.icon,
        sa.awarded_at,
        sa.awarded_by,
        sa.notes
      FROM student_achievements sa
      INNER JOIN achievement_definitions ad
        ON ad.id = sa.achievement_id
      WHERE sa.student_id = ?
      ORDER BY sa.awarded_at DESC, sa.id DESC
    `)
    .bind(Number(studentId))
    .all();

  const recentEvents = await db
    .prepare(`
      SELECT
        id,
        event_type,
        source_type,
        source_id,
        points,
        reason,
        awarded_at
      FROM student_point_events
      WHERE student_id = ?
      ORDER BY awarded_at DESC, id DESC
      LIMIT 20
    `)
    .bind(Number(studentId))
    .all();

  return {
    studentId: Number(studentId),
    points,
    level,
    nextLevel: nextLevel || null,
    achievements: achievements.results || [],
    recentEvents: recentEvents.results || [],
  };
}

function motivationErrorMessage(error) {
  const messages = {
    STUDENT_REQUIRED: "الطالب مطلوب.",
    EVENT_TYPE_REQUIRED: "نوع حدث النقاط مطلوب.",
    POINT_REASON_REQUIRED: "سبب النقاط مطلوب.",
    IDEMPOTENCY_KEY_REQUIRED: "مفتاح منع التكرار مطلوب.",
    IDEMPOTENCY_KEY_TOO_LONG: "مفتاح منع التكرار طويل جدًا.",
    INVALID_POINTS: "قيمة النقاط غير صحيحة.",
    POINTS_LIMIT_EXCEEDED: "قيمة النقاط تتجاوز الحد المسموح.",
  };

  return messages[error?.message] || "تعذر تنفيذ عملية التشجيع.";
}

export {
  MOTIVATION_RULES,
  getMotivationPoints,
  awardPoints,
  getStudentPoints,
  getStudentLevel,
  getStudentMotivationSummary,
  motivationErrorMessage,
  MAX_EVENT_POINTS,
};
