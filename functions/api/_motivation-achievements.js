import {
  awardPoints,
} from "./_motivation.js";

import {
  createNotification,
} from "./_notifications.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseCriteria(value) {
  if (!value) return {};

  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export async function evaluateAchievements(
  db,
  studentId,
  {
    sourceType = null,
    sourceId = null,
  } = {}
) {
  const id = toNumber(studentId);

  if (!id) {
    return [];
  }

  const definitions =
    await db
      .prepare(`
        SELECT *
        FROM achievement_definitions
        WHERE is_active = 1
        ORDER BY id ASC
      `)
      .all();

  const awarded = [];

  for (
    const definition of
      definitions?.results || []
  ) {
    const criteria =
      parseCriteria(
        definition.criteria_json
      );

    let qualifies = false;

    if (
      criteria.points !== undefined
    ) {
      const row =
        await db
          .prepare(`
            SELECT
              COALESCE(
                SUM(points),
                0
              ) AS points
            FROM student_point_events
            WHERE student_id = ?
          `)
          .bind(id)
          .first();

      qualifies =
        toNumber(row?.points) >=
        toNumber(criteria.points);
    }

    if (
      criteria.events !== undefined
    ) {
      const row =
        await db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM student_point_events
            WHERE student_id = ?
          `)
          .bind(id)
          .first();

      qualifies =
        toNumber(row?.count) >=
        toNumber(criteria.events);
    }

    if (
      criteria.event_type &&
      criteria.event_count !== undefined
    ) {
      const row =
        await db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM student_point_events
            WHERE student_id = ?
              AND event_type = ?
          `)
          .bind(
            id,
            String(
              criteria.event_type
            )
          )
          .first();

      qualifies =
        toNumber(row?.count) >=
        toNumber(
          criteria.event_count
        );
    }

    if (
      criteria.event_points !== undefined &&
      criteria.event_type
    ) {
      const row =
        await db
          .prepare(`
            SELECT
              COALESCE(
                SUM(points),
                0
              ) AS points
            FROM student_point_events
            WHERE student_id = ?
              AND event_type = ?
          `)
          .bind(
            id,
            String(
              criteria.event_type
            )
          )
          .first();

      qualifies =
        toNumber(row?.points) >=
        toNumber(
          criteria.event_points
        );
    }

    if (
      criteria.quran_progress_count !== undefined
    ) {
      const row =
        await db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM quran_progress
            WHERE student_id = ?
          `)
          .bind(id)
          .first();

      qualifies =
        toNumber(row?.count) >=
        toNumber(
          criteria.quran_progress_count
        );
    }

    if (!qualifies) {
      continue;
    }

    const exists =
      await db
        .prepare(`
          SELECT id
          FROM student_achievements
          WHERE student_id = ?
            AND achievement_id = ?
          LIMIT 1
        `)
        .bind(
          id,
          Number(definition.id)
        )
        .first();

    if (exists) {
      continue;
    }

    const inserted =
      await db
        .prepare(`
          INSERT OR IGNORE INTO
            student_achievements (
              student_id,
              achievement_id,
              awarded_at,
              awarded_by,
              notes
            )
          VALUES (
            ?,
            ?,
            CURRENT_TIMESTAMP,
            NULL,
            ?
          )
        `)
        .bind(
          id,
          Number(definition.id),
          sourceType
            ? `source:${sourceType}:${sourceId ?? ""}`
            : null
        )
        .run();

    if (
      Number(
        inserted?.meta?.changes || 0
      ) !== 1
    ) {
      continue;
    }

    awarded.push({
      id: Number(definition.id),
      code: definition.code,
      name: definition.name,
      icon: definition.icon || null,
    });

    try {
      const student =
        await db
          .prepare(`
            SELECT full_name
            FROM students
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

      const user =
        await db
          .prepare(`
            SELECT u.id
            FROM users u
            INNER JOIN students st
              ON st.user_id = u.id
            WHERE st.id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

      if (user?.id) {
        await createNotification(
          db,
          {
            userId:
              Number(user.id),
            studentId: id,
            type:
              "motivation.achievement",
            title:
              "إنجاز جديد 🎉",
            message:
              `مبارك ${student?.full_name || "لك"}! حصلت على شارة ${definition.icon || ""} ${definition.name}.`,
            channel:
              "in_app",
            priority:
              "normal",
            sourceType:
              "achievement",
            sourceId:
              Number(definition.id),
            dedupeKey:
              `achievement:${id}:${definition.id}`,
          }
        );
      }
    } catch (error) {
      console.error(
        "ACHIEVEMENT_NOTIFICATION_ERROR",
        error
      );
    }
  }

  return awarded;
}

async function isStudentEligibleForChallenge(
  db,
  studentId,
  challenge
) {
  const scopeType =
    String(challenge?.scope_type || "academy").trim();

  if (scopeType === "academy") {
    return true;
  }

  if (scopeType === "circle") {
    const circleId =
      Number(challenge?.circle_id);

    if (!Number.isInteger(circleId) || circleId <= 0) {
      return false;
    }

    const membership =
      await db
        .prepare(`
          SELECT 1
          FROM circle_enrollments
          WHERE circle_id = ?
            AND student_id = ?
            AND status = 'active'
          LIMIT 1
        `)
        .bind(
          circleId,
          Number(studentId)
        )
        .first();

    return Boolean(membership);
  }

  return false;
}

export async function joinChallenge(
  db,
  studentId,
  challengeId
) {
  const student =
    toNumber(studentId);

  const challenge =
    toNumber(challengeId);

  if (!student || !challenge) {
    throw new Error(
      "INVALID_CHALLENGE"
    );
  }

  const row =
    await db
      .prepare(`
        SELECT *
        FROM motivation_challenges
        WHERE id = ?
          AND status = 'active'
          AND date('now') BETWEEN
              date(start_date)
              AND date(end_date)
        LIMIT 1
      `)
      .bind(challenge)
      .first();

  if (!row) {
    throw new Error(
      "CHALLENGE_NOT_AVAILABLE"
    );
  }

  const eligible =
    await isStudentEligibleForChallenge(
      db,
      student,
      row
    );

  if (!eligible) {
    throw new Error(
      "CHALLENGE_NOT_ELIGIBLE"
    );
  }

  const existing =
    await db
      .prepare(`
        SELECT *
        FROM motivation_challenge_participants
        WHERE challenge_id = ?
          AND student_id = ?
        LIMIT 1
      `)
      .bind(
        challenge,
        student
      )
      .first();

  if (existing) {
    /*
     * إصلاح المشاركات القديمة التي أُنشئت قبل حفظ
     * مكافأة التحدي داخل سجل المشاركة.
     *
     * لا نغيّر مكافأة موجودة مسبقًا.
     * نصلح فقط السجل الذي ما زالت مكافأته صفرًا.
     */
    if (
      Number(existing.reward_points || 0) <= 0 &&
      Number(row.reward_points || 0) > 0
    ) {
      await db
        .prepare(`
          UPDATE motivation_challenge_participants
          SET reward_points = ?
          WHERE id = ?
            AND reward_points = 0
        `)
        .bind(
          Math.max(
            0,
            toNumber(row.reward_points)
          ),
          Number(existing.id)
        )
        .run();

      return await db
        .prepare(`
          SELECT *
          FROM motivation_challenge_participants
          WHERE id = ?
          LIMIT 1
        `)
        .bind(Number(existing.id))
        .first();
    }

    return existing;
  }

  const challengeReward =
    Math.max(
      0,
      toNumber(row.reward_points)
    );

  await db
    .prepare(`
      INSERT INTO
        motivation_challenge_participants (
          challenge_id,
          student_id,
          joined_at,
          progress_value,
          status,
          reward_points
        )
      VALUES (
        ?,
        ?,
        CURRENT_TIMESTAMP,
        0,
        'active',
        ?
      )
    `)
    .bind(
      challenge,
      student,
      challengeReward
    )
    .run();

  return await db
    .prepare(`
      SELECT *
      FROM motivation_challenge_participants
      WHERE challenge_id = ?
        AND student_id = ?
      LIMIT 1
    `)
    .bind(
      challenge,
      student
    )
    .first();
}


/*
 * تحديث تقدم التحديات من أحداث حقيقية فقط.
 *
 * لا تستقبل هذه الدالة progress_value من المستخدم.
 * التقدم يأتي من:
 * - الحضور
 * - الورد
 * - نشاط القرآن
 * - الاختبار
 * - متابعة الرفيقة
 *
 * challenge_type = custom لا يتم تحديثه تلقائيًا.
 */
export async function recordChallengeEvent(
  db,
  studentId,
  {
    eventType,
    activityType = null,
    value = 1,
    sourceType = null,
    sourceId = null,
    idempotencyKey = null,
  } = {}
) {
  const student = toNumber(studentId);

  if (!student || student <= 0) {
    return {
      updated: 0,
      completed: 0,
    };
  }

  const event =
    String(eventType || "").trim();

  const activity =
    String(activityType || "").trim();

  const numericValue =
    Math.max(
      0,
      toNumber(value)
    );

  if (!event || numericValue <= 0) {
    return {
      updated: 0,
      completed: 0,
    };
  }

  let challengeTypes = [];

  if (event === "attendance") {
    challengeTypes = [
      "attendance",
      "consistency",
    ];
  } else if (event === "wird_completion") {
    challengeTypes = ["wird"];
  } else if (event === "buddy_followup") {
    challengeTypes = ["buddy"];
  } else if (event === "test") {
    challengeTypes = ["test"];
  } else if (event === "quran_progress") {
    challengeTypes = ["progress"];

    if (
      activity === "new_memorization" ||
      activity === "memorization_review" ||
      activity === "tamkeen" ||
      activity === "cumulative_recitation"
    ) {
      challengeTypes.push("memorization");
    }

    if (activity === "review") {
      challengeTypes.push("review");
    }
  }

  if (!challengeTypes.length) {
    return {
      updated: 0,
      completed: 0,
    };
  }

  const placeholders =
    challengeTypes
      .map(() => "?")
      .join(", ");

  const result =
    await db
      .prepare(`
        SELECT
          p.id AS participant_id,
          p.challenge_id,
          p.progress_value,
          p.reward_points,
          p.status,
          c.title,
          c.target_value,
          c.reward_points AS challenge_reward_points
        FROM motivation_challenge_participants p
        INNER JOIN motivation_challenges c
          ON c.id = p.challenge_id
        WHERE p.student_id = ?
          AND p.status = 'active'
          AND c.status = 'active'
          AND date('now') BETWEEN
              date(c.start_date)
              AND date(c.end_date)
          AND c.challenge_type IN (${placeholders})
        ORDER BY p.challenge_id ASC
      `)
      .bind(
        student,
        ...challengeTypes
      )
      .all();

  const participants =
    result?.results || [];

  let updated = 0;
  let completed = 0;

  const baseKey =
    String(
      idempotencyKey ||
      (
        sourceId !== null &&
        sourceId !== undefined
          ? `challenge_event:${student}:${sourceType || event}:${sourceId}:${event}:${activity || "none"}`
          : `challenge_event:${student}:${event}:${activity || "none"}`
      )
    );

  for (const row of participants) {
    const challengeEventKey =
      `${baseKey}:challenge:${Number(row.challenge_id)}`;

    try {
      /*
       * FINAL ATOMIC CHALLENGE EVENT PROCESSING
       *
       * The progress update and event ledger insert happen
       * inside the same D1 batch.
       *
       * Completion is determined inside that same UPDATE,
       * so we do NOT call updateChallengeProgress() again.
       *
       * This prevents:
       * - duplicate progress
       * - consuming an idempotency key before progress
       * - completion races between the batch and a second UPDATE
       */

      const participantId =
        Number(row.participant_id);

      const rewardPoints =
        Math.max(
          0,
          toNumber(
            row.reward_points ??
            row.challenge_reward_points
          )
        );

      const updateStatement =
        db
          .prepare(`
            UPDATE motivation_challenge_participants
            SET
              progress_value =
                progress_value + ?,
              status = CASE
                WHEN progress_value + ? >= target_value
                  THEN 'completed'
                ELSE 'active'
              END,
              completed_at = CASE
                WHEN progress_value + ? >= target_value
                  AND completed_at IS NULL
                  THEN CURRENT_TIMESTAMP
                ELSE completed_at
              END,
              reward_points = CASE
                WHEN progress_value + ? >= target_value
                  THEN COALESCE(reward_points, ?, 0)
                ELSE COALESCE(reward_points, 0)
              END
            WHERE id = ?
              AND status = 'active'
              AND NOT EXISTS (
                SELECT 1
                FROM motivation_challenge_events
                WHERE challenge_id = ?
                  AND idempotency_key = ?
              )
          `)
          .bind(
            numericValue,
            numericValue,
            numericValue,
            numericValue,
            rewardPoints,
            participantId,
            Number(row.challenge_id),
            challengeEventKey
          );

      const ledgerStatement =
        db
          .prepare(`
            INSERT OR IGNORE INTO motivation_challenge_events (
              challenge_id,
              student_id,
              event_type,
              source_type,
              source_id,
              idempotency_key,
              value
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            Number(row.challenge_id),
            student,
            event,
            String(sourceType || event),
            sourceId === null ||
            sourceId === undefined
              ? null
              : toNumber(sourceId),
            challengeEventKey,
            numericValue
          );

      const batchResults =
        await db.batch([
          updateStatement,
          ledgerStatement,
        ]);

      const progressChanges =
        Number(
          batchResults?.[0]?.meta?.changes || 0
        );

      const ledgerChanges =
        Number(
          batchResults?.[1]?.meta?.changes || 0
        );

      /*
       * Both operations must succeed.
       *
       * If the event already exists, the guarded UPDATE
       * changes zero rows and the event is ignored.
       */
      if (
        progressChanges !== 1 ||
        ledgerChanges !== 1
      ) {
        continue;
      }

      updated += 1;

      const completedNow =
        progressChanges === 1 &&
        Number(row.target_value || 0) > 0 &&
        (
          Number(row.progress_value || 0) +
          numericValue
        ) >= Number(row.target_value);

      if (completedNow) {
        completed += 1;

        /*
         * Award points only after the atomic progress + ledger
         * transaction has succeeded.
         *
         * awardPoints() already has its own idempotency key,
         * so retries cannot award the completion reward twice.
         */
        if (rewardPoints > 0) {
          await awardPoints(
            db,
            {
              studentId:
                student,
              eventType:
                "challenge",
              sourceType:
                "motivation_challenge",
              sourceId:
                Number(row.challenge_id),
              points:
                rewardPoints,
              reason:
                `إتمام التحدي: ${row.title || ""}`,
              idempotencyKey:
                `challenge:${Number(row.challenge_id)}:${student}:completed`,
              metadata: {
                challenge_id:
                  Number(row.challenge_id),
                title:
                  row.title || null,
              },
            }
          );
        }

        /*
         * Completion notification is also deduplicated.
         */
        try {
          const user =
            await db
              .prepare(`
                SELECT u.id
                FROM users u
                INNER JOIN students st
                  ON st.user_id = u.id
                WHERE st.id = ?
                LIMIT 1
              `)
              .bind(student)
              .first();

          if (user?.id) {
            await createNotification(
              db,
              {
                userId:
                  Number(user.id),
                studentId:
                  student,
                type:
                  "motivation.challenge",
                title:
                  "أتممت التحدي 🏆",
                message:
                  `مبارك! أتممت تحدي ${row.title || ""}.`,
                channel:
                  "in_app",
                priority:
                  "normal",
                sourceType:
                  "motivation_challenge",
                sourceId:
                  Number(row.challenge_id),
                dedupeKey:
                  `challenge-notification:${Number(row.challenge_id)}:${student}:completed`,
              }
            );
          }
        } catch (error) {
          console.error(
            "CHALLENGE_NOTIFICATION_ERROR",
            error
          );
        }
      }
    } catch (error) {
      console.error(
        "RECORD_CHALLENGE_EVENT_ERROR",
        {
          studentId: student,
          challengeId:
            Number(row.challenge_id),
          eventType: event,
          error,
        }
      );
    }
  }

  return {
    updated,
    completed,
  };
}


export async function updateChallengeProgress(
  db,
  studentId,
  {
    challengeId,
    progressValue,
  } = {}
) {
  const student =
    toNumber(studentId);

  const challenge =
    toNumber(challengeId);

  const progress =
    Math.max(
      0,
      toNumber(progressValue)
    );

  const participant =
    await db
      .prepare(`
        SELECT
          p.*,
          c.title,
          c.target_value,
          c.reward_points
        FROM motivation_challenge_participants p
        INNER JOIN motivation_challenges c
          ON c.id = p.challenge_id
        WHERE p.challenge_id = ?
          AND p.student_id = ?
          AND p.status = 'active'
        LIMIT 1
      `)
      .bind(
        challenge,
        student
      )
      .first();

  if (!participant) {
    throw new Error(
      "CHALLENGE_NOT_JOINED"
    );
  }

  const target =
    toNumber(
      participant.target_value
    );

  const completed =
    target > 0 &&
    progress >= target;

  await db
    .prepare(`
      UPDATE motivation_challenge_participants
      SET
        progress_value = ?,
        status = ?,
        completed_at = ?,
        reward_points = ?
      WHERE id = ?
    `)
    .bind(
      progress,
      completed
        ? "completed"
        : "active",
      completed
        ? new Date().toISOString()
        : null,
      completed
        ? Math.max(
            0,
            toNumber(
              participant.reward_points
            )
          )
        : 0,
      Number(participant.id)
    )
    .run();

  if (completed) {
    const reward =
      Math.max(
        0,
        toNumber(
          participant.reward_points
        )
      );

    if (reward > 0) {
      await awardPoints(
        db,
        {
          studentId:
            student,
          eventType:
            "challenge",
          sourceType:
            "motivation_challenge",
          sourceId:
            challenge,
          points:
            reward,
          reason:
            `إتمام التحدي: ${participant.title}`,
          idempotencyKey:
            `challenge:${challenge}:${student}:completed`,
          metadata: {
            challenge_id:
              challenge,
            title:
              participant.title,
          },
        }
      );
    }

    try {
      const user =
        await db
          .prepare(`
            SELECT u.id
            FROM users u
            INNER JOIN students st
              ON st.user_id = u.id
            WHERE st.id = ?
            LIMIT 1
          `)
          .bind(student)
          .first();

      if (user?.id) {
        await createNotification(
          db,
          {
            userId:
              Number(user.id),
            studentId:
              student,
            type:
              "motivation.challenge",
            title:
              "أتممت التحدي 🏆",
            message:
              `مبارك! أتممت تحدي ${participant.title}.`,
            channel:
              "in_app",
            priority:
              "normal",
            sourceType:
              "motivation_challenge",
            sourceId:
              challenge,
            dedupeKey:
              `challenge-notification:${challenge}:${student}:completed`,
          }
        );
      }
    } catch (error) {
      console.error(
        "CHALLENGE_NOTIFICATION_ERROR",
        error
      );
    }
  }

  return await db
    .prepare(`
      SELECT *
      FROM motivation_challenge_participants
      WHERE id = ?
      LIMIT 1
    `)
    .bind(
      Number(participant.id)
    )
    .first();
}
