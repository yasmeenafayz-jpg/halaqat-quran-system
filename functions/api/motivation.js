import {
  getStudentMotivationSummary,
  motivationErrorMessage,
} from "./_motivation.js";

import { requirePermission } from "./_auth.js";
import { joinChallenge } from "./_motivation-achievements.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

async function getStudentForUser(db, user) {
  if (!user) return null;

  if (user.student_id) {
    return Number(user.student_id);
  }

  if (user.role === "student" && user.id) {
    const row = await db
      .prepare(`
        SELECT id
        FROM students
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(Number(user.id))
      .first();

    return row?.id ? Number(row.id) : null;
  }

  return null;
}

async function getSummary(db, studentId) {
  const summary = await getStudentMotivationSummary(
    db,
    Number(studentId)
  );

  const eventTotals = await db
    .prepare(`
      SELECT
        event_type,
        ROUND(COALESCE(SUM(points), 0), 2) AS points,
        COUNT(*) AS events
      FROM student_point_events
      WHERE student_id = ?
      GROUP BY event_type
      ORDER BY points DESC
    `)
    .bind(Number(studentId))
    .all();

  const activeChallenges = await db
    .prepare(`
      SELECT
        c.id,
        c.code,
        c.title,
        c.description,
        c.challenge_type,
        c.scope_type,
        c.start_date,
        c.end_date,
        c.target_value,
        c.reward_points,
        p.progress_value,
        p.status AS participant_status,
        p.joined_at,
        p.completed_at
      FROM motivation_challenges c
      INNER JOIN motivation_challenge_participants p
        ON p.challenge_id = c.id
      WHERE p.student_id = ?
        AND c.status = 'active'
        AND p.status = 'active'
      ORDER BY c.end_date ASC, c.id ASC
      LIMIT 20
    `)
    .bind(Number(studentId))
    .all();

  const availableChallenges = await db
    .prepare(`
      SELECT
        c.id,
        c.code,
        c.title,
        c.description,
        c.challenge_type,
        c.scope_type,
        c.start_date,
        c.end_date,
        c.target_value,
        c.reward_points
      FROM motivation_challenges c
      WHERE c.status = 'active'
        AND (c.start_date IS NULL OR c.start_date <= date('now'))
        AND (c.end_date IS NULL OR c.end_date >= date('now'))
        AND (
          c.scope_type = 'academy'
          OR (
            c.scope_type = 'circle'
            AND c.circle_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM circle_enrollments ce
              WHERE ce.circle_id = c.circle_id
                AND ce.student_id = ?
                AND ce.status = 'active'
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM motivation_challenge_participants p
          WHERE p.challenge_id = c.id
            AND p.student_id = ?
        )
      ORDER BY c.end_date ASC, c.id ASC
      LIMIT 20
    `)
    .bind(
      Number(studentId),
      Number(studentId)
    )
    .all();

  return {
    ...summary,
    eventTotals: eventTotals.results || [],
    activeChallenges: activeChallenges.results || [],
    availableChallenges: availableChallenges.results || [],
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const permission = await requirePermission(
      request,
      env,
      "motivation.read"
    );

    const user = permission.user;

    if (request.method === "POST") {
      const studentId = await getStudentForUser(
        env.DB,
        user
      );

      if (!studentId) {
        return json(
          {
            success: false,
            error: "STUDENT_NOT_LINKED",
            message: "لا يوجد طالب مرتبط بهذا الحساب.",
          },
          403
        );
      }

      const body = await request.json().catch(() => ({}));
      const action = clean(body?.action);

      if (action !== "join_challenge") {
        return json(
          {
            success: false,
            error: "INVALID_ACTION",
          },
          400
        );
      }

      const challengeId = Number(body?.challenge_id);

      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return json(
          {
            success: false,
            error: "INVALID_CHALLENGE_ID",
          },
          400
        );
      }

      const participant = await joinChallenge(
        env.DB,
        Number(studentId),
        challengeId
      );

      return json({
        success: true,
        participant,
        message: "تم الانضمام إلى التحدي بنجاح.",
      });
    }

    if (request.method !== "GET") {
      return json(
        {
          success: false,
          error: "METHOD_NOT_ALLOWED",
        },
        405
      );
    }
    const url = new URL(request.url);

    let studentId = clean(
      url.searchParams.get("student_id")
    );

    if (studentId !== null) {
      if (!/^\d+$/.test(studentId)) {
        return json(
          {
            success: false,
            error: "INVALID_STUDENT_ID",
          },
          400
        );
      }

      studentId = Number(studentId);

      const ownStudentId =
        await getStudentForUser(
          env.DB,
          user
        );

      const isPrivileged =
        user?.role === "admin" ||
        user?.role === "supervisor";

      const isOwnStudent =
        ownStudentId &&
        Number(studentId) === Number(ownStudentId);

      let isAssignedTeacherStudent = false;

      if (
        user?.role === "teacher" &&
        user?.teacher_id &&
        !isOwnStudent
      ) {
        const assigned =
          await env.DB
            .prepare(`
              SELECT 1
              FROM circle_enrollments ce
              INNER JOIN circles c
                ON c.id = ce.circle_id
              WHERE ce.student_id = ?
                AND ce.status = 'active'
                AND c.status = 'active'
                AND c.teacher_id = ?
              LIMIT 1
            `)
            .bind(
              Number(studentId),
              Number(user.teacher_id)
            )
            .first();

        isAssignedTeacherStudent =
          Boolean(assigned);
      }

      if (
        !isPrivileged &&
        !isOwnStudent &&
        !isAssignedTeacherStudent
      ) {
        return json(
          {
            success: false,
            error: "MOTIVATION_STUDENT_ACCESS_DENIED",
            message:
              "لا يمكنك عرض المسار التحفيزي لهذا الطالب.",
          },
          403
        );
      }
    } else {
      studentId = await getStudentForUser(
        env.DB,
        user
      );
    }

    if (!studentId) {
      return json({
        success: true,
        student: null,
        summary: null,
        message:
          "لا يوجد طالب مرتبط بهذا الحساب.",
      });
    }

    const student = await env.DB
      .prepare(`
        SELECT id, full_name AS name
        FROM students
        WHERE id = ?
        LIMIT 1
      `)
      .bind(Number(studentId))
      .first();

    if (!student) {
      return json(
        {
          success: false,
          error: "STUDENT_NOT_FOUND",
        },
        404
      );
    }

    const summary = await getSummary(
      env.DB,
      Number(studentId)
    );

    return json({
      success: true,
      student,
      summary,
    });
  } catch (error) {
    console.error("motivation GET error", error);

    return json(
      {
        success: false,
        error: error?.message || "MOTIVATION_ERROR",
        message: motivationErrorMessage(error),
      },
      500
    );
  }
}
