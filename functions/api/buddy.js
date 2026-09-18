import {
  requireAuth,
  requirePermission,
  json,
} from "./_auth.js";

import {
  awardPoints,
  getMotivationPoints,
} from "./_motivation.js";

import {
  evaluateAchievements,
  recordChallengeEvent,
} from "./_motivation-achievements.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const url = new URL(request.url);
  const includeEnded = url.searchParams.get("include_ended") === "1";

  let sql = `
    SELECT
      bp.*,
      s1.full_name AS student_name,
      s2.full_name AS buddy_name
    FROM buddy_pairs bp
    LEFT JOIN students s1 ON s1.id = bp.student_id
    LEFT JOIN students s2 ON s2.id = bp.buddy_student_id
    WHERE 1=1
  `;

  const params = [];

  if (!includeEnded) {
    sql += ` AND bp.status='active'`;
  }

  if (u.role === "student") {
    sql += ` AND (bp.student_id=? OR bp.buddy_student_id=?)`;
    params.push(u.student_id, u.student_id);
  }

  sql += ` ORDER BY bp.start_date DESC, bp.id DESC`;

  const r = await env.DB.prepare(sql).bind(...params).all();

  return json({
    success: true,
    pairs: r.results || [],
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const b = await request.json().catch(() => ({}));

  if (b.action === "followup") {
    const selfPermission = await requirePermission(
      request,
      env,
      "buddy.followup.self.write"
    );

    if (!selfPermission.ok) return selfPermission.response;

    if (u.role !== "student") {
      return json({ success: false, error: "FORBIDDEN" }, 403);
    }

    if (!u.student_id) {
      return json({ success: false, error: "STUDENT_NOT_LINKED" }, 400);
    }

    const pair = await env.DB.prepare(`
      SELECT *
      FROM buddy_pairs
      WHERE status='active'
        AND (student_id=? OR buddy_student_id=?)
      LIMIT 1
    `).bind(u.student_id, u.student_id).first();

    if (!pair) {
      return json({
        success: false,
        error: "NO_ACTIVE_BUDDY",
      }, 400);
    }

    const d = today();

    const isPrimaryStudent =
      Number(pair.student_id) === Number(u.student_id);

    const existingFollowup = await env.DB.prepare(`
      SELECT
        student_confirmed,
        buddy_confirmed
      FROM buddy_daily_followups
      WHERE buddy_pair_id=?
        AND followup_date=?
      LIMIT 1
    `).bind(pair.id, d).first();

    const studentConfirmed =
      Number(existingFollowup?.student_confirmed || 0) === 1 ||
      isPrimaryStudent;

    const buddyConfirmed =
      Number(existingFollowup?.buddy_confirmed || 0) === 1 ||
      !isPrimaryStudent;

    const followupCompleted =
      studentConfirmed && buddyConfirmed;

    const result = await env.DB.prepare(`
      INSERT INTO buddy_daily_followups
      (
        buddy_pair_id,
        circle_id,
        student_id,
        buddy_student_id,
        followup_date,
        status,
        student_confirmed,
        buddy_confirmed,
        note,
        completed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(buddy_pair_id,followup_date)
      DO UPDATE SET
        status=excluded.status,
        student_confirmed=excluded.student_confirmed,
        buddy_confirmed=excluded.buddy_confirmed,
        note=excluded.note,
        completed_at=excluded.completed_at,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      pair.id,
      pair.circle_id,
      pair.student_id,
      pair.buddy_student_id,
      d,
      followupCompleted ? "completed" : "pending",
      studentConfirmed ? 1 : 0,
      buddyConfirmed ? 1 : 0,
      b.note || null,
      followupCompleted ? new Date().toISOString() : null
    ).run();

    let motivation = null;

    /*
     * عند اكتمال المتابعة اليومية يحصل الطرفان
     * على نقاطهما بشكل مستقل.
     *
     * لكل طالب مفتاح idempotency مستقل حتى لا
     * تتكرر النقاط عند إعادة الطلب.
     *
     * فشل التحفيز لا يلغي نجاح المتابعة.
     */
    if (followupCompleted) {
      const points =
        getMotivationPoints(
          "buddy_followup"
        );

      const rewards = [
        {
          studentId:
            Number(pair.student_id),
          role: "student",
        },
        {
          studentId:
            Number(pair.buddy_student_id),
          role: "buddy",
        },
      ];

      motivation = {
        points_added: 0,
        created: 0,
        duplicate: 0,
      };

      for (const reward of rewards) {
        try {
          const awarded =
            await awardPoints(
              env.DB,
              {
                studentId:
                  reward.studentId,
                eventType:
                  "buddy_followup",
                sourceType:
                  "buddy_daily_followup",
                sourceId:
                  Number(pair.id),
                points,
                reason:
                  "إتمام متابعة الرفيقة اليومية",
                idempotencyKey:
                  `buddy_followup:${pair.id}:${d}:${reward.role}`,
                metadata: {
                  buddy_pair_id:
                    Number(pair.id),
                  followup_date: d,
                  student_id:
                    Number(pair.student_id),
                  buddy_student_id:
                    Number(pair.buddy_student_id),
                  participant:
                    reward.role,
                },
                awardedBy:
                  Number(u.id),
              }
            );

          if (awarded.created) {
            motivation.points_added +=
              Number(
                awarded.event?.points || 0
              );
            motivation.created += 1;
          }

          if (awarded.duplicate) {
            motivation.duplicate += 1;
          }
        } catch {
          /*
           * فشل مكافأة طرف واحد لا يلغي
           * متابعة اليوم ولا يمنع مكافأة الطرف الآخر.
           */
        }
      }

      try {
        await Promise.all(
          rewards.map((reward) =>
            evaluateAchievements(
              env.DB,
              Number(reward.studentId),
              {
                sourceType:
                  "buddy_daily_followup",
                sourceId:
                  Number(pair.id),
              }
            )
          )
        );
      } catch (achievementError) {
        console.error(
          "BUDDY_ACHIEVEMENT_ERROR",
          achievementError
        );
      }
    }
      /*
       * Challenge event لكل طرف بشكل مستقل.
       * تاريخ اليوم داخل idempotency يمنع التكرار
       * مع السماح بتسجيل متابعة جديدة في يوم لاحق.
       */
      for (const reward of rewards) {
        try {
          await recordChallengeEvent(
            env.DB,
            Number(reward.studentId),
            {
              eventType: "buddy_followup",
              value: 1,
              sourceType: "buddy_daily_followup",
              sourceId: Number(pair.id),
              idempotencyKey:
                `buddy_followup:${pair.id}:${d}:${reward.role}:challenge`,
            }
          );
        } catch (challengeError) {
          console.error(
            "BUDDY_CHALLENGE_ERROR",
            challengeError
          );
        }
      }

    return json({
      success: true,
      changed: result.meta?.changes || 0,
      followup_status:
        followupCompleted
          ? "completed"
          : "pending",
      ...(motivation
        ? {
            motivation: {
              points_added:
                motivation.points_added,
              rewards_created:
                motivation.created,
              duplicates:
                motivation.duplicate,
            },
          }
        : {}),
    });
  }

  const p = await requirePermission(request, env, "buddy.admin.write");
  if (!p.ok) return p.response;

  if (b.action === "assign") {
    if (
      !b.circle_id ||
      !b.student_id ||
      !b.buddy_student_id ||
      Number(b.student_id) === Number(b.buddy_student_id)
    ) {
      return json({
        success: false,
        error: "INVALID_BUDDY_PAIR",
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

    const students = await env.DB.prepare(`
      SELECT id
      FROM students
      WHERE id IN (?,?)
        AND status='active'
    `).bind(
      b.student_id,
      b.buddy_student_id
    ).all();

    if ((students.results || []).length !== 2) {
      return json({
        success: false,
        error: "STUDENTS_NOT_ACTIVE",
      }, 409);
    }

    const circleStudents = await env.DB.prepare(`
      SELECT DISTINCT student_id
      FROM circle_enrollments
      WHERE circle_id=?
        AND student_id IN (?,?)
        AND status='active'
    `).bind(
      b.circle_id,
      b.student_id,
      b.buddy_student_id
    ).all();

    if ((circleStudents.results || []).length !== 2) {
      return json({
        success: false,
        error: "STUDENTS_NOT_IN_CIRCLE",
      }, 409);
    }

    const existing = await env.DB.prepare(`
      SELECT id
      FROM buddy_pairs
      WHERE status='active'
        AND (
          student_id IN (?,?)
          OR buddy_student_id IN (?,?)
        )
      LIMIT 1
    `).bind(
      b.student_id,
      b.buddy_student_id,
      b.student_id,
      b.buddy_student_id
    ).first();

    if (existing) {
      return json({
        success: false,
        error: "ACTIVE_BUDDY_EXISTS",
      }, 409);
    }

    const startDate = b.start_date || today();

    const pair = await env.DB.prepare(`
      INSERT INTO buddy_pairs
      (
        circle_id,
        student_id,
        buddy_student_id,
        start_date,
        status,
        assigned_by,
        notes
      )
      VALUES (?,?,?,?,'active',?,?)
      RETURNING *
    `).bind(
      b.circle_id,
      b.student_id,
      b.buddy_student_id,
      startDate,
      u.id,
      b.notes || null
    ).first();

    await env.DB.prepare(`
      INSERT INTO buddy_pair_changes
      (
        buddy_pair_id,
        circle_id,
        student_id,
        old_buddy_student_id,
        new_buddy_student_id,
        change_type,
        reason,
        changed_by
      )
      VALUES (?,?,?,?,?,'assigned',?,?)
    `).bind(
      pair.id,
      pair.circle_id,
      pair.student_id,
      null,
      pair.buddy_student_id,
      b.reason || null,
      u.id
    ).run();

    return json({
      success: true,
      pair,
    }, 201);
  }

  if (b.action === "end") {
    if (!b.id) {
      return json({
        success: false,
        error: "BUDDY_ID_REQUIRED",
      }, 400);
    }

    const pair = await env.DB.prepare(`
      SELECT *
      FROM buddy_pairs
      WHERE id=? AND status='active'
      LIMIT 1
    `).bind(b.id).first();

    if (!pair) {
      return json({
        success: false,
        error: "ACTIVE_BUDDY_NOT_FOUND",
      }, 404);
    }

    await env.DB.prepare(`
      UPDATE buddy_pairs
      SET
        status='ended',
        end_date=?,
        ended_by=?,
        reason=?
      WHERE id=? AND status='active'
    `).bind(
      today(),
      u.id,
      b.reason || null,
      b.id
    ).run();

    await env.DB.prepare(`
      INSERT INTO buddy_pair_changes
      (
        buddy_pair_id,
        circle_id,
        student_id,
        old_buddy_student_id,
        new_buddy_student_id,
        change_type,
        reason,
        changed_by
      )
      VALUES (?,?,?,?,?,'ended',?,?)
    `).bind(
      pair.id,
      pair.circle_id,
      pair.student_id,
      pair.buddy_student_id,
      null,
      b.reason || null,
      u.id
    ).run();

    return json({ success: true });
  }

  return json({
    success: false,
    error: "UNKNOWN_ACTION",
  }, 400);
}
