import {
  requireAuth,
  json,
  badRequest,
  notFound
} from "./_auth.js";

function getDb(env) {
  if (!env?.DB) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }

  return env.DB;
}

function normalizeActivityType(value) {
  const allowed = [
    "new_memorization",
    "review",
    "memorization_review",
    "tamkeen",
    "cumulative_recitation"
  ];

  return allowed.includes(value) ? value : null;
}

function calculateAyahCount(fromAyah, toAyah) {
  if (
    Number.isInteger(fromAyah) &&
    Number.isInteger(toAyah) &&
    fromAyah > 0 &&
    toAyah >= fromAyah
  ) {
    return toAyah - fromAyah + 1;
  }

  return null;
}

export async function onRequestGet(context) {
  try {
    const auth = await requireAuth(context);
    const db = getDb(context.env);

    const url = new URL(context.request.url);

    const studentId =
      url.searchParams.get("student_id") ||
      auth.user?.student_id ||
      auth.user?.studentId;

    if (!studentId) {
      return badRequest("student_id is required");
    }

    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 50), 1),
      200
    );

    const offset = Math.max(
      Number(url.searchParams.get("offset") || 0),
      0
    );

    const activityType = url.searchParams.get("activity_type");

    const params = [Number(studentId)];
    let where = "student_id = ?";

    if (activityType) {
      const normalized = normalizeActivityType(activityType);

      if (!normalized) {
        return badRequest("Invalid activity_type");
      }

      where += " AND activity_type = ?";
      params.push(normalized);
    }

    const result = await db
      .prepare(
        `
        SELECT
          id,
          student_id,
          session_id,
          level_id,
          activity_type,
          surah_number,
          surah_name,
          from_ayah,
          to_ayah,
          amount_label,
          amount_value,
          quality_score,
          teacher_note,
          recorded_at
        FROM quran_progress
        WHERE ${where}
        ORDER BY recorded_at DESC, id DESC
        LIMIT ? OFFSET ?
        `
      )
      .bind(...params, limit, offset)
      .all();

    const summary = await db
      .prepare(
        `
        SELECT
          student_id,
          memorized_juz_count,
          cumulative_score,
          current_path_id,
          current_level_id,
          updated_at
        FROM student_progress_summary
        WHERE student_id = ?
        LIMIT 1
        `
      )
      .bind(Number(studentId))
      .first();

    return json({
      data: result.results || [],
      summary: summary || {
        student_id: Number(studentId),
        memorized_juz_count: 0,
        cumulative_score: 0,
        current_path_id: null,
        current_level_id: null,
        updated_at: null
      },
      pagination: {
        limit,
        offset,
        count: result.results?.length || 0
      }
    });
  } catch (error) {
    if (error?.status) {
      return json(
        {
          error: error.message || "Unauthorized"
        },
        error.status
      );
    }

    return json(
      {
        error: "Failed to load Quran progress",
        details: error?.message || "Unknown error"
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    const auth = await requireAuth(context);
    const db = getDb(context.env);

    const body = await context.request
      .json()
      .catch(() => null);

    if (!body || typeof body !== "object") {
      return badRequest("Invalid JSON body");
    }

    const studentId = Number(
      body.student_id ||
        auth.user?.student_id ||
        auth.user?.studentId
    );

    if (!Number.isInteger(studentId) || studentId <= 0) {
      return badRequest("Valid student_id is required");
    }

    const activityType = normalizeActivityType(
      body.activity_type
    );

    if (!activityType) {
      return badRequest("Invalid activity_type");
    }

    const surahNumber = Number(body.surah_number);

    if (
      !Number.isInteger(surahNumber) ||
      surahNumber < 1 ||
      surahNumber > 114
    ) {
      return badRequest("surah_number must be between 1 and 114");
    }

    const fromAyah =
      body.from_ayah == null
        ? null
        : Number(body.from_ayah);

    const toAyah =
      body.to_ayah == null
        ? null
        : Number(body.to_ayah);

    if (
      fromAyah !== null &&
      (!Number.isInteger(fromAyah) || fromAyah <= 0)
    ) {
      return badRequest("Invalid from_ayah");
    }

    if (
      toAyah !== null &&
      (!Number.isInteger(toAyah) || toAyah < fromAyah)
    ) {
      return badRequest("Invalid to_ayah");
    }

    const ayahCount = calculateAyahCount(
      fromAyah,
      toAyah
    );

    const amountValue =
      body.amount_value == null
        ? ayahCount
        : Number(body.amount_value);

    const qualityScore =
      body.quality_score == null
        ? null
        : Number(body.quality_score);

    if (
      qualityScore !== null &&
      (!Number.isFinite(qualityScore) ||
        qualityScore < 0 ||
        qualityScore > 100)
    ) {
      return badRequest(
        "quality_score must be between 0 and 100"
      );
    }

    const sessionId =
      body.session_id == null
        ? null
        : Number(body.session_id);

    const levelId =
      body.level_id == null
        ? null
        : Number(body.level_id);

    const result = await db
      .prepare(
        `
        INSERT INTO quran_progress (
          student_id,
          session_id,
          level_id,
          activity_type,
          surah_number,
          surah_name,
          from_ayah,
          to_ayah,
          amount_label,
          amount_value,
          quality_score,
          teacher_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        studentId,
        sessionId,
        levelId,
        activityType,
        surahNumber,
        body.surah_name || null,
        fromAyah,
        toAyah,
        body.amount_label || null,
        amountValue,
        qualityScore,
        body.teacher_note || null
      )
      .run();

    const insertedId = result.meta?.last_row_id;

    const progress = insertedId
      ? await db
          .prepare(
            `
            SELECT *
            FROM quran_progress
            WHERE id = ?
            LIMIT 1
            `
          )
          .bind(insertedId)
          .first()
      : null;

    return json(
      {
        success: true,
        data: progress,
        ayah_count: ayahCount
      },
      201
    );
  } catch (error) {
    if (error?.status) {
      return json(
        {
          error: error.message || "Unauthorized"
        },
        error.status
      );
    }

    return json(
      {
        error: "Failed to save Quran progress",
        details: error?.message || "Unknown error"
      },
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    await requireAuth(context);

    const db = getDb(context.env);
    const url = new URL(context.request.url);

    const id = Number(url.searchParams.get("id"));

    if (!Number.isInteger(id) || id <= 0) {
      return badRequest("Valid id is required");
    }

    const existing = await db
      .prepare(
        `
        SELECT id
        FROM quran_progress
        WHERE id = ?
        LIMIT 1
        `
      )
      .bind(id)
      .first();

    if (!existing) {
      return notFound("Quran progress record not found");
    }

    await db
      .prepare(
        `
        DELETE FROM quran_progress
        WHERE id = ?
        `
      )
      .bind(id)
      .run();

    return json({
      success: true,
      deleted_id: id
    });
  } catch (error) {
    if (error?.status) {
      return json(
        {
          error: error.message || "Unauthorized"
        },
        error.status
      );
    }

    return json(
      {
        error: "Failed to delete Quran progress",
        details: error?.message || "Unknown error"
      },
      500
    );
  }
}
