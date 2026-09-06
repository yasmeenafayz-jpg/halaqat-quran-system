import {
  requirePermission,
} from "./_auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function errorResponse(error, status = 400) {
  return json(
    {
      success: false,
      error,
      message: error,
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    clean(value)
  );
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function getRange(url) {
  const requestedStart = clean(
    url.searchParams.get("start_date")
  );

  const requestedEnd = clean(
    url.searchParams.get("end_date")
  );

  const requestedDate = clean(
    url.searchParams.get("date")
  );

  let startDate = requestedStart;
  let endDate = requestedEnd;

  if (!validDate(startDate)) {
    startDate = validDate(requestedDate)
      ? requestedDate
      : new Date().toISOString().slice(0, 10);
  }

  if (!validDate(endDate)) {
    endDate = startDate;
  }

  if (endDate < startDate) {
    const temp = startDate;
    startDate = endDate;
    endDate = temp;
  }

  return {
    startDate,
    endDate,
  };
}

function filtersFromUrl(url) {
  return {
    teacherId: clean(
      url.searchParams.get("teacher_id")
    ),
    circleId: clean(
      url.searchParams.get("circle_id")
    ),
    studentId: clean(
      url.searchParams.get("student_id")
    ),
    sessionType: clean(
      url.searchParams.get("session_type")
    ),
    status: clean(
      url.searchParams.get("status")
    ),
  };
}

async function getSessions(db, range, filters) {
  let sql = `
    SELECT
      s.id,
      s.session_date,
      s.start_time,
      s.end_time,
      s.session_type,
      s.status,
      s.circle_id,
      s.teacher_id,
      s.student_id,
      s.meeting_url,
      s.notes,

      c.name AS circle_name,
      t.full_name AS teacher_name,
      st.full_name AS student_name

    FROM sessions s

    LEFT JOIN circles c
      ON c.id = s.circle_id

    LEFT JOIN teachers t
      ON t.id = s.teacher_id

    LEFT JOIN students st
      ON st.id = s.student_id

    WHERE s.session_date >= ?
      AND s.session_date <= ?
  `;

  const params = [
    range.startDate,
    range.endDate,
  ];

  if (filters.teacherId) {
    sql += ` AND s.teacher_id = ?`;
    params.push(Number(filters.teacherId));
  }

  if (filters.circleId) {
    sql += ` AND s.circle_id = ?`;
    params.push(Number(filters.circleId));
  }

  if (filters.studentId) {
    sql += ` AND s.student_id = ?`;
    params.push(Number(filters.studentId));
  }

  if (filters.sessionType) {
    sql += ` AND s.session_type = ?`;
    params.push(filters.sessionType);
  }

  if (filters.status) {
    sql += ` AND s.status = ?`;
    params.push(filters.status);
  }

  sql += `
    ORDER BY
      s.session_date ASC,
      s.start_time ASC,
      s.id ASC
  `;

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all();

  return result.results || [];
}

async function getSeries(db, user, filters = {}) {
  let sql = `
    SELECT
      ss.id,
      ss.title,
      ss.circle_id,
      ss.teacher_id,
      ss.student_id,
      ss.session_type,
      ss.recurrence_type,
      ss.interval_value,
      ss.weekdays_json,
      ss.start_date,
      ss.end_date,
      ss.start_time,
      ss.end_time,
      ss.timezone,
      ss.status,
      ss.notes,
      c.name AS circle_name,
      t.full_name AS teacher_name,
      st.full_name AS student_name
    FROM schedule_series ss
    LEFT JOIN circles c
      ON c.id = ss.circle_id
    LEFT JOIN teachers t
      ON t.id = ss.teacher_id
    LEFT JOIN students st
      ON st.id = ss.student_id
    WHERE 1 = 1
  `;

  const params = [];

  if (user.role === "teacher") {
    sql += ` AND ss.teacher_id = ?`;
    params.push(Number(user.teacher_id));
  } else if (user.role === "student") {
    sql += ` AND ss.student_id = ?`;
    params.push(Number(user.student_id));
  } else if (
    user.role !== "admin" &&
    user.role !== "supervisor" &&
    user.role !== "guardian"
  ) {
    sql += ` AND 1 = 0`;
  }

  if (filters.teacher_id) {
    sql += ` AND ss.teacher_id = ?`;
    params.push(Number(filters.teacher_id));
  }

  if (filters.circle_id) {
    sql += ` AND ss.circle_id = ?`;
    params.push(Number(filters.circle_id));
  }

  if (filters.student_id) {
    sql += ` AND ss.student_id = ?`;
    params.push(Number(filters.student_id));
  }

  if (filters.session_type) {
    sql += ` AND ss.session_type = ?`;
    params.push(filters.session_type);
  }

  if (filters.series_status) {
    sql += ` AND ss.status = ?`;
    params.push(filters.series_status);
  }

  sql += `
    ORDER BY
      ss.start_date ASC,
      ss.start_time ASC,
      ss.id ASC
  `;

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all();

  return result.results || [];
}

async function getLeaves(db, range) {
  const result = await db
    .prepare(`
      SELECT
        tlr.id,
        tlr.teacher_id,
        tlr.leave_type,
        tlr.start_date,
        tlr.end_date,
        tlr.reason,
        tlr.status,
        t.full_name AS teacher_name
      FROM teacher_leave_requests tlr
      LEFT JOIN teachers t
        ON t.id = tlr.teacher_id
      WHERE tlr.status = 'approved'
        AND tlr.start_date <= ?
        AND tlr.end_date >= ?
      ORDER BY tlr.start_date
    `)
    .bind(
      range.endDate,
      range.startDate
    )
    .all();

  return result.results || [];
}

async function getReferenceData(db) {
  const [teachers, circles, students] =
    await Promise.all([
      db
        .prepare(`
          SELECT id, full_name
          FROM teachers
          WHERE status IS NULL
             OR status NOT IN ('inactive','deleted')
          ORDER BY full_name
        `)
        .all(),

      db
        .prepare(`
          SELECT id, name
          FROM circles
          ORDER BY name
        `)
        .all(),

      db
        .prepare(`
          SELECT id, full_name
          FROM students
          WHERE status IS NULL
             OR status NOT IN ('inactive','deleted')
          ORDER BY full_name
        `)
        .all(),
    ]);

  return {
    teachers: teachers.results || [],
    circles: circles.results || [],
    students: students.results || [],
  };
}

export async function onRequestGet(context) {
  const permission =
    await requirePermission(
      context.request,
      context.env,
      "sessions.read"
    );

  if (!permission.ok) {
    return permission.response;
  }

  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  try {
    const url = new URL(
      context.request.url
    );

    const range = getRange(url);
    const filters =
      filtersFromUrl(url);

    const [
      sessions,
      recurring,
      leaves,
      reference,
    ] = await Promise.all([
      getSessions(
        db,
        range,
        filters
      ),
      getSeries(env.DB, auth.user, filters),
      getLeaves(db, range),
      getReferenceData(db),
    ]);

    return json({
      success: true,
      timezone:
        context.env.APP_TIMEZONE ||
        "Africa/Cairo",
      range,
      filters,
      data: {
        sessions,
        recurring,
        leaves,
        ...reference,
      },
      count: sessions.length,
    });
  } catch (error) {
    console.error(
      "SCHEDULE_CENTER_GET_FAILED",
      error
    );

    return errorResponse(
      "SCHEDULE_CENTER_FETCH_FAILED",
      500
    );
  }
}
