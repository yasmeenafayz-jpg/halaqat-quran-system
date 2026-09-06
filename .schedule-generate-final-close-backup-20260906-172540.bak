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

const MAX_GENERATION_DAYS = 366;

function parseDate(value) {
  const text = clean(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    return null;
  }

  return date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, amount) {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  date.setUTCDate(
    date.getUTCDate() + amount
  );

  return formatDate(date);
}

function daysBetween(start, end) {
  const a = parseDate(start);
  const b = parseDate(end);

  if (!a || !b) {
    return null;
  }

  return Math.floor(
    (b.getTime() - a.getTime()) /
      86400000
  );
}

function parseWeekdays(value, fallbackDate) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    const date = parseDate(fallbackDate);

    return date
      ? [date.getUTCDay()]
      : [];
  }

  try {
    const parsed =
      Array.isArray(value)
        ? value
        : JSON.parse(String(value));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .map(Number)
          .filter(
            (day) =>
              Number.isInteger(day) &&
              day >= 0 &&
              day <= 6
          )
      )
    ];
  } catch {
    return [];
  }
}

function isDateInRange(
  date,
  startDate,
  endDate
) {
  return (
    date >= startDate &&
    (!endDate || date <= endDate)
  );
}

function isOccurrence(
  series,
  date
) {
  const startDate = clean(
    series.start_date
  );

  const endDate =
    clean(series.end_date) || null;

  if (
    !isDateInRange(
      date,
      startDate,
      endDate
    )
  ) {
    return false;
  }

  const recurrence =
    clean(
      series.recurrence_type
    ).toLowerCase();

  const interval = Math.max(
    1,
    Number(series.interval_value || 1)
  );

  if (
    !RECURRENCE_TYPES.has(
      recurrence
    )
  ) {
    return false;
  }

  if (recurrence === "once") {
    return date === startDate;
  }

  const difference =
    daysBetween(
      startDate,
      date
    );

  if (
    difference === null ||
    difference < 0
  ) {
    return false;
  }

  if (recurrence === "daily") {
    return difference % interval === 0;
  }

  const current =
    parseDate(date);

  const start =
    parseDate(startDate);

  if (!current || !start) {
    return false;
  }

  if (
    recurrence === "weekly" ||
    recurrence === "biweekly" ||
    recurrence === "custom"
  ) {
    const weekdays =
      parseWeekdays(
        series.weekdays_json,
        startDate
      );

    if (
      !weekdays.includes(
        current.getUTCDay()
      )
    ) {
      return false;
    }

    const weeks = Math.floor(
      difference / 7
    );

    const weekInterval =
      recurrence === "biweekly"
        ? 2 * interval
        : interval;

    return (
      weeks % weekInterval === 0
    );
  }

  if (recurrence === "monthly") {
    const startMonth =
      start.getUTCFullYear() * 12 +
      start.getUTCMonth();

    const currentMonth =
      current.getUTCFullYear() * 12 +
      current.getUTCMonth();

    const monthDifference =
      currentMonth - startMonth;

    return (
      monthDifference >= 0 &&
      monthDifference % interval === 0 &&
      current.getUTCDate() ===
        start.getUTCDate()
    );
  }

  return false;
}

function getException(
  exceptions,
  seriesId,
  occurrenceDate
) {
  return exceptions.find(
    (item) =>
      Number(item.series_id) ===
        Number(seriesId) &&
      item.occurrence_date ===
        occurrenceDate
  ) || null;
}

function applyException(
  occurrence,
  exception
) {
  if (!exception) {
    return occurrence;
  }

  const type =
    clean(
      exception.exception_type
    ).toLowerCase();

  if (
    type === "cancelled" ||
    type === "skipped"
  ) {
    return null;
  }

  const result = {
    ...occurrence
  };

  if (
    type === "rescheduled"
  ) {
    if (exception.new_date) {
      result.session_date =
        exception.new_date;
    }

    if (exception.new_start_time) {
      result.start_time =
        exception.new_start_time;
    }

    if (exception.new_end_time) {
      result.end_time =
        exception.new_end_time;
    }
  }

  if (
    type === "modified"
  ) {
    if (exception.new_date) {
      result.session_date =
        exception.new_date;
    }

    if (exception.new_start_time) {
      result.start_time =
        exception.new_start_time;
    }

    if (exception.new_end_time) {
      result.end_time =
        exception.new_end_time;
    }
  }

  if (
    exception.replacement_teacher_id
  ) {
    result.teacher_id =
      Number(
        exception.replacement_teacher_id
      );
  }

  return result;
}

async function audit(
  db,
  userId,
  action,
  entityId,
  details
) {
  try {
    await db
      .prepare(`
        INSERT INTO audit_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          new_values,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .bind(
        userId ?? null,
        action,
        "schedule_generation",
        entityId ?? null,
        JSON.stringify(details || {})
      )
      .run();
  } catch {
    // Audit failure must not cancel generation.
  }
}

async function canUseSeries(
  db,
  user,
  series
) {
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (user.role === "teacher") {
    return (
      Number(series.teacher_id) ===
      Number(user.teacher_id)
    );
  }

  if (user.role === "student") {
    return (
      Number(series.student_id) ===
      Number(user.student_id)
    );
  }

  if (user.role === "guardian") {
    return false;
  }

  return false;
}

async function loadSeries(
  db,
  user,
  seriesId = null
) {
  let sql = `
    SELECT *
    FROM schedule_series
    WHERE status = 'active'
  `;

  const params = [];

  if (seriesId !== null) {
    sql += ` AND id = ?`;
    params.push(seriesId);
  }

  if (user.role === "teacher") {
    sql += ` AND teacher_id = ?`;
    params.push(
      Number(user.teacher_id)
    );
  } else if (user.role === "student") {
    sql += ` AND student_id = ?`;
    params.push(
      Number(user.student_id)
    );
  } else if (
    user.role !== "admin" &&
    user.role !== "supervisor"
  ) {
    sql += ` AND 1 = 0`;
  }

  sql += `
    ORDER BY
      start_date ASC,
      start_time ASC,
      id ASC
  `;

  const result =
    await db
      .prepare(sql)
      .bind(...params)
      .all();

  return result.results || [];
}

async function loadExceptions(
  db,
  seriesIds
) {
  if (!seriesIds.length) {
    return [];
  }

  const placeholders =
    seriesIds
      .map(() => "?")
      .join(",");

  const result =
    await db
      .prepare(`
        SELECT *
        FROM schedule_exceptions
        WHERE series_id IN (
          ${placeholders}
        )
        ORDER BY
          occurrence_date ASC,
          id ASC
      `)
      .bind(...seriesIds)
      .all();

  return result.results || [];
}

async function sessionExists(
  db,
  seriesId,
  occurrenceDate,
  sessionDate
) {
  const result =
    await db
      .prepare(`
        SELECT id
        FROM sessions
        WHERE series_id = ?
          AND series_occurrence_date = ?
        LIMIT 1
      `)
      .bind(
        seriesId,
        occurrenceDate
      )
      .first();

  if (result) {
    return true;
  }

  if (sessionDate !== occurrenceDate) {
    const moved =
      await db
        .prepare(`
          SELECT id
          FROM sessions
          WHERE series_id = ?
            AND session_date = ?
          LIMIT 1
        `)
        .bind(
          seriesId,
          sessionDate
        )
        .first();

    return !!moved;
  }

  return false;
}

async function generateSeries(
  db,
  series,
  exceptions,
  rangeStart,
  rangeEnd
) {
  const startDate = clean(
    series.start_date
  );

  const seriesEnd =
    clean(series.end_date) ||
    rangeEnd;

  let cursor = rangeStart;

  const effectiveStart =
    cursor > startDate
      ? cursor
      : startDate;

  cursor = effectiveStart;

  const created = [];
  const skipped = [];
  const cancelled = [];

  const maxDays =
    Math.min(
      MAX_GENERATION_DAYS,
      Math.max(
        0,
        daysBetween(
          rangeStart,
          rangeEnd
        ) ?? 0
      )
    );

  for (
    let offset = 0;
    offset <= maxDays;
    offset++
  ) {
    const date =
      addDays(
        cursor,
        offset
      );

    if (!date) {
      continue;
    }

    if (
      date > rangeEnd ||
      date > seriesEnd
    ) {
      break;
    }

    if (
      !isOccurrence(
        series,
        date
      )
    ) {
      continue;
    }

    const exception =
      getException(
        exceptions,
        series.id,
        date
      );

    const occurrence = {
      session_date: date,
      start_time:
        series.start_time,
      end_time:
        series.end_time,
      teacher_id:
        series.teacher_id,
      circle_id:
        series.circle_id,
      student_id:
        series.student_id,
      session_type:
        series.session_type,
      status: "scheduled"
    };

    const effective =
      applyException(
        occurrence,
        exception
      );

    if (!effective) {
      cancelled.push({
        occurrence_date: date,
        exception_type:
          exception?.exception_type ||
          "cancelled"
      });
      continue;
    }

    if (
      !isDateInRange(
        effective.session_date,
        rangeStart,
        rangeEnd
      )
    ) {
      skipped.push({
        occurrence_date: date,
        reason:
          "RESCHEDULED_OUTSIDE_RANGE",
        session_date:
          effective.session_date
      });
      continue;
    }

    const exists =
      await sessionExists(
        db,
        series.id,
        date,
        effective.session_date
      );

    if (exists) {
      skipped.push({
        occurrence_date: date,
        reason: "ALREADY_EXISTS"
      });
      continue;
    }

    if (
      effective.teacher_id !== null &&
      effective.teacher_id !== undefined &&
      !validId(
        Number(
          effective.teacher_id
        )
      )
    ) {
      skipped.push({
        occurrence_date: date,
        reason: "INVALID_TEACHER"
      });
      continue;
    }

    if (
      !SESSION_TYPES.has(
        clean(
          effective.session_type
        ).toLowerCase()
      )
    ) {
      skipped.push({
        occurrence_date: date,
        reason: "INVALID_SESSION_TYPE"
      });
      continue;
    }

    try {
      const result =
        await db
          .prepare(`
            INSERT INTO sessions (
              circle_id,
              teacher_id,
              student_id,
              session_type,
              session_date,
              start_time,
              end_time,
              meeting_provider,
              meeting_url,
              status,
              notes,
              created_at,
              updated_at,
              series_id,
              series_occurrence_date
            )
            VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP, ?, ?
            )
            RETURNING id
          `)
          .bind(
            effective.circle_id ??
              null,
            effective.teacher_id ??
              null,
            effective.student_id ??
              null,
            effective.session_type,
            effective.session_date,
            effective.start_time,
            effective.end_time,
            null,
            null,
            "scheduled",
            series.title ||
              null,
            series.id,
            date
          )
          .first();

      created.push({
        id: result?.id ?? null,
        occurrence_date: date,
        session_date:
          effective.session_date
      });
    } catch (error) {
      skipped.push({
        occurrence_date: date,
        reason: "INSERT_FAILED",
        message:
          error.message ||
          "INSERT_FAILED"
      });
    }
  }

  return {
    created,
    skipped,
    cancelled
  };
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
    const url =
      new URL(request.url);

    const body =
      await request.json().catch(
        () => ({})
      );

    const seriesIdValue =
      body.series_id ??
      url.searchParams.get(
        "series_id"
      );

    const seriesId =
      seriesIdValue !== null &&
      seriesIdValue !== undefined &&
      seriesIdValue !== ""
        ? Number(seriesIdValue)
        : null;

    if (
      seriesId !== null &&
      !validId(seriesId)
    ) {
      return json(
        {
          success: false,
          error: "INVALID_SERIES_ID"
        },
        400
      );
    }

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    const rangeStart =
      clean(
        body.start_date ??
        url.searchParams.get(
          "start_date"
        ) ??
        today
      );

    const rangeEnd =
      clean(
        body.end_date ??
        url.searchParams.get(
          "end_date"
        ) ??
        rangeStart
      );

    if (
      !parseDate(rangeStart) ||
      !parseDate(rangeEnd)
    ) {
      return json(
        {
          success: false,
          error: "INVALID_DATE_RANGE"
        },
        400
      );
    }

    if (rangeEnd < rangeStart) {
      return json(
        {
          success: false,
          error: "INVALID_DATE_RANGE"
        },
        400
      );
    }

    const requestedDays =
      daysBetween(
        rangeStart,
        rangeEnd
      );

    if (
      requestedDays === null ||
      requestedDays >
        MAX_GENERATION_DAYS
    ) {
      return json(
        {
          success: false,
          error: "RANGE_TOO_LARGE",
          message:
            "لا يمكن توليد أكثر من سنة واحدة في الطلب."
        },
        400
      );
    }

    const series =
      await loadSeries(
        env.DB,
        auth.user,
        seriesId
      );

    if (
      seriesId !== null &&
      !series.length
    ) {
      return json(
        {
          success: false,
          error: "SERIES_NOT_FOUND_OR_FORBIDDEN"
        },
        404
      );
    }

    const seriesIds =
      series.map(
        (item) =>
          Number(item.id)
      );

    const exceptions =
      await loadExceptions(
        env.DB,
        seriesIds
      );

    const totals = {
      series: series.length,
      created: 0,
      skipped: 0,
      cancelled: 0
    };

    const details = [];

    for (const item of series) {
      if (
        !(await canUseSeries(
          env.DB,
          auth.user,
          item
        ))
      ) {
        continue;
      }

      const itemExceptions =
        exceptions.filter(
          (exception) =>
            Number(
              exception.series_id
            ) ===
            Number(item.id)
        );

      const result =
        await generateSeries(
          env.DB,
          item,
          itemExceptions,
          rangeStart,
          rangeEnd
        );

      totals.created +=
        result.created.length;

      totals.skipped +=
        result.skipped.length;

      totals.cancelled +=
        result.cancelled.length;

      details.push({
        series_id: item.id,
        title: item.title,
        created:
          result.created,
        skipped:
          result.skipped,
        cancelled:
          result.cancelled
      });

      await audit(
        env.DB,
        auth.user.id,
        "schedule.generate",
        item.id,
        {
          range_start: rangeStart,
          range_end: rangeEnd,
          created:
            result.created.length,
          skipped:
            result.skipped.length,
          cancelled:
            result.cancelled.length
        }
      );
    }

    return json({
      success: true,
      timezone: "Africa/Cairo",
      range: {
        start_date: rangeStart,
        end_date: rangeEnd
      },
      totals,
      details
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "SERVER_ERROR",
        message:
          error.message ||
          "تعذر توليد الجلسات."
      },
      500
    );
  }
}
