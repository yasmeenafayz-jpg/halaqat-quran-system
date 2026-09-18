import { requireAuth, requirePermission, json } from "./_auth.js";

import {
  awardPoints,
  getMotivationPoints,
} from "./_motivation.js";
import {
  evaluateAchievements,
  recordChallengeEvent,
} from "./_motivation-achievements.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const url = new URL(request.url);
  let circleId = url.searchParams.get("circle_id");
  const sessionId = url.searchParams.get("session_id");

  /*
   * Classroom requests the wird by session_id.
   * Sessions are linked to circles through sessions.circle_id.
   * Resolve the circle first, then use the existing weekly-wirds query.
   */
  if (!circleId && sessionId) {
    const session = await env.DB.prepare(`
      SELECT id, circle_id, circle_type
      FROM sessions
      WHERE id=?
      LIMIT 1
    `).bind(sessionId).first();

    if (!session) {
      return json({
        success: false,
        error: "SESSION_NOT_FOUND",
      }, 404);
    }

    if (
      !session.circle_id ||
      session.circle_type !== "group"
    ) {
      return json({
        success: true,
        wirds: [],
        tasks: [],
      });
    }

    circleId = String(session.circle_id);
  }

  let wirdSql = `
    SELECT *
    FROM weekly_wirds
    WHERE status IN ('active','completed')
  `;

  const params = [];

  if (circleId) {
    wirdSql += ` AND circle_id=?`;
    params.push(circleId);
  }

  wirdSql += `
    ORDER BY week_start_date DESC
    LIMIT 20
  `;

  const w = await env.DB.prepare(wirdSql)
    .bind(...params)
    .all();

  if (u.role !== "student") {
    return json({
      success: true,
      wirds: w.results || [],
    });
  }

  const studentCircles = await env.DB.prepare(`
    SELECT circle_id
    FROM circle_enrollments
    WHERE student_id=?
      AND status='active'
  `).bind(u.student_id).all();

  const allowedCircleIds = (studentCircles.results || [])
    .map(row => Number(row.circle_id))
    .filter(Number.isFinite);

  const visibleWirds = (w.results || []).filter(row =>
    allowedCircleIds.includes(Number(row.circle_id))
  );

  const t = await env.DB.prepare(`
    SELECT *
    FROM weekly_wird_daily_tasks
    WHERE student_id=?
    ORDER BY task_date DESC
    LIMIT 100
  `).bind(u.student_id).all();

  return json({
    success: true,
    wirds: visibleWirds,
    tasks: t.results || [],
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const b = await request.json().catch(() => ({}));

  if (b.action === "complete_task") {
    const selfPermission = await requirePermission(
      request,
      env,
      "wird.self.write"
    );

    if (!selfPermission.ok) return selfPermission.response;

    if (u.role !== "student") {
      return json({
        success: false,
        error: "FORBIDDEN",
      }, 403);
    }

    if (!b.task_id) {
      return json({
        success: false,
        error: "TASK_ID_REQUIRED",
      }, 400);
    }

    const result = await env.DB.prepare(`
      UPDATE weekly_wird_daily_tasks
      SET
        status='completed',
        quality_score=?,
        student_note=?,
        completed_at=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
        AND student_id=?
        AND status <> 'completed'
    `).bind(
      b.quality_score ?? null,
      b.student_note ?? null,
      new Date().toISOString(),
      b.task_id,
      u.student_id
    ).run();

    const changed =
      Number(result.meta?.changes || 0);

    let motivation = null;

    // النقاط تمنح فقط عند انتقال المهمة فعليًا إلى completed.
    if (changed > 0) {
      try {
        motivation = await awardPoints(
          env.DB,
          {
            studentId: Number(u.student_id),
            eventType: "wird_completion",
            sourceType: "wird_task",
            sourceId: Number(b.task_id),
            points:
              getMotivationPoints(
                "wird_completion"
              ),
            reason: "إكمال الورد اليومي",
            idempotencyKey:
              `wird_task:${b.task_id}:completed`,
            metadata: {
              task_id: Number(b.task_id),
              quality_score:
                b.quality_score ?? null,
            },
            awardedBy:
              Number(u.id),
          }
        );

        try {
          await evaluateAchievements(
            env.DB,
            Number(u.student_id),
            {
              sourceType: "wird_task",
              sourceId: Number(b.task_id),
            }
          );
        } catch (achievementError) {
          console.error(
            "WIRD_ACHIEVEMENT_ERROR",
            achievementError
          );
        }
      try {
        await recordChallengeEvent(
          env.DB,
          Number(u.student_id),
          {
            eventType: "wird_completion",
            value: 1,
            sourceType: "wird_task",
            sourceId: Number(b.task_id),
            idempotencyKey:
              `wird_task:${b.task_id}:completed:challenge`,
          }
        );
      } catch (challengeError) {
        console.error(
          "WIRD_CHALLENGE_ERROR",
          challengeError
        );
        }
      } catch {
        // فشل التشجيع لا يلغي إكمال الورد.
        motivation = null;
      }
    }

    return json({
      success: true,
      changed,
      ...(motivation
        ? {
            motivation: {
              points_added:
                motivation.created
                  ? motivation.event?.points || 0
                  : 0,
              duplicate:
                !!motivation.duplicate,
            },
          }
        : {}),
    });
  }

  const p = await requirePermission(request, env, "wird.write");
  if (!p.ok) return p.response;

  if (b.action === "create") {
    if (!b.circle_id || !b.week_start_date) {
      return json({
        success: false,
        error: "CIRCLE_AND_WEEK_REQUIRED",
      }, 400);
    }

    const circle = await env.DB.prepare(`
      SELECT id, teacher_id, status
      FROM circles
      WHERE id=?
      LIMIT 1
    `).bind(b.circle_id).first();

    if (!circle) {
      return json({
        success: false,
        error: "CIRCLE_NOT_FOUND",
      }, 404);
    }

    if (circle.status !== "active") {
      return json({
        success: false,
        error: "CIRCLE_IS_NOT_ACTIVE",
      }, 409);
    }

    if (
      u.role === "teacher" &&
      (
        !u.teacher_id ||
        Number(circle.teacher_id) !== Number(u.teacher_id)
      )
    ) {
      return json({
        success: false,
        error: "CIRCLE_ACCESS_DENIED",
      }, 403);
    }

    const r = await env.DB.prepare(`
      INSERT INTO weekly_wirds
      (
        circle_id,
        week_start_date,
        title,
        surah_number,
        surah_name,
        from_ayah,
        to_ayah,
        amount_label,
        amount_value,
        instructions,
        notes,
        status,
        created_by,
        updated_by
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(circle_id,week_start_date)
      DO UPDATE SET
        title=excluded.title,
        surah_number=excluded.surah_number,
        surah_name=excluded.surah_name,
        from_ayah=excluded.from_ayah,
        to_ayah=excluded.to_ayah,
        amount_label=excluded.amount_label,
        amount_value=excluded.amount_value,
        instructions=excluded.instructions,
        notes=excluded.notes,
        status='active',
        updated_by=excluded.updated_by,
        updated_at=CURRENT_TIMESTAMP
      RETURNING *
    `).bind(
      b.circle_id,
      b.week_start_date,
      b.title || "ورد الأسبوع",
      b.surah_number ?? null,
      b.surah_name ?? null,
      b.from_ayah ?? null,
      b.to_ayah ?? null,
      b.amount_label ?? null,
      b.amount_value ?? null,
      b.instructions ?? null,
      b.notes ?? null,
      "active",
      u.id,
      u.id
    ).first();

    return json({
      success: true,
      wird: r,
    }, 201);
  }

  if (b.action === "complete") {
    if (!b.id) {
      return json({
        success: false,
        error: "WIRD_ID_REQUIRED",
      }, 400);
    }

    let sql = `
      UPDATE weekly_wirds
      SET status='completed',
          updated_by=?,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
        AND status='active'
    `;

    const params = [u.id, b.id];

    if (u.role === "teacher") {
      sql += `
        AND circle_id IN (
          SELECT id
          FROM circles
          WHERE teacher_id=?
        )
      `;
      params.push(u.teacher_id);
    }

    const r = await env.DB.prepare(sql).bind(...params).run();

    return json({
      success: true,
      changed: r.meta?.changes || 0,
    });
  }

  return json({
    success: false,
    error: "UNKNOWN_ACTION",
  }, 400);
}
