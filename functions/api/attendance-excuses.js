import {
  json,
  error,
  requireAuth,
  requireRole
} from "./_auth.js";

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parseDate(value) {
  if (!value) return null;

  const text = String(value).trim();

  if (!text) return null;

  // Session date/time are stored as Cairo wall-clock time.
  // Convert that wall-clock time to the correct UTC instant.
  const match = text.match(
    /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2}))?$/
  );

  if (!match) {
    const fallback = new Date(text);
    return Number.isNaN(fallback.getTime())
      ? null
      : fallback;
  }

  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second = "0",
  ] = match;

  const utcGuess = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );

  const formatter = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }
  );

  const parts = Object.fromEntries(
    formatter
      .formatToParts(utcGuess)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  const offset =
    localAsUtc - utcGuess.getTime();

  return new Date(
    utcGuess.getTime() - offset
  );
}

export async function onRequestGet(context) {
  const { env, request } = context;

  try {
    const user = await requireAuth(request, env);
    const url = new URL(request.url);

    const studentId = url.searchParams.get("student_id");
    const attendanceId = url.searchParams.get("attendance_id");
    const sessionId = url.searchParams.get("session_id");

    let query = `
      SELECT
        ae.*,
        s.full_name AS student_name
      FROM attendance_excuses ae
      LEFT JOIN students s ON s.id = ae.student_id
      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      query += ` AND ae.student_id = ?`;
      params.push(Number(studentId));
    }

    if (attendanceId) {
      query += ` AND ae.attendance_id = ?`;
      params.push(Number(attendanceId));
    }

    if (sessionId) {
      query += ` AND ae.session_id = ?`;
      params.push(Number(sessionId));
    }

    if (user?.role === "teacher") {
      const teacherId = Number(user?.teacher_id ?? 0);
      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        return error("FORBIDDEN", 403);
      }
      query += `
        AND EXISTS (
          SELECT 1
          FROM sessions s
          WHERE s.id = ae.session_id
            AND s.teacher_id = ?
        )
      `;
      params.push(teacherId);
    } else if (user?.role === "student") {
      const ownStudentId = Number(user?.student_id ?? 0);
      if (!Number.isInteger(ownStudentId) || ownStudentId <= 0) {
        return error("FORBIDDEN", 403);
      }
      query += ` AND ae.student_id = ?`;
      params.push(ownStudentId);
    } else if (user?.role === "guardian") {
      const guardianUserId = Number(user?.id ?? 0);
      if (!Number.isInteger(guardianUserId) || guardianUserId <= 0) {
        return error("FORBIDDEN", 403);
      }
      query += `
        AND EXISTS (
          SELECT 1
          FROM student_guardians sg
          INNER JOIN guardians g ON g.id = sg.guardian_id
          WHERE sg.student_id = ae.student_id
            AND g.user_id = ?
        )
      `;
      params.push(guardianUserId);
    }

    query += ` ORDER BY ae.submitted_at DESC LIMIT 200`;

    const result = await env.DB.prepare(query)
      .bind(...params)
      .all();

    return json({
      success: true,
      data: result.results || []
    });
  } catch (e) {
    console.error("ATTENDANCE_EXCUSE_GET_ERROR", e);

    return error(
      e instanceof Error ? e.message : "ATTENDANCE_EXCUSE_GET_FAILED",
      500
    );
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const user = await requireAuth(request, env);

    if (
      !["student", "admin", "supervisor"].includes(
        user?.role
      )
    ) {
      return error("FORBIDDEN", 403);
    }

    const data = await request.json();

    const attendanceId = Number(
      data.attendance_id ?? data.attendanceId
    );

    const studentId = Number(
      data.student_id ??
      data.studentId ??
      user?.student_id
    );

    const sessionId = Number(
      data.session_id ?? data.sessionId
    );

    if (
      !Number.isInteger(attendanceId) ||
      attendanceId <= 0 ||
      !Number.isInteger(studentId) ||
      studentId <= 0 ||
      !Number.isInteger(sessionId) ||
      sessionId <= 0
    ) {
      return error("INVALID_EXCUSE_REFERENCE", 400);
    }

    if (
      user?.role === "student" &&
      user?.student_id &&
      Number(user.student_id) !== studentId
    ) {
      return error("FORBIDDEN", 403);
    }

    if (
      user?.role === "student" &&
      (!user?.student_id ||
       Number(user.student_id) !== studentId)
    ) {
      return error("FORBIDDEN", 403);
    }

    const attendance = await env.DB.prepare(`
      SELECT
        a.*,
        s.start_time,
        s.session_date
      FROM attendance a
      LEFT JOIN sessions s ON s.id = a.session_id
      WHERE a.id = ?
        AND a.student_id = ?
        AND a.session_id = ?
      LIMIT 1
    `)
      .bind(attendanceId, studentId, sessionId)
      .first();

    if (!attendance) {
      return error("ATTENDANCE_NOT_FOUND", 404);
    }

    const existing = await env.DB.prepare(`
      SELECT *
      FROM attendance_excuses
      WHERE attendance_id = ?
      LIMIT 1
    `)
      .bind(attendanceId)
      .first();

    if (existing) {
      return error("EXCUSE_ALREADY_SUBMITTED", 409);
    }

    const submittedAt = new Date().toISOString();

    const sessionStartRaw =
      attendance.start_time
        ? `${attendance.session_date || ""}T${attendance.start_time}`
        : null;

    const sessionStart = parseDate(sessionStartRaw);

    let deadlineExceeded = false;

    const excuseRules =
      await env.DB
        .prepare(`
          SELECT
            excuse_deadline_hours
          FROM attendance_excuse_rules
          WHERE id = 1
            AND active = 1
          LIMIT 1
        `)
        .first();

    const excuseDeadlineHours =
      Number(
        excuseRules?.excuse_deadline_hours ?? 4
      );

    if (sessionStart) {
      const deadline =
        new Date(
          sessionStart.getTime() -
          excuseDeadlineHours * 60 * 60 * 1000
        );

      deadlineExceeded =
        new Date(submittedAt).getTime() >
        deadline.getTime();
    }

    const result = await env.DB.prepare(`
      INSERT INTO attendance_excuses (
        attendance_id,
        student_id,
        session_id,
        excuse_text,
        submitted_at,
        status
      )
      VALUES (?, ?, ?, ?, ?, 'pending')
      RETURNING *
    `)
      .bind(
        attendanceId,
        studentId,
        sessionId,
        clean(data.excuse_text ?? data.excuse),
        submittedAt
      )
      .first();

    return json({
      success: true,
      deadline_exceeded: deadlineExceeded,
      data: result
    }, 201);
  } catch (e) {
    console.error("ATTENDANCE_EXCUSE_POST_ERROR", e);

    return error(
      e instanceof Error ? e.message : "ATTENDANCE_EXCUSE_CREATE_FAILED",
      500
    );
  }
}

export async function onRequestPatch(context) {
  const { env, request } = context;

  try {
    const user = await requireAuth(request, env);
    await requireRole(request, env, ["admin", "teacher"]);

    const data = await request.json();

    const excuseId = Number(
      data.id ??
      data.excuse_id ??
      data.excuseId
    );

    if (!Number.isInteger(excuseId) || excuseId <= 0) {
      return error("INVALID_EXCUSE_ID", 400);
    }

    const status = clean(data.status);

    if (!["pending", "approved", "rejected"].includes(status)) {
      return error("INVALID_EXCUSE_STATUS", 400);
    }

    const existing = await env.DB.prepare(`
      SELECT *
      FROM attendance_excuses
      WHERE id = ?
      LIMIT 1
    `)
      .bind(excuseId)
      .first();

    if (!existing) {
      return error("EXCUSE_NOT_FOUND", 404);
    }

    /*
     * Teachers may review excuses only for their own sessions.
     * Admins remain unrestricted by this teacher-specific scope.
     */
    if (user?.role === "teacher") {
      const teacherId = Number(user?.teacher_id ?? 0);

      if (!Number.isInteger(teacherId) || teacherId <= 0) {
        return error("FORBIDDEN", 403);
      }

      const teacherOwnsSession =
        await env.DB
          .prepare(`
            SELECT 1
            FROM attendance_excuses ae
            INNER JOIN sessions s
              ON s.id = ae.session_id
            WHERE ae.id = ?
              AND s.teacher_id = ?
            LIMIT 1
          `)
          .bind(
            excuseId,
            teacherId
          )
          .first();

      if (!teacherOwnsSession) {
        return error("FORBIDDEN", 403);
      }
    }

    const reviewedAt = new Date().toISOString();
    const reviewedBy = user?.id ?? null;

    const result = await env.DB.prepare(`
      UPDATE attendance_excuses
      SET
        status = ?,
        reviewed_at = ?,
        reviewed_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      RETURNING *
    `)
      .bind(
        status,
        reviewedAt,
        reviewedBy,
        excuseId
      )
      .first();

    return json({
      success: true,
      data: result
    });
  } catch (e) {
    console.error("ATTENDANCE_EXCUSE_PATCH_ERROR", e);

    return error(
      e instanceof Error ? e.message : "ATTENDANCE_EXCUSE_UPDATE_FAILED",
      500
    );
  }
}
