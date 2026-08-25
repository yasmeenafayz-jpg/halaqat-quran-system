import { requirePermission } from "./_auth.js";
/**
 * الأوَّابين — Sessions API
 *
 * GET    /api/sessions
 * GET    /api/sessions?id=1
 * POST   /api/sessions
 * PATCH  /api/sessions
 *
 * يدعم:
 * - جلسات القرآن
 * - القاعدة النورانية
 * - التفسير
 * - الفقه
 * - الحديث
 * - السيرة
 * - ربط الجلسة بالحلقة والمعلم
 * - Zoom / Microsoft Teams وأي مزود اجتماعات آخر
 * - التحقق من الوقت والتاريخ
 * - منع تعارض جلسات المعلم
 * - حالات الجلسة
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const SESSION_TYPES = [
  "quran",
  "noorani",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
];

const SESSION_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "rescheduled",
];

const MEETING_PROVIDERS = [
  "zoom",
  "teams",
  "microsoft_teams",
  "other",
];

/* =========================================================
   Helpers
========================================================= */

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
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  );
}

function normalizeProvider(value) {
  const provider =
    clean(value).toLowerCase();

  if (!provider) {
    return null;
  }

  if (
    provider === "microsoft teams" ||
    provider === "microsoft_teams"
  ) {
    return "teams";
  }

  return provider;
}

function timeToMinutes(value) {
  const match =
    /^(\d{1,2}):(\d{2})$/.exec(
      clean(value)
    );

  if (!match) {
    return null;
  }

  const hours =
    Number(match[1]);

  const minutes =
    Number(match[2]);

  if (
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return (
    hours * 60 +
    minutes
  );
}

function validDate(value) {
  const date =
    clean(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(
    date
  );
}

function validTime(value) {
  return (
    timeToMinutes(value) !== null
  );
}

function now() {
  return new Date().toISOString();
}

/* =========================================================
   Related records
========================================================= */

async function getCircle(
  db,
  circleId
) {
  if (!circleId) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        c.id,
        c.name,
        c.circle_type,
        c.teacher_id,
        c.package_id,
        c.capacity,
        c.status,
        t.full_name AS teacher_name,
        t.status AS teacher_status
      FROM circles c
      LEFT JOIN teachers t
        ON t.id = c.teacher_id
      WHERE c.id = ?1
      LIMIT 1
    `)
    .bind(circleId)
    .first();
}

async function getTeacher(
  db,
  teacherId
) {
  if (!teacherId) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        id,
        full_name,
        status
      FROM teachers
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(teacherId)
    .first();
}

/* =========================================================
   Conflict detection
========================================================= */

async function hasTeacherConflict(
  db,
  teacherId,
  sessionDate,
  startTime,
  endTime,
  excludeSessionId = null
) {
  if (!teacherId) {
    return false;
  }

  const startMinutes =
    timeToMinutes(
      startTime
    );

  const endMinutes =
    timeToMinutes(
      endTime
    );

  if (
    startMinutes === null ||
    endMinutes === null
  ) {
    return false;
  }

  let sql = `
    SELECT
      id,
      start_time,
      end_time
    FROM sessions
    WHERE teacher_id = ?1
      AND session_date = ?2
      AND status IN (
        'scheduled',
        'rescheduled'
      )
  `;

  const params = [
    teacherId,
    sessionDate,
  ];

  if (
    excludeSessionId
  ) {
    params.push(
      excludeSessionId
    );

    sql += `
      AND id != ?${params.length}
    `;
  }

  const result =
    await db
      .prepare(sql)
      .bind(...params)
      .all();

  const sessions =
    result.results || [];

  return sessions.some(
    (session) => {
      const existingStart =
        timeToMinutes(
          session.start_time
        );

      const existingEnd =
        timeToMinutes(
          session.end_time
        );

      if (
        existingStart === null ||
        existingEnd === null
      ) {
        return false;
      }

      return (
        startMinutes <
          existingEnd &&
        endMinutes >
          existingStart
      );
    }
  );
}

/* =========================================================
   Session with relations
========================================================= */

async function getSessionById(
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
        s.meeting_provider,
        s.meeting_url,
        s.status,
        s.notes,
        s.created_at,
        s.updated_at,

        c.name AS circle_name,
        c.circle_type,
        c.capacity AS circle_capacity,

        t.full_name AS teacher_name,
        t.status AS teacher_status

      FROM sessions s

      LEFT JOIN circles c
        ON c.id = s.circle_id

      LEFT JOIN teachers t
        ON t.id = s.teacher_id

      WHERE s.id = ?1
      LIMIT 1
    `)
    .bind(sessionId)
    .first();
}

/* =========================================================
   Validate input
========================================================= */

function validateSchedule(
  sessionDate,
  startTime,
  endTime
) {
  if (
    !validDate(sessionDate)
  ) {
    return "INVALID_SESSION_DATE";
  }

  if (
    !validTime(startTime)
  ) {
    return "INVALID_START_TIME";
  }

  if (
    !validTime(endTime)
  ) {
    return "INVALID_END_TIME";
  }

  const start =
    timeToMinutes(startTime);

  const end =
    timeToMinutes(endTime);

  if (end <= start) {
    return "END_TIME_MUST_BE_AFTER_START_TIME";
  }

  return null;
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const permission = await requirePermission(
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

  const url =
    new URL(
      context.request.url
    );

  const sessionId =
    url.searchParams.get("id");

  const circleId =
    url.searchParams.get(
      "circle_id"
    );

  const teacherId =
    url.searchParams.get(
      "teacher_id"
    );

  const sessionDate =
    clean(
      url.searchParams.get(
        "session_date"
      )
    );

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    );

  const sessionType =
    clean(
      url.searchParams.get(
        "session_type"
      )
    );

  try {
    if (sessionId) {
      if (
        !validId(sessionId)
      ) {
        return errorResponse(
          "INVALID_SESSION_ID"
        );
      }

      const session =
        await getSessionById(
          db,
          sessionId
        );

      if (!session) {
        return errorResponse(
          "SESSION_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: session,
      });
    }

    let sql = `
      SELECT
        s.id,
        s.circle_id,
        s.teacher_id,
        s.session_type,
        s.session_date,
        s.start_time,
        s.end_time,
        s.meeting_provider,
        s.meeting_url,
        s.status,
        s.notes,
        s.created_at,
        s.updated_at,

        c.name AS circle_name,
        c.circle_type,

        t.full_name AS teacher_name

      FROM sessions s

      LEFT JOIN circles c
        ON c.id = s.circle_id

      LEFT JOIN teachers t
        ON t.id = s.teacher_id

      WHERE 1 = 1
    `;

    const params = [];

    if (circleId) {
      if (
        !validId(circleId)
      ) {
        return errorResponse(
          "INVALID_CIRCLE_ID"
        );
      }

      params.push(
        Number(circleId)
      );

      sql += `
        AND s.circle_id = ?${params.length}
      `;
    }

    if (teacherId) {
      if (
        !validId(teacherId)
      ) {
        return errorResponse(
          "INVALID_TEACHER_ID"
        );
      }

      params.push(
        Number(teacherId)
      );

      sql += `
        AND s.teacher_id = ?${params.length}
      `;
    }

    if (sessionDate) {
      if (
        !validDate(
          sessionDate
        )
      ) {
        return errorResponse(
          "INVALID_SESSION_DATE"
        );
      }

      params.push(
        sessionDate
      );

      sql += `
        AND s.session_date = ?${params.length}
      `;
    }

    if (status) {
      if (
        !SESSION_STATUSES.includes(
          status
        )
      ) {
        return errorResponse(
          "INVALID_SESSION_STATUS"
        );
      }

      params.push(status);

      sql += `
        AND s.status = ?${params.length}
      `;
    }

    if (sessionType) {
      if (
        !SESSION_TYPES.includes(
          sessionType
        )
      ) {
        return errorResponse(
          "INVALID_SESSION_TYPE"
        );
      }

      params.push(
        sessionType
      );

      sql += `
        AND s.session_type = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        s.session_date ASC,
        s.start_time ASC,
        s.id ASC
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
      "SESSIONS_GET_FAILED",
      e
    );

    return errorResponse(
      "SESSIONS_FETCH_FAILED",
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
  const permission = await requirePermission(
    context.request,
    context.env,
    "sessions.write"
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

  const circleId =
    data.circle_id !==
      undefined &&
    data.circle_id !== null &&
    data.circle_id !== ""
      ? Number(data.circle_id)
      : null;

  const teacherId =
    data.teacher_id !==
      undefined &&
    data.teacher_id !== null &&
    data.teacher_id !== ""
      ? Number(data.teacher_id)
      : null;

  const sessionType =
    clean(
      data.session_type ??
      "quran"
    ).toLowerCase();

  const sessionDate =
    clean(
      data.session_date
    );

  const startTime =
    clean(
      data.start_time
    );

  const endTime =
    clean(
      data.end_time
    );

  const provider =
    normalizeProvider(
      data.meeting_provider
    );

  const meetingUrl =
    nullable(
      data.meeting_url
    );

  const status =
    clean(
      data.status ||
      "scheduled"
    ).toLowerCase();

  const notes =
    nullable(
      data.notes
    );

  if (
    !SESSION_TYPES.includes(
      sessionType
    )
  ) {
    return errorResponse(
      "INVALID_SESSION_TYPE"
    );
  }

  if (
    !SESSION_STATUSES.includes(
      status
    )
  ) {
    return errorResponse(
      "INVALID_SESSION_STATUS"
    );
  }

  const scheduleError =
    validateSchedule(
      sessionDate,
      startTime,
      endTime
    );

  if (scheduleError) {
    return errorResponse(
      scheduleError
    );
  }

  if (
    circleId !== null &&
    !validId(circleId)
  ) {
    return errorResponse(
      "INVALID_CIRCLE_ID"
    );
  }

  if (
    teacherId !== null &&
    !validId(teacherId)
  ) {
    return errorResponse(
      "INVALID_TEACHER_ID"
    );
  }

  if (
    provider &&
    !MEETING_PROVIDERS.includes(
      provider
    )
  ) {
    return errorResponse(
      "INVALID_MEETING_PROVIDER"
    );
  }

  if (
    provider &&
    !meetingUrl
  ) {
    return errorResponse(
      "MEETING_URL_REQUIRED"
    );
  }

  try {
    let circle = null;

    if (circleId) {
      circle =
        await getCircle(
          db,
          circleId
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      if (
        circle.status ===
          "archived" ||
        circle.status ===
          "inactive"
      ) {
        return errorResponse(
          "CIRCLE_NOT_AVAILABLE",
          409
        );
      }
    }

    let teacher = null;

    if (teacherId) {
      teacher =
        await getTeacher(
          db,
          teacherId
        );

      if (!teacher) {
        return errorResponse(
          "TEACHER_NOT_FOUND",
          404
        );
      }

      if (
        teacher.status !==
        "active"
      ) {
        return errorResponse(
          "TEACHER_IS_NOT_ACTIVE",
          409
        );
      }
    }

    /*
     * إذا كانت الحلقة مرتبطة بمعلم
     * ولم يتم إرسال teacher_id،
     * نستخدم معلم الحلقة.
     */
    const finalTeacherId =
      teacherId ||
      circle?.teacher_id ||
      null;

    if (
      finalTeacherId
    ) {
      const conflict =
        await hasTeacherConflict(
          db,
          finalTeacherId,
          sessionDate,
          startTime,
          endTime
        );

      if (conflict) {
        return errorResponse(
          "TEACHER_HAS_SCHEDULE_CONFLICT",
          409
        );
      }
    }

    const createdAt =
      now();

    const result =
      await db
        .prepare(`
          INSERT INTO sessions (
            circle_id,
            teacher_id,
            session_type,
            session_date,
            start_time,
            end_time,
            meeting_provider,
            meeting_url,
            status,
            notes,
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
            ?7,
            ?8,
            ?9,
            ?10,
            ?11,
            ?11
          )
        `)
        .bind(
          circleId,
          finalTeacherId,
          sessionType,
          sessionDate,
          startTime,
          endTime,
          provider,
          meetingUrl,
          status,
          notes,
          createdAt
        )
        .run();

    const sessionId =
      result.meta?.last_row_id;

    const created =
      await getSessionById(
        db,
        sessionId
      );

    return json(
      {
        success: true,
        message:
          "SESSION_CREATED_SUCCESSFULLY",
        data: created,
      },
      201
    );
  } catch (e) {
    console.error(
      "SESSIONS_POST_FAILED",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "SESSION_CREATE_FAILED",
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
  const permission = await requirePermission(
    context.request,
    context.env,
    "sessions.write"
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

  let data;

  try {
    data =
      await context.request.json();
  } catch {
    return errorResponse(
      "INVALID_JSON"
    );
  }

  const sessionId =
    data.id ??
    data.session_id ??
    data.sessionId;

  if (
    !validId(sessionId)
  ) {
    return errorResponse(
      "SESSION_ID_REQUIRED"
    );
  }

  try {
    const current =
      await getSessionById(
        db,
        sessionId
      );

    if (!current) {
      return errorResponse(
        "SESSION_NOT_FOUND",
        404
      );
    }

    const circleId =
      data.circle_id !==
        undefined ||
      data.circleId !==
        undefined
        ? (
            data.circle_id ??
            data.circleId
          ) === null ||
          (
            data.circle_id ??
            data.circleId
          ) === ""
          ? null
          : Number(
              data.circle_id ??
              data.circleId
            )
        : current.circle_id;

    const teacherId =
      data.teacher_id !==
        undefined ||
      data.teacherId !==
        undefined
        ? (
            data.teacher_id ??
            data.teacherId
          ) === null ||
          (
            data.teacher_id ??
            data.teacherId
          ) === ""
          ? null
          : Number(
              data.teacher_id ??
              data.teacherId
            )
        : current.teacher_id;

    const sessionType =
      data.session_type !==
        undefined
        ? clean(
            data.session_type
          ).toLowerCase()
        : current.session_type;

    const sessionDate =
      data.session_date !==
        undefined
        ? clean(
            data.session_date
          )
        : current.session_date;

    const startTime =
      data.start_time !==
        undefined
        ? clean(
            data.start_time
          )
        : current.start_time;

    const endTime =
      data.end_time !==
        undefined
        ? clean(
            data.end_time
          )
        : current.end_time;

    const provider =
      data.meeting_provider !==
        undefined
        ? normalizeProvider(
            data.meeting_provider
          )
        : current.meeting_provider;

    const meetingUrl =
      data.meeting_url !==
        undefined
        ? nullable(
            data.meeting_url
          )
        : current.meeting_url;

    const status =
      data.status !==
        undefined
        ? clean(
            data.status
          ).toLowerCase()
        : current.status;

    const notes =
      data.notes !==
        undefined
        ? nullable(
            data.notes
          )
        : current.notes;

    if (
      !SESSION_TYPES.includes(
        sessionType
      )
    ) {
      return errorResponse(
        "INVALID_SESSION_TYPE"
      );
    }

    if (
      !SESSION_STATUSES.includes(
        status
      )
    ) {
      return errorResponse(
        "INVALID_SESSION_STATUS"
      );
    }

    const scheduleError =
      validateSchedule(
        sessionDate,
        startTime,
        endTime
      );

    if (scheduleError) {
      return errorResponse(
        scheduleError
      );
    }

    if (
      circleId !== null &&
      !validId(circleId)
    ) {
      return errorResponse(
        "INVALID_CIRCLE_ID"
      );
    }

    if (
      teacherId !== null &&
      !validId(teacherId)
    ) {
      return errorResponse(
        "INVALID_TEACHER_ID"
      );
    }

    if (
      provider &&
      !MEETING_PROVIDERS.includes(
        provider
      )
    ) {
      return errorResponse(
        "INVALID_MEETING_PROVIDER"
      );
    }

    if (
      provider &&
      !meetingUrl
    ) {
      return errorResponse(
        "MEETING_URL_REQUIRED"
      );
    }

    let circle = null;

    if (circleId) {
      circle =
        await getCircle(
          db,
          circleId
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }
    }

    if (teacherId) {
      const teacher =
        await getTeacher(
          db,
          teacherId
        );

      if (!teacher) {
        return errorResponse(
          "TEACHER_NOT_FOUND",
          404
        );
      }

      if (
        teacher.status !==
        "active"
      ) {
        return errorResponse(
          "TEACHER_IS_NOT_ACTIVE",
          409
        );
      }
    }

    const conflict =
      await hasTeacherConflict(
        db,
        teacherId,
        sessionDate,
        startTime,
        endTime,
        Number(sessionId)
      );

    if (conflict) {
      return errorResponse(
        "TEACHER_HAS_SCHEDULE_CONFLICT",
        409
      );
    }

    const updated =
      await db
        .prepare(`
          UPDATE sessions
          SET
            circle_id = ?2,
            teacher_id = ?3,
            session_type = ?4,
            session_date = ?5,
            start_time = ?6,
            end_time = ?7,
            meeting_provider = ?8,
            meeting_url = ?9,
            status = ?10,
            notes = ?11,
            updated_at = ?12
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          Number(sessionId),
          circleId,
          teacherId,
          sessionType,
          sessionDate,
          startTime,
          endTime,
          provider,
          meetingUrl,
          status,
          notes,
          now()
        )
        .first();

    const result =
      await getSessionById(
        db,
        sessionId
      );

    return json({
      success: true,
      message:
        "SESSION_UPDATED_SUCCESSFULLY",
      data:
        result || updated,
    });
  } catch (e) {
    console.error(
      "SESSIONS_PATCH_FAILED",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "SESSION_UPDATE_FAILED",
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
