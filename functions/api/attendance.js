/**
 * الأوَّابين — Attendance API
 *
 * GET    /api/attendance
 * GET    /api/attendance?id=1
 * POST   /api/attendance
 * PATCH  /api/attendance
 *
 * يدعم:
 * - حاضر
 * - غائب
 * - متأخر
 * - بعذر
 * - عدد دقائق التأخير
 * - ملاحظات
 * - منع تكرار سجل الطالب في نفس الجلسة
 * - التحقق من وجود الجلسة والطالب
 * - التحقق من أن الطالب مسجل في الحلقة
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "excused",
];

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: HEADERS,
    }
  );
}

function errorResponse(
  message,
  status = 400,
  extra = {}
) {
  return json(
    {
      success: false,
      error: message,
      ...extra,
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function nullable(value) {
  const valueClean = clean(value);
  return valueClean || null;
}

function validId(value) {
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  );
}

function positiveInteger(
  value,
  fallback = 0
) {
  const n = Number(value);

  if (
    Number.isInteger(n) &&
    n >= 0
  ) {
    return n;
  }

  return fallback;
}

function now() {
  return new Date().toISOString();
}

/* =========================================================
   Related records
========================================================= */

async function getSession(
  db,
  sessionId
) {
  return db
    .prepare(`
      SELECT
        s.id,
        s.circle_id,
        s.teacher_id,
        s.session_type,
        s.session_date,
        s.start_time,
        s.end_time,
        s.status,
        c.name AS circle_name
      FROM sessions s
      LEFT JOIN circles c
        ON c.id = s.circle_id
      WHERE s.id = ?1
      LIMIT 1
    `)
    .bind(sessionId)
    .first();
}

async function getStudent(
  db,
  studentId
) {
  return db
    .prepare(`
      SELECT
        id,
        full_name,
        status
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(studentId)
    .first();
}

async function getAttendance(
  db,
  attendanceId
) {
  return db
    .prepare(`
      SELECT
        a.id,
        a.session_id,
        a.student_id,
        a.status,
        a.late_minutes,
        a.note,
        a.created_at,
        a.updated_at,

        s.session_type,
        s.session_date,
        s.start_time,
        s.end_time,
        s.circle_id,

        c.name AS circle_name,

        st.full_name AS student_name

      FROM attendance a

      JOIN sessions s
        ON s.id = a.session_id

      JOIN students st
        ON st.id = a.student_id

      LEFT JOIN circles c
        ON c.id = s.circle_id

      WHERE a.id = ?1
      LIMIT 1
    `)
    .bind(attendanceId)
    .first();
}

/* =========================================================
   Enrollment validation
========================================================= */

async function isStudentEnrolled(
  db,
  studentId,
  circleId
) {
  if (!circleId) {
    return true;
  }

  const row =
    await db
      .prepare(`
        SELECT id
        FROM circle_enrollments
        WHERE student_id = ?1
          AND circle_id = ?2
          AND status IN (
            'pending',
            'active',
            'paused'
          )
        LIMIT 1
      `)
      .bind(
        studentId,
        circleId
      )
      .first();

  return Boolean(row);
}

/* =========================================================
   Validation
========================================================= */

function validateStatus(
  status
) {
  if (
    !ATTENDANCE_STATUSES.includes(
      status
    )
  ) {
    return "INVALID_ATTENDANCE_STATUS";
  }

  return null;
}

function normalizeLateMinutes(
  status,
  value
) {
  if (status !== "late") {
    return 0;
  }

  return positiveInteger(
    value,
    0
  );
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const url =
    new URL(
      context.request.url
    );

  const attendanceId =
    url.searchParams.get("id");

  const sessionId =
    url.searchParams.get(
      "session_id"
    );

  const studentId =
    url.searchParams.get(
      "student_id"
    );

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    ).toLowerCase();

  const date =
    clean(
      url.searchParams.get(
        "session_date"
      )
    );

  try {
    if (attendanceId) {
      if (
        !validId(attendanceId)
      ) {
        return errorResponse(
          "INVALID_ATTENDANCE_ID"
        );
      }

      const row =
        await getAttendance(
          db,
          attendanceId
        );

      if (!row) {
        return errorResponse(
          "ATTENDANCE_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: row,
      });
    }

    let sql = `
      SELECT
        a.id,
        a.session_id,
        a.student_id,
        a.status,
        a.late_minutes,
        a.note,
        a.created_at,
        a.updated_at,

        s.session_type,
        s.session_date,
        s.start_time,
        s.end_time,
        s.circle_id,

        c.name AS circle_name,

        st.full_name AS student_name

      FROM attendance a

      JOIN sessions s
        ON s.id = a.session_id

      JOIN students st
        ON st.id = a.student_id

      LEFT JOIN circles c
        ON c.id = s.circle_id

      WHERE 1 = 1
    `;

    const params = [];

    if (sessionId) {
      if (
        !validId(sessionId)
      ) {
        return errorResponse(
          "INVALID_SESSION_ID"
        );
      }

      params.push(
        Number(sessionId)
      );

      sql += `
        AND a.session_id = ?${params.length}
      `;
    }

    if (studentId) {
      if (
        !validId(studentId)
      ) {
        return errorResponse(
          "INVALID_STUDENT_ID"
        );
      }

      params.push(
        Number(studentId)
      );

      sql += `
        AND a.student_id = ?${params.length}
      `;
    }

    if (status) {
      const statusError =
        validateStatus(
          status
        );

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      params.push(status);

      sql += `
        AND a.status = ?${params.length}
      `;
    }

    if (date) {
      params.push(date);

      sql += `
        AND s.session_date = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        s.session_date DESC,
        s.start_time DESC,
        a.id DESC
    `;

    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    return json({
      success: true,
      data:
        result.results || [],
      count:
        result.results?.length || 0,
    });
  } catch (e) {
    console.error(
      "ATTENDANCE_GET_ERROR",
      e
    );

    return errorResponse(
      "ATTENDANCE_FETCH_FAILED",
      500
    );
  }
}

/* =========================================================
   POST
========================================================= */

export async function onRequestPost(
  context
) {
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let data;

  try {
    data =
      await context.request.json();
  } catch {
    return errorResponse(
      "INVALID_JSON"
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    return errorResponse(
      "INVALID_REQUEST_BODY"
    );
  }

  const sessionId =
    Number(
      data.session_id ??
      data.sessionId
    );

  const studentId =
    Number(
      data.student_id ??
      data.studentId
    );

  const status =
    clean(
      data.status
    ).toLowerCase();

  if (
    !validId(sessionId)
  ) {
    return errorResponse(
      "SESSION_ID_REQUIRED"
    );
  }

  if (
    !validId(studentId)
  ) {
    return errorResponse(
      "STUDENT_ID_REQUIRED"
    );
  }

  const statusError =
    validateStatus(status);

  if (statusError) {
    return errorResponse(
      statusError
    );
  }

  const lateMinutes =
    normalizeLateMinutes(
      status,
      data.late_minutes ??
      data.lateMinutes
    );

  const note =
    nullable(data.note);

  try {
    const session =
      await getSession(
        db,
        sessionId
      );

    if (!session) {
      return errorResponse(
        "SESSION_NOT_FOUND",
        404
      );
    }

    const student =
      await getStudent(
        db,
        studentId
      );

    if (!student) {
      return errorResponse(
        "STUDENT_NOT_FOUND",
        404
      );
    }

    /*
     * إذا كانت الجلسة مرتبطة بحلقة،
     * يجب أن يكون الطالب مسجلًا فيها.
     */
    if (
      session.circle_id
    ) {
      const enrolled =
        await isStudentEnrolled(
          db,
          studentId,
          session.circle_id
        );

      if (!enrolled) {
        return errorResponse(
          "STUDENT_NOT_ENROLLED_IN_CIRCLE",
          409
        );
      }
    }

    /*
     * منع تكرار نفس الطالب
     * في نفس الجلسة.
     */
    const existing =
      await db
        .prepare(`
          SELECT *
          FROM attendance
          WHERE session_id = ?1
            AND student_id = ?2
          LIMIT 1
        `)
        .bind(
          sessionId,
          studentId
        )
        .first();

    if (existing) {
      return errorResponse(
        "ATTENDANCE_ALREADY_EXISTS",
        409,
        {
          attendance:
            existing,
        }
      );
    }

    const created =
      await db
        .prepare(`
          INSERT INTO attendance (
            session_id,
            student_id,
            status,
            late_minutes,
            note,
            created_at,
            updated_at
          )
          VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            ?6
          )
        `)
        .bind(
          sessionId,
          studentId,
          status,
          lateMinutes,
          note,
          now()
        )
        .run();

    const attendanceId =
      created.meta?.last_row_id;

    const row =
      await getAttendance(
        db,
        attendanceId
      );

    return json(
      {
        success: true,
        message:
          "ATTENDANCE_CREATED_SUCCESSFULLY",
        data: row,
      },
      201
    );
  } catch (e) {
    console.error(
      "ATTENDANCE_POST_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "ATTENDANCE_CREATE_FAILED",
      500
    );
  }
}

/* =========================================================
   PATCH
========================================================= */

export async function onRequestPatch(
  context
) {
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let data;

  try {
    data =
      await context.request.json();
  } catch {
    return errorResponse(
      "INVALID_JSON"
    );
  }

  const attendanceId =
    data.id ??
    data.attendance_id ??
    data.attendanceId;

  if (
    !validId(attendanceId)
  ) {
    return errorResponse(
      "ATTENDANCE_ID_REQUIRED"
    );
  }

  try {
    const current =
      await db
        .prepare(`
          SELECT *
          FROM attendance
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(
          Number(attendanceId)
        )
        .first();

    if (!current) {
      return errorResponse(
        "ATTENDANCE_NOT_FOUND",
        404
      );
    }

    const status =
      data.status !==
        undefined
        ? clean(
            data.status
          ).toLowerCase()
        : current.status;

    const statusError =
      validateStatus(status);

    if (statusError) {
      return errorResponse(
        statusError
      );
    }

    const lateMinutes =
      data.late_minutes !==
        undefined ||
      data.lateMinutes !==
        undefined
        ? normalizeLateMinutes(
            status,
            data.late_minutes ??
            data.lateMinutes
          )
        : (
            status === "late"
              ? positiveInteger(
                  current.late_minutes,
                  0
                )
              : 0
          );

    const note =
      data.note !==
        undefined
        ? nullable(data.note)
        : current.note;

    const updated =
      await db
        .prepare(`
          UPDATE attendance
          SET
            status = ?2,
            late_minutes = ?3,
            note = ?4,
            updated_at = ?5
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          Number(attendanceId),
          status,
          lateMinutes,
          note,
          now()
        )
        .first();

    const row =
      await getAttendance(
        db,
        attendanceId
      );

    return json({
      success: true,
      message:
        "ATTENDANCE_UPDATED_SUCCESSFULLY",
      data:
        row || updated,
    });
  } catch (e) {
    console.error(
      "ATTENDANCE_PATCH_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "ATTENDANCE_UPDATE_FAILED",
      500
    );
  }
}

/* =========================================================
   Router
========================================================= */

export async function onRequest(
  context
) {
  switch (
    context.request.method.toUpperCase()
  ) {
    case "GET":
      return onRequestGet(context);

    case "POST":
      return onRequestPost(context);

    case "PATCH":
      return onRequestPatch(context);

    default:
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
