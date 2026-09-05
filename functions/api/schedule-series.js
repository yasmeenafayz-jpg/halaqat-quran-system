import {
  requirePermission
} from "./_auth.js";

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function validId(value) {
  return Number.isInteger(value) && value > 0;
}

const SESSION_TYPES = new Set([
  "quran",
  "noorani",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
  "group",
  "individual",
  "trial",
  "test",
  "independent_recitation",
  "scientific",
  "admin_meeting",
  "teacher_leave",
  "closed_slot"
]);

const RECURRENCE_TYPES = new Set([
  "once",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "custom"
]);

const STATUSES = new Set([
  "active",
  "paused",
  "stopped",
  "completed",
  "cancelled"
]);

function parseWeekdays(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(Number);
  }

  try {
    const parsed = JSON.parse(String(value));

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.map(Number);
  } catch {
    return null;
  }
}

function validateWeekdays(days) {
  if (days === null) {
    return true;
  }

  return days.every(
    (day) =>
      Number.isInteger(day) &&
      day >= 0 &&
      day <= 6
  );
}

async function audit(
  db,
  userId,
  action,
  entityId,
  oldValue = null,
  newValue = null
) {
  try {
    await db
      .prepare(`
        INSERT INTO audit_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          old_values,
          new_values,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(
        userId ?? null,
        action,
        "schedule_series",
        entityId ?? null,
        oldValue
          ? JSON.stringify(oldValue)
          : null,
        newValue
          ? JSON.stringify(newValue)
          : null
      )
      .run();
  } catch {
    // Audit must never break the primary scheduling operation.
  }
}

async function getSeries(db, id = null, user = null) {
  let sql = `
    SELECT
      ss.*,

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
  `;

  const where = [];
  const params = [];

  if (id !== null) {
    where.push("ss.id = ?");
    params.push(id);
  }

  /*
   * Entity-level schedule isolation:
   * admin/supervisor -> all
   * teacher          -> own teacher schedule
   * student          -> own student schedule
   * guardian         -> schedules explicitly linked to their students
   */
  if (!user || !user.role) {
    where.push("1 = 0");
  } else if (
    user.role !== "admin" &&
    user.role !== "supervisor"
  ) {
    if (user.role === "teacher") {
      if (!user.teacher_id) {
        where.push("1 = 0");
      } else {
        where.push("ss.teacher_id = ?");
        params.push(user.teacher_id);
      }
    } else if (user.role === "student") {
      if (!user.student_id) {
        where.push("1 = 0");
      } else {
        where.push("ss.student_id = ?");
        params.push(user.student_id);
      }
    } else if (user.role === "guardian") {
      where.push(`
        ss.student_id IN (
          SELECT sg.student_id
          FROM student_guardians sg
          INNER JOIN guardians g
            ON g.id = sg.guardian_id
          WHERE g.user_id = ?
            AND g.status = 'active'
        )
      `);
      params.push(user.id);
    } else {
      where.push("1 = 0");
    }
  }

  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
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

function validateInput(data, current = null) {
  const sessionType =
    clean(
      data.session_type ??
      current?.session_type ??
      "quran"
    ).toLowerCase();

  const recurrenceType =
    clean(
      data.recurrence_type ??
      current?.recurrence_type ??
      "once"
    ).toLowerCase();

  const startDate = clean(
    data.start_date ??
    current?.start_date
  );

  const endDate =
    data.end_date !== undefined
      ? clean(data.end_date) || null
      : current?.end_date ?? null;

  const startTime = clean(
    data.start_time ??
    current?.start_time
  );

  const endTime = clean(
    data.end_time ??
    current?.end_time
  );

  const intervalValue = Number(
    data.interval_value ??
    current?.interval_value ??
    1
  );

  const weekdays = parseWeekdays(
    data.weekdays_json ??
    data.weekdays ??
    current?.weekdays_json ??
    null
  );

  if (!SESSION_TYPES.has(sessionType)) {
    return {
      error: "INVALID_SESSION_TYPE"
    };
  }

  if (!RECURRENCE_TYPES.has(recurrenceType)) {
    return {
      error: "INVALID_RECURRENCE_TYPE"
    };
  }

  if (!startDate) {
    return {
      error: "START_DATE_REQUIRED"
    };
  }

  if (!startTime || !endTime) {
    return {
      error: "SESSION_TIME_REQUIRED"
    };
  }

  if (
    !Number.isInteger(intervalValue) ||
    intervalValue < 1
  ) {
    return {
      error: "INVALID_INTERVAL"
    };
  }

  if (
    endDate !== null &&
    endDate < startDate
  ) {
    return {
      error: "INVALID_DATE_RANGE"
    };
  }

  if (!validateWeekdays(weekdays)) {
    return {
      error: "INVALID_WEEKDAYS"
    };
  }

  return {
    value: {
      title:
        clean(
          data.title ??
          current?.title ??
          ""
        ) || null,

      circleId:
        data.circle_id !== undefined
          ? (
              data.circle_id === null ||
              data.circle_id === ""
                ? null
                : Number(data.circle_id)
            )
          : current?.circle_id ?? null,

      teacherId:
        data.teacher_id !== undefined
          ? (
              data.teacher_id === null ||
              data.teacher_id === ""
                ? null
                : Number(data.teacher_id)
            )
          : current?.teacher_id ?? null,

      studentId:
        data.student_id !== undefined
          ? (
              data.student_id === null ||
              data.student_id === ""
                ? null
                : Number(data.student_id)
            )
          : current?.student_id ?? null,

      sessionType,
      recurrenceType,
      intervalValue,
      weekdaysJson:
        weekdays === null
          ? null
          : JSON.stringify(weekdays),
      startDate,
      endDate,
      startTime,
      endTime,

      timezone:
        clean(
          data.timezone ??
          current?.timezone ??
          "Africa/Cairo"
        ) || "Africa/Cairo",

      status:
        clean(
          data.status ??
          current?.status ??
          "active"
        ).toLowerCase(),

      notes:
        clean(
          data.notes ??
          current?.notes ??
          ""
        ) || null
    }
  };
}

async function validateSeriesReferences(
  db,
  value,
  user = null
) {
  const privileged =
    user &&
    (
      user.role === "admin" ||
      user.role === "supervisor"
    );

  const teacherScoped =
    user &&
    user.role === "teacher" &&
    user.teacher_id;

  if (value.circleId !== null) {
    const circle = await db
      .prepare(`
        SELECT
          id,
          teacher_id,
          status
        FROM circles
        WHERE id = ?
        LIMIT 1
      `)
      .bind(value.circleId)
      .first();

    if (!circle) {
      return "CIRCLE_NOT_FOUND";
    }

    if (
      circle.status !== undefined &&
      circle.status !== null &&
      circle.status !== "active"
    ) {
      return "CIRCLE_IS_NOT_ACTIVE";
    }

    if (
      teacherScoped &&
      Number(circle.teacher_id) !==
        Number(user.teacher_id)
    ) {
      return "CIRCLE_OUT_OF_SCOPE";
    }
  }

  if (value.teacherId !== null) {
    const teacher = await db
      .prepare(`
        SELECT id, status
        FROM teachers
        WHERE id = ?
        LIMIT 1
      `)
      .bind(value.teacherId)
      .first();

    if (!teacher) {
      return "TEACHER_NOT_FOUND";
    }

    if (
      teacher.status !== undefined &&
      teacher.status !== null &&
      teacher.status !== "active"
    ) {
      return "TEACHER_IS_NOT_ACTIVE";
    }

    if (
      teacherScoped &&
      Number(value.teacherId) !==
        Number(user.teacher_id)
    ) {
      return "TEACHER_OUT_OF_SCOPE";
    }
  }

  if (value.studentId !== null) {
    const student = await db
      .prepare(`
        SELECT id, status
        FROM students
        WHERE id = ?
        LIMIT 1
      `)
      .bind(value.studentId)
      .first();

    if (!student) {
      return "STUDENT_NOT_FOUND";
    }

    if (
      student.status !== undefined &&
      student.status !== null &&
      student.status !== "active"
    ) {
      return "STUDENT_IS_NOT_ACTIVE";
    }

    if (
      teacherScoped &&
      value.circleId !== null
    ) {
      const enrollment = await db
        .prepare(`
          SELECT id
          FROM circle_enrollments
          WHERE circle_id = ?
            AND student_id = ?
            AND status IN (
              'pending',
              'active',
              'paused'
            )
          LIMIT 1
        `)
        .bind(
          value.circleId,
          value.studentId
        )
        .first();

      if (!enrollment) {
        return "STUDENT_OUT_OF_CIRCLE_SCOPE";
      }
    } else if (
      teacherScoped &&
      value.circleId === null
    ) {
      return "STUDENT_SCOPE_REQUIRES_CIRCLE";
    }
  }

  return null;
}
function canWriteSeries(user, value, current = null) {
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (user.role === "teacher") {
    if (
      !user.teacher_id ||
      value.teacherId !== Number(user.teacher_id)
    ) {
      return false;
    }

    if (
      current &&
      current.teacher_id !== Number(user.teacher_id)
    ) {
      return false;
    }

    return true;
  }

  return false;
}

async function createSeries(
  request,
  env,
  user
) {
  const data = await request.json();

  const validation =
    validateInput(data);

  if (validation.error) {
    return json(
      {
        success: false,
        error: validation.error
      },
      400
    );
  }

  const value = validation.value;

  if (
    !validId(value.circleId) &&
    value.circleId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_CIRCLE_ID"
      },
      400
    );
  }

  if (
    !validId(value.teacherId) &&
    value.teacherId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_TEACHER_ID"
      },
      400
    );
  }

  if (
    !validId(value.studentId) &&
    value.studentId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_STUDENT_ID"
      },
      400
    );
  }

  if (!STATUSES.has(value.status)) {
    return json(
      {
        success: false,
        error: "INVALID_STATUS"
      },
      400
    );
  }

  if (!canWriteSeries(user, value)) {
    return json(
      {
        success: false,
        error: "FORBIDDEN"
      },
      403
    );
  }

  const referenceError =
    await validateSeriesReferences(
      env.DB,
      value,
      user
    );

  if (referenceError) {
    return json(
      {
        success: false,
        error: referenceError
      },
      referenceError.endsWith("_NOT_FOUND")
        ? 404
        : 409
    );
  }

  const result = await env.DB
    .prepare(`
      INSERT INTO schedule_series (
        title,
        circle_id,
        teacher_id,
        student_id,
        session_type,
        recurrence_type,
        interval_value,
        weekdays_json,
        start_date,
        end_date,
        start_time,
        end_time,
        timezone,
        status,
        notes,
        created_by,
        updated_by
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      RETURNING *
    `)
    .bind(
      value.title,
      value.circleId,
      value.teacherId,
      value.studentId,
      value.sessionType,
      value.recurrenceType,
      value.intervalValue,
      value.weekdaysJson,
      value.startDate,
      value.endDate,
      value.startTime,
      value.endTime,
      value.timezone,
      value.status,
      value.notes,
      user.id,
      user.id
    )
    .first();

  await audit(
    env.DB,
    user.id,
    "schedule_series.create",
    result?.id ?? null,
    null,
    result
  );

  return json(
    {
      success: true,
      data: result
    },
    201
  );
}

async function updateSeries(
  request,
  env,
  user,
  id
) {
  let current = null;

  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    current = await env.DB
      .prepare(`
        SELECT *
        FROM schedule_series
        WHERE id = ?
        LIMIT 1
      `)
      .bind(id)
      .first();
  } else if (
    user.role === "teacher" &&
    user.teacher_id
  ) {
    current = await env.DB
      .prepare(`
        SELECT *
        FROM schedule_series
        WHERE id = ?
          AND teacher_id = ?
        LIMIT 1
      `)
      .bind(
        id,
        Number(user.teacher_id)
      )
      .first();
  }

  if (!current) {
    return json(
      {
        success: false,
        error: "NOT_FOUND"
      },
      404
    );
  }

  const data = await request.json();

  const validation =
    validateInput(data, current);

  if (validation.error) {
    return json(
      {
        success: false,
        error: validation.error
      },
      400
    );
  }

  const value = validation.value;

  if (
    !validId(value.circleId) &&
    value.circleId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_CIRCLE_ID"
      },
      400
    );
  }

  if (
    !validId(value.teacherId) &&
    value.teacherId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_TEACHER_ID"
      },
      400
    );
  }

  if (
    !validId(value.studentId) &&
    value.studentId !== null
  ) {
    return json(
      {
        success: false,
        error: "INVALID_STUDENT_ID"
      },
      400
    );
  }

  if (!STATUSES.has(value.status)) {
    return json(
      {
        success: false,
        error: "INVALID_STATUS"
      },
      400
    );
  }

  if (!canWriteSeries(user, value, current)) {
    return json(
      {
        success: false,
        error: "FORBIDDEN"
      },
      403
    );
  }

  const referenceError =
    await validateSeriesReferences(
      env.DB,
      value,
      user
    );

  if (referenceError) {
    return json(
      {
        success: false,
        error: referenceError
      },
      referenceError.endsWith("_NOT_FOUND")
        ? 404
        : 409
    );
  }

  const result =
    await env.DB
      .prepare(`
        UPDATE schedule_series
        SET
          title = ?,
          circle_id = ?,
          teacher_id = ?,
          student_id = ?,
          session_type = ?,
          recurrence_type = ?,
          interval_value = ?,
          weekdays_json = ?,
          start_date = ?,
          end_date = ?,
          start_time = ?,
          end_time = ?,
          timezone = ?,
          status = ?,
          notes = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        RETURNING *
      `)
      .bind(
        value.title,
        value.circleId,
        value.teacherId,
        value.studentId,
        value.sessionType,
        value.recurrenceType,
        value.intervalValue,
        value.weekdaysJson,
        value.startDate,
        value.endDate,
        value.startTime,
        value.endTime,
        value.timezone,
        value.status,
        value.notes,
        user.id,
        id
      )
      .first();

  await audit(
    env.DB,
    user.id,
    "schedule_series.update",
    id,
    current,
    result
  );

  return json({
    success: true,
    data: result
  });
}

export async function onRequestGet({
  request,
  env
}) {
  const auth =
    await requirePermission(
      request,
      env,
      "schedule.series.read"
    );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url =
      new URL(request.url);

    const idValue =
      url.searchParams.get("id");

    const id =
      idValue
        ? Number(idValue)
        : null;

    if (
      id !== null &&
      !validId(id)
    ) {
      return json(
        {
          success: false,
          error: "INVALID_ID"
        },
        400
      );
    }

    const rows =
      await getSeries(
        env.DB,
        id,
        auth.user
      );

    return json({
      success: true,
      data: rows,
      count: rows.length,
      timezone: "Africa/Cairo"
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "SERVER_ERROR",
        message:
          error.message ||
          "تعذر تحميل سلاسل المواعيد."
      },
      500
    );
  }
}

export async function onRequestPost({
  request,
  env
}) {
  const auth =
    await requirePermission(
      request,
      env,
      "schedule.series.write"
    );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    return await createSeries(
      request,
      env,
      auth.user
    );
  } catch (error) {
    return json(
      {
        success: false,
        error: "SERVER_ERROR",
        message:
          error.message ||
          "تعذر إنشاء سلسلة الموعد."
      },
      500
    );
  }
}

export async function onRequestPatch({
  request,
  env
}) {
  const auth =
    await requirePermission(
      request,
      env,
      "schedule.series.write"
    );

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url =
      new URL(request.url);

    const id =
      Number(
        url.searchParams.get("id")
      );

    if (!validId(id)) {
      return json(
        {
          success: false,
          error: "INVALID_ID"
        },
        400
      );
    }

    return await updateSeries(
      request,
      env,
      auth.user,
      id
    );
  } catch (error) {
    return json(
      {
        success: false,
        error: "SERVER_ERROR",
        message:
          error.message ||
          "تعذر تعديل سلسلة الموعد."
      },
      500
    );
  }
}
