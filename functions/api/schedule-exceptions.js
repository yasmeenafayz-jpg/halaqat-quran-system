import { requirePermission } from "./_auth.js";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const EXCEPTION_TYPES = new Set([
  "cancelled",
  "rescheduled",
  "modified",
  "skipped",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function validId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clean(value));
}

function privileged(user) {
  return user?.role === "admin" || user?.role === "supervisor";
}

async function getSeries(db, id) {
  return db.prepare(`
    SELECT *
    FROM schedule_series
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();
}

async function getException(db, id) {
  return db.prepare(`
    SELECT
      se.*,
      ss.title AS series_title,
      ss.teacher_id AS series_teacher_id,
      ss.student_id AS series_student_id,
      ss.circle_id AS series_circle_id
    FROM schedule_exceptions se
    INNER JOIN schedule_series ss
      ON ss.id = se.series_id
    WHERE se.id = ?
    LIMIT 1
  `).bind(id).first();
}

async function canReadSeries(db, user, series) {
  if (!series || !user) return false;

  if (privileged(user)) return true;

  if (
    user.role === "teacher" &&
    user.teacher_id &&
    Number(series.teacher_id) === Number(user.teacher_id)
  ) {
    return true;
  }

  if (
    user.role === "student" &&
    user.student_id &&
    Number(series.student_id) === Number(user.student_id)
  ) {
    return true;
  }

  if (user.role === "guardian" && series.student_id) {
    const row = await db.prepare(`
      SELECT 1
      FROM student_guardians sg
      INNER JOIN guardians g
        ON g.id = sg.guardian_id
      WHERE sg.student_id = ?
        AND g.user_id = ?
        AND g.status = 'active'
      LIMIT 1
    `).bind(series.student_id, user.id).first();

    return !!row;
  }

  return false;
}

async function audit(db, userId, action, entityId, before, after) {
  try {
    await db.prepare(`
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
    `).bind(
      userId,
      action,
      "schedule_exception",
      entityId,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null
    ).run();
  } catch {
    // Do not fail the scheduling operation because audit logging failed.
  }
}

function parsePayload(data) {
  const seriesId = Number(
    data.series_id ?? data.seriesId ?? 0
  );

  const occurrenceDate = clean(
    data.occurrence_date ?? data.occurrenceDate
  );

  const exceptionType = clean(
    data.exception_type ?? data.exceptionType
  ).toLowerCase();

  const newDate =
    data.new_date !== undefined || data.newDate !== undefined
      ? clean(data.new_date ?? data.newDate) || null
      : null;

  const newStartTime =
    data.new_start_time !== undefined ||
    data.newStartTime !== undefined
      ? clean(data.new_start_time ?? data.newStartTime) || null
      : null;

  const newEndTime =
    data.new_end_time !== undefined ||
    data.newEndTime !== undefined
      ? clean(data.new_end_time ?? data.newEndTime) || null
      : null;

  const replacementRaw =
    data.replacement_teacher_id !== undefined
      ? data.replacement_teacher_id
      : data.replacementTeacherId;

  const replacementTeacherId =
    replacementRaw === undefined ||
    replacementRaw === null ||
    clean(replacementRaw) === ""
      ? null
      : Number(replacementRaw);

  const reason =
    data.reason !== undefined
      ? clean(data.reason) || null
      : null;

  if (!validId(seriesId)) {
    return { error: "INVALID_SERIES_ID" };
  }

  if (!validDate(occurrenceDate)) {
    return { error: "INVALID_OCCURRENCE_DATE" };
  }

  if (!EXCEPTION_TYPES.has(exceptionType)) {
    return { error: "INVALID_EXCEPTION_TYPE" };
  }

  if (newDate !== null && !validDate(newDate)) {
    return { error: "INVALID_NEW_DATE" };
  }

  if (newStartTime !== null && !validTime(newStartTime)) {
    return { error: "INVALID_NEW_START_TIME" };
  }

  if (newEndTime !== null && !validTime(newEndTime)) {
    return { error: "INVALID_NEW_END_TIME" };
  }

  if (
    replacementTeacherId !== null &&
    !validId(replacementTeacherId)
  ) {
    return { error: "INVALID_REPLACEMENT_TEACHER_ID" };
  }

  if (exceptionType === "rescheduled") {
    if (!newDate || !newStartTime || !newEndTime) {
      return {
        error: "RESCHEDULE_REQUIRES_DATE_AND_TIME",
      };
    }
  }

  if (exceptionType === "modified") {
    if (!newDate && !newStartTime && !newEndTime) {
      return {
        error: "MODIFIED_REQUIRES_CHANGE",
      };
    }

    if (
      (newStartTime && !newEndTime) ||
      (!newStartTime && newEndTime)
    ) {
      return {
        error: "MODIFIED_TIME_REQUIRES_START_AND_END",
      };
    }
  }

  return {
    value: {
      seriesId,
      occurrenceDate,
      exceptionType,
      newDate,
      newStartTime,
      newEndTime,
      replacementTeacherId,
      reason,
    },
  };
}

async function validateReplacementTeacher(db, id) {
  if (id === null) return null;

  const teacher = await db.prepare(`
    SELECT id, status
    FROM teachers
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();

  if (!teacher) return "REPLACEMENT_TEACHER_NOT_FOUND";

  if (
    teacher.status !== undefined &&
    teacher.status !== null &&
    teacher.status !== "active"
  ) {
    return "REPLACEMENT_TEACHER_NOT_ACTIVE";
  }

  return null;
}

async function createException(request, env, user) {
  let data;

  try {
    data = await request.json();
  } catch {
    return json(
      { success: false, error: "INVALID_JSON" },
      400
    );
  }

  const parsed = parsePayload(data || {});

  if (parsed.error) {
    return json(
      { success: false, error: parsed.error },
      400
    );
  }

  const value = parsed.value;

  const series = await getSeries(
    env.DB,
    value.seriesId
  );

  if (!series) {
    return json(
      { success: false, error: "SERIES_NOT_FOUND" },
      404
    );
  }

  if (!privileged(user)) {
    return json(
      { success: false, error: "FORBIDDEN" },
      403
    );
  }

  if (
    value.occurrenceDate < series.start_date ||
    (
      series.end_date &&
      value.occurrenceDate > series.end_date
    )
  ) {
    return json(
      {
        success: false,
        error: "OCCURRENCE_OUTSIDE_SERIES_RANGE",
      },
      409
    );
  }

  const replacementError =
    await validateReplacementTeacher(
      env.DB,
      value.replacementTeacherId
    );

  if (replacementError) {
    return json(
      { success: false, error: replacementError },
      replacementError.endsWith("_NOT_FOUND") ? 404 : 409
    );
  }

  const duplicate = await env.DB.prepare(`
    SELECT id
    FROM schedule_exceptions
    WHERE series_id = ?
      AND occurrence_date = ?
    LIMIT 1
  `).bind(
    value.seriesId,
    value.occurrenceDate
  ).first();

  if (duplicate) {
    return json(
      {
        success: false,
        error: "EXCEPTION_ALREADY_EXISTS",
        id: duplicate.id,
      },
      409
    );
  }

  const result = await env.DB.prepare(`
    INSERT INTO schedule_exceptions (
      series_id,
      occurrence_date,
      exception_type,
      new_date,
      new_start_time,
      new_end_time,
      replacement_teacher_id,
      reason,
      created_by,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    value.seriesId,
    value.occurrenceDate,
    value.exceptionType,
    value.newDate,
    value.newStartTime,
    value.newEndTime,
    value.replacementTeacherId,
    value.reason,
    user.id
  ).run();

  const id = result.meta?.last_row_id;

  const created = id
    ? await getException(env.DB, id)
    : null;

  await audit(
    env.DB,
    user.id,
    "schedule_exception.create",
    id,
    null,
    created
  );

  return json(
    {
      success: true,
      data: created,
    },
    201
  );
}

async function updateException(request, env, user, id) {
  const current = await getException(env.DB, id);

  if (!current) {
    return json(
      { success: false, error: "NOT_FOUND" },
      404
    );
  }

  if (!privileged(user)) {
    return json(
      { success: false, error: "FORBIDDEN" },
      403
    );
  }

  let data;

  try {
    data = await request.json();
  } catch {
    return json(
      { success: false, error: "INVALID_JSON" },
      400
    );
  }

  const parsed = parsePayload({
    ...data,
    series_id: data.series_id ?? current.series_id,
    occurrence_date:
      data.occurrence_date ??
      data.occurrenceDate ??
      current.occurrence_date,
    exception_type:
      data.exception_type ??
      data.exceptionType ??
      current.exception_type,
  });

  if (parsed.error) {
    return json(
      { success: false, error: parsed.error },
      400
    );
  }

  const value = parsed.value;

  if (value.seriesId !== Number(current.series_id)) {
    return json(
      {
        success: false,
        error: "SERIES_CHANGE_NOT_ALLOWED",
      },
      400
    );
  }

  const series = await getSeries(
    env.DB,
    value.seriesId
  );

  if (!series) {
    return json(
      { success: false, error: "SERIES_NOT_FOUND" },
      404
    );
  }

  const replacementError =
    await validateReplacementTeacher(
      env.DB,
      value.replacementTeacherId
    );

  if (replacementError) {
    return json(
      { success: false, error: replacementError },
      replacementError.endsWith("_NOT_FOUND") ? 404 : 409
    );
  }

  if (
    value.occurrenceDate < series.start_date ||
    (
      series.end_date &&
      value.occurrenceDate > series.end_date
    )
  ) {
    return json(
      {
        success: false,
        error: "OCCURRENCE_OUTSIDE_SERIES_RANGE",
      },
      409
    );
  }

  const duplicate = await env.DB.prepare(`
    SELECT id
    FROM schedule_exceptions
    WHERE series_id = ?
      AND occurrence_date = ?
      AND id <> ?
    LIMIT 1
  `).bind(
    value.seriesId,
    value.occurrenceDate,
    id
  ).first();

  if (duplicate) {
    return json(
      {
        success: false,
        error: "EXCEPTION_ALREADY_EXISTS",
        id: duplicate.id,
      },
      409
    );
  }

  await env.DB.prepare(`
    UPDATE schedule_exceptions
    SET
      occurrence_date = ?,
      exception_type = ?,
      new_date = ?,
      new_start_time = ?,
      new_end_time = ?,
      replacement_teacher_id = ?,
      reason = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    value.occurrenceDate,
    value.exceptionType,
    value.newDate,
    value.newStartTime,
    value.newEndTime,
    value.replacementTeacherId,
    value.reason,
    id
  ).run();

  const updated = await getException(
    env.DB,
    id
  );

  await audit(
    env.DB,
    user.id,
    "schedule_exception.update",
    id,
    current,
    updated
  );

  return json({
    success: true,
    data: updated,
  });
}

export async function onRequestGet({ request, env }) {
  const auth = await requirePermission(
    request,
    env,
    "schedule.series.read"
  );

  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const seriesId = url.searchParams.get("series_id");

    if (id !== null) {
      if (!validId(id)) {
        return json(
          { success: false, error: "INVALID_ID" },
          400
        );
      }

      const exception = await getException(
        env.DB,
        Number(id)
      );

      if (!exception) {
        return json(
          { success: false, error: "NOT_FOUND" },
          404
        );
      }

      const series = await getSeries(
        env.DB,
        exception.series_id
      );

      if (!await canReadSeries(
        env.DB,
        auth.user,
        series
      )) {
        return json(
          { success: false, error: "FORBIDDEN" },
          403
        );
      }

      return json({
        success: true,
        data: exception,
      });
    }

    if (seriesId !== null && !validId(seriesId)) {
      return json(
        { success: false, error: "INVALID_SERIES_ID" },
        400
      );
    }

    if (seriesId !== null) {
      const series = await getSeries(
        env.DB,
        Number(seriesId)
      );

      if (!series) {
        return json(
          { success: false, error: "SERIES_NOT_FOUND" },
          404
        );
      }

      if (!await canReadSeries(
        env.DB,
        auth.user,
        series
      )) {
        return json(
          { success: false, error: "FORBIDDEN" },
          403
        );
      }

      const result = await env.DB.prepare(`
        SELECT *
        FROM schedule_exceptions
        WHERE series_id = ?
        ORDER BY occurrence_date ASC, id ASC
      `).bind(Number(seriesId)).all();

      return json({
        success: true,
        data: result.results || [],
      });
    }

    return json({
      success: true,
      data: [],
    });
  } catch (error) {
    console.error("schedule-exceptions GET", error);

    return json(
      { success: false, error: "SERVER_ERROR" },
      500
    );
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await requirePermission(
    request,
    env,
    "schedule.exceptions.write"
  );

  if (!auth.ok) return auth.response;

  try {
    return await createException(
      request,
      env,
      auth.user
    );
  } catch (error) {
    console.error("schedule-exceptions POST", error);

    return json(
      { success: false, error: "SERVER_ERROR" },
      500
    );
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await requirePermission(
    request,
    env,
    "schedule.exceptions.write"
  );

  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const id = Number(
      url.searchParams.get("id")
    );

    if (!validId(id)) {
      return json(
        { success: false, error: "INVALID_ID" },
        400
      );
    }

    return await updateException(
      request,
      env,
      auth.user,
      id
    );
  } catch (error) {
    console.error("schedule-exceptions PATCH", error);

    return json(
      { success: false, error: "SERVER_ERROR" },
      500
    );
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await requirePermission(
    request,
    env,
    "schedule.exceptions.write"
  );

  if (!auth.ok) return auth.response;

  try {
    if (!privileged(auth.user)) {
      return json(
        { success: false, error: "FORBIDDEN" },
        403
      );
    }

    const url = new URL(request.url);
    const id = Number(
      url.searchParams.get("id")
    );

    if (!validId(id)) {
      return json(
        { success: false, error: "INVALID_ID" },
        400
      );
    }

    const current = await getException(
      env.DB,
      id
    );

    if (!current) {
      return json(
        { success: false, error: "NOT_FOUND" },
        404
      );
    }

    await env.DB.prepare(`
      DELETE FROM schedule_exceptions
      WHERE id = ?
    `).bind(id).run();

    await audit(
      env.DB,
      auth.user.id,
      "schedule_exception.delete",
      id,
      current,
      null
    );

    return json({
      success: true,
      deleted: id,
    });
  } catch (error) {
    console.error("schedule-exceptions DELETE", error);

    return json(
      { success: false, error: "SERVER_ERROR" },
      500
    );
  }
}
