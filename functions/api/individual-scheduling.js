import { requirePermission } from "./_auth.js";
import {
  consumeEntitlementWithIndividualBookingSession,
  restoreIndividualBookingEntitlement,
} from "./_workflow.js";
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const REQUEST_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
];

const SLOT_STATUSES = [
  "available",
  "blocked",
  "inactive",
];

const BOOKING_STATUSES = [
  "confirmed",
  "completed",
  "cancelled",
  "rescheduled",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function fail(error, status = 400, extra = {}) {
  return json(
    {
      success: false,
      error,
      ...extra,
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function nullable(rawValue) {
  const value = clean(rawValue);
  return value || null;
}

function id(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function validDate(rawValue) {
  const value = clean(rawValue);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);

  return !Number.isNaN(date.getTime());
}

function validTime(rawValue) {
  const value = clean(rawValue);

  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);

  return (
    hours >= 0 &&
    hours <= 23 &&
    minutes >= 0 &&
    minutes <= 59
  );
}

function validWeekday(value) {
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number >= 0 &&
    number <= 6
  );
}

function validRange(start, end) {
  return (
    validTime(start) &&
    validTime(end) &&
    start < end
  );
}

function timestamp() {
  return new Date().toISOString();
}

async function teacher(db, teacherId) {
  return db
    .prepare(`
      SELECT id, full_name, status
      FROM teachers
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(teacherId)
    .first();
}

async function student(db, studentId) {
  return db
    .prepare(`
      SELECT id, full_name, status
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(studentId)
    .first();
}

async function slot(db, slotId) {
  return db
    .prepare(`
      SELECT
        s.id,
        s.teacher_id,
        s.weekday,
        s.start_time,
        s.end_time,
        s.timezone,
        s.status,
        s.valid_from,
        s.valid_until,
        s.notes,
        s.created_at,
        s.updated_at,
        t.full_name AS teacher_name
      FROM teacher_availability_slots s
      JOIN teachers t ON t.id = s.teacher_id
      WHERE s.id = ?1
      LIMIT 1
    `)
    .bind(slotId)
    .first();
}

async function request(db, requestId) {
  return db
    .prepare(`
      SELECT
        r.id,
        r.student_id,
        r.teacher_id,
        r.availability_slot_id,
        r.circle_id,
        r.subscription_id,
        r.offering_id,
        r.requested_date,
        r.requested_start_time,
        r.requested_end_time,
        r.requested_by,
        r.status,
        r.teacher_response_note,
        r.student_note,
        r.decided_at,
        r.decided_by,
        r.created_at,
        r.updated_at,
        st.full_name AS student_name,
        t.full_name AS teacher_name,
        c.name AS circle_name
      FROM individual_schedule_requests r
      JOIN students st ON st.id = r.student_id
      JOIN teachers t ON t.id = r.teacher_id
      LEFT JOIN circles c ON c.id = r.circle_id
      WHERE r.id = ?1
      LIMIT 1
    `)
    .bind(requestId)
    .first();
}

async function booking(db, bookingId) {
  return db
    .prepare(`
      SELECT
        b.id,
        b.request_id,
        b.student_id,
        b.teacher_id,
        b.circle_id,
        b.subscription_id,
        b.offering_id,
        b.booking_date,
        b.start_time,
        b.end_time,
        b.session_id,
        b.status,
        b.created_at,
        b.updated_at,
        st.full_name AS student_name,
        t.full_name AS teacher_name,
        c.name AS circle_name
      FROM individual_schedule_bookings b
      JOIN students st ON st.id = b.student_id
      JOIN teachers t ON t.id = b.teacher_id
      LEFT JOIN circles c ON c.id = b.circle_id
      WHERE b.id = ?1
      LIMIT 1
    `)
    .bind(bookingId)
    .first();
}

async function conflict(
  db,
  teacherId,
  date,
  start,
  end,
  excludeId = null
) {
  let sql = `
    SELECT
      id,
      student_id,
      teacher_id,
      booking_date,
      start_time,
      end_time,
      status
    FROM individual_schedule_bookings
    WHERE teacher_id = ?1
      AND booking_date = ?2
      AND status IN ('confirmed', 'completed')
      AND start_time < ?4
      AND end_time > ?3
  `;

  const params = [
    teacherId,
    date,
    start,
    end,
  ];

  if (excludeId !== null) {
    params.push(excludeId);
    sql += ` AND id != ?${params.length}`;
  }

  sql += " LIMIT 1";

  return db
    .prepare(sql)
    .bind(...params)
    .first();
}

async function pendingConflict(
  db,
  teacherId,
  date,
  start,
  end,
  excludeId = null
) {
  let sql = `
    SELECT
      id,
      student_id,
      teacher_id,
      requested_date,
      requested_start_time,
      requested_end_time,
      status
    FROM individual_schedule_requests
    WHERE teacher_id = ?1
      AND requested_date = ?2
      AND status = 'pending'
      AND requested_start_time < ?4
      AND requested_end_time > ?3
  `;

  const params = [
    teacherId,
    date,
    start,
    end,
  ];

  if (excludeId !== null) {
    params.push(excludeId);
    sql += ` AND id != ?${params.length}`;
  }

  sql += " LIMIT 1";

  return db
    .prepare(sql)
    .bind(...params)
    .first();
}


function isAdminOrSupervisor(user) {
  return ["admin", "supervisor"].includes(user?.role);
}

function isStudentUser(user) {
  return user?.role === "student";
}

function isTeacherUser(user) {
  return user?.role === "teacher";
}

function sameId(a, b) {
  return Number(a) > 0 && Number(a) === Number(b);
}

async function canAccessStudent(db, user, studentId) {
  if (isAdminOrSupervisor(user)) {
    return true;
  }

  if (isStudentUser(user)) {
    return Boolean(
      user.student_id &&
      sameId(user.student_id, studentId)
    );
  }

  if (isTeacherUser(user)) {
    if (!user.teacher_id) {
      return false;
    }

    const row = await db
      .prepare(`
        SELECT 1
        FROM circle_enrollments ce
        INNER JOIN circles c
          ON c.id = ce.circle_id
        WHERE ce.student_id = ?1
          AND c.teacher_id = ?2
          AND ce.status = 'active'
          AND c.status = 'active'
        LIMIT 1
      `)
      .bind(
        studentId,
        user.teacher_id
      )
      .first();

    return Boolean(row);
  }

  return false;
}

async function canAccessRequest(db, user, current) {
  if (!current) {
    return false;
  }

  if (isAdminOrSupervisor(user)) {
    return true;
  }

  if (isStudentUser(user)) {
    return Boolean(
      user.student_id &&
      sameId(user.student_id, current.student_id)
    );
  }

  if (isTeacherUser(user)) {
    return Boolean(
      user.teacher_id &&
      sameId(user.teacher_id, current.teacher_id)
    );
  }

  return false;
}

async function canAccessBooking(db, user, current) {
  if (!current) {
    return false;
  }

  if (isAdminOrSupervisor(user)) {
    return true;
  }

  if (isStudentUser(user)) {
    return Boolean(
      user.student_id &&
      sameId(user.student_id, current.student_id)
    );
  }

  if (isTeacherUser(user)) {
    return Boolean(
      user.teacher_id &&
      sameId(user.teacher_id, current.teacher_id)
    );
  }

  return false;
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(context) {
  const permission = await requirePermission(context.request, context.env, "individual-scheduling.read");
  if (!permission.ok) return permission.response;
  const db = context.env?.DB;

  if (!db) {
    return fail("DATABASE_NOT_CONFIGURED", 503);
  }

  const url = new URL(context.request.url);

  const type = clean(
    url.searchParams.get("type") || "slots"
  ).toLowerCase();

  try {
    if (type === "slot") {
      const slotId = id(
        url.searchParams.get("id")
      );

      if (!slotId) {
        return fail("SLOT_ID_REQUIRED");
      }

      const data = await slot(db, slotId);

      if (!data) {
        return fail("SLOT_NOT_FOUND", 404);
      }

      return json({
        success: true,
        data,
      });
    }

    if (type === "request") {
      const requestId = id(
        url.searchParams.get("id")
      );

      if (!requestId) {
        return fail("REQUEST_ID_REQUIRED");
      }

      const data = await request(
        db,
        requestId
      );

      if (!data) {
        return fail(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      if (
        !(await canAccessRequest(
          db,
          permission.user,
          data
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      return json({
        success: true,
        data,
      });
    }

    if (type === "booking") {
      const bookingId = id(
        url.searchParams.get("id")
      );

      if (!bookingId) {
        return fail("BOOKING_ID_REQUIRED");
      }

      const data = await booking(
        db,
        bookingId
      );

      if (!data) {
        return fail(
          "BOOKING_NOT_FOUND",
          404
        );
      }

      if (
        !(await canAccessBooking(
          db,
          permission.user,
          data
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      return json({
        success: true,
        data,
      });
    }

    if (type === "slots") {
      const teacherIdValue =
        url.searchParams.get("teacher_id");

      const date = clean(
        url.searchParams.get("date")
      );

      const teacherId = teacherIdValue
        ? id(teacherIdValue)
        : null;

      if (teacherIdValue && !teacherId) {
        return fail("INVALID_TEACHER_ID");
      }

      if (date && !validDate(date)) {
        return fail("INVALID_DATE");
      }

      let sql = `
        SELECT
          s.id,
          s.teacher_id,
          s.weekday,
          s.start_time,
          s.end_time,
          s.timezone,
          s.status,
          s.valid_from,
          s.valid_until,
          s.notes,
          s.created_at,
          s.updated_at,
          t.full_name AS teacher_name
        FROM teacher_availability_slots s
        JOIN teachers t ON t.id = s.teacher_id
        WHERE s.status = 'available'
          AND t.status = 'active'
      `;

      const params = [];

      if (teacherId) {
        params.push(teacherId);

        sql += `
          AND s.teacher_id = ?${params.length}
        `;
      }

      if (date) {
        const weekday = new Date(
          `${date}T00:00:00`
        ).getDay();

        params.push(weekday);

        sql += `
          AND s.weekday = ?${params.length}
        `;

        params.push(date);

        sql += `
          AND (
            s.valid_from IS NULL
            OR s.valid_from <= ?${params.length}
          )
          AND (
            s.valid_until IS NULL
            OR s.valid_until >= ?${params.length}
          )
        `;
      }

      sql += `
        ORDER BY
          s.teacher_id,
          s.weekday,
          s.start_time,
          s.id
      `;

      const result = await db
        .prepare(sql)
        .bind(...params)
        .all();

      let rows = result.results || [];

      if (date) {
        const available = [];

        for (const item of rows) {
          const booked = await conflict(
            db,
            item.teacher_id,
            date,
            item.start_time,
            item.end_time
          );

          if (!booked) {
            available.push({
              ...item,
              requested_date: date,
              available: true,
            });
          }
        }

        rows = available;
      }

      return json({
        success: true,
        data: rows,
        count: rows.length,
      });
    }

    if (type === "requests") {
      const teacherIdValue =
        url.searchParams.get("teacher_id");

      const studentIdValue =
        url.searchParams.get("student_id");

      const status = clean(
        url.searchParams.get("status")
      ).toLowerCase();

      let sql = `
        SELECT
          r.id,
          r.student_id,
          r.teacher_id,
          r.availability_slot_id,
          r.circle_id,
          r.subscription_id,
          r.offering_id,
          r.requested_date,
          r.requested_start_time,
          r.requested_end_time,
          r.requested_by,
          r.status,
          r.teacher_response_note,
          r.student_note,
          r.decided_at,
          r.decided_by,
          r.created_at,
          r.updated_at,
          st.full_name AS student_name,
          t.full_name AS teacher_name,
          c.name AS circle_name
        FROM individual_schedule_requests r
        JOIN students st ON st.id = r.student_id
        JOIN teachers t ON t.id = r.teacher_id
        LEFT JOIN circles c ON c.id = r.circle_id
        WHERE 1 = 1
      `;

      const params = [];

      if (teacherIdValue) {
        const teacherId = id(
          teacherIdValue
        );

        if (!teacherId) {
          return fail("INVALID_TEACHER_ID");
        }

        params.push(teacherId);

        sql += `
          AND r.teacher_id = ?${params.length}
        `;
      }

      if (studentIdValue) {
        const studentId = id(
          studentIdValue
        );

        if (!studentId) {
          return fail("INVALID_STUDENT_ID");
        }

        params.push(studentId);

        sql += `
          AND r.student_id = ?${params.length}
        `;
      }

      if (isStudentUser(permission.user)) {
        if (!permission.user.student_id) {
          return fail("FORBIDDEN", 403);
        }

        params.push(permission.user.student_id);

        sql += `
          AND r.student_id = ?${params.length}
        `;
      } else if (isTeacherUser(permission.user)) {
        if (!permission.user.teacher_id) {
          return fail("FORBIDDEN", 403);
        }

        params.push(permission.user.teacher_id);

        sql += `
          AND r.teacher_id = ?${params.length}
        `;
      }

      if (status) {
        if (
          !REQUEST_STATUSES.includes(status)
        ) {
          return fail(
            "INVALID_REQUEST_STATUS"
          );
        }

        params.push(status);

        sql += `
          AND r.status = ?${params.length}
        `;
      }

      sql += `
        ORDER BY
          r.requested_date,
          r.requested_start_time,
          r.id DESC
      `;

      const result = await db
        .prepare(sql)
        .bind(...params)
        .all();

      const rows = result.results || [];

      return json({
        success: true,
        data: rows,
        count: rows.length,
      });
    }

    if (type === "bookings") {
      const teacherIdValue =
        url.searchParams.get("teacher_id");

      const studentIdValue =
        url.searchParams.get("student_id");

      const date = clean(
        url.searchParams.get("date")
      );

      const status = clean(
        url.searchParams.get("status")
      ).toLowerCase();

      if (date && !validDate(date)) {
        return fail("INVALID_DATE");
      }

      let sql = `
        SELECT
          b.id,
          b.request_id,
          b.student_id,
          b.teacher_id,
          b.circle_id,
          b.subscription_id,
          b.offering_id,
          b.booking_date,
          b.start_time,
          b.end_time,
          b.session_id,
          b.status,
          b.created_at,
          b.updated_at,
          st.full_name AS student_name,
          t.full_name AS teacher_name,
          c.name AS circle_name
        FROM individual_schedule_bookings b
        JOIN students st ON st.id = b.student_id
        JOIN teachers t ON t.id = b.teacher_id
        LEFT JOIN circles c ON c.id = b.circle_id
        WHERE 1 = 1
      `;

      const params = [];

      if (teacherIdValue) {
        const teacherId = id(
          teacherIdValue
        );

        if (!teacherId) {
          return fail("INVALID_TEACHER_ID");
        }

        params.push(teacherId);

        sql += `
          AND b.teacher_id = ?${params.length}
        `;
      }

      if (studentIdValue) {
        const studentId = id(
          studentIdValue
        );

        if (!studentId) {
          return fail("INVALID_STUDENT_ID");
        }

        params.push(studentId);

        sql += `
          AND b.student_id = ?${params.length}
        `;
      }

      if (isStudentUser(permission.user)) {
        if (!permission.user.student_id) {
          return fail("FORBIDDEN", 403);
        }

        params.push(permission.user.student_id);

        sql += `
          AND b.student_id = ?${params.length}
        `;
      } else if (isTeacherUser(permission.user)) {
        if (!permission.user.teacher_id) {
          return fail("FORBIDDEN", 403);
        }

        params.push(permission.user.teacher_id);

        sql += `
          AND b.teacher_id = ?${params.length}
        `;
      }

      if (date) {
        params.push(date);

        sql += `
          AND b.booking_date = ?${params.length}
        `;
      }

      if (status) {
        if (
          !BOOKING_STATUSES.includes(status)
        ) {
          return fail(
            "INVALID_BOOKING_STATUS"
          );
        }

        params.push(status);

        sql += `
          AND b.status = ?${params.length}
        `;
      }

      sql += `
        ORDER BY
          b.booking_date,
          b.start_time,
          b.id
      `;

      const result = await db
        .prepare(sql)
        .bind(...params)
        .all();

      const rows = result.results || [];

      return json({
        success: true,
        data: rows,
        count: rows.length,
      });
    }

    return fail(
      "INVALID_SCHEDULING_TYPE"
    );
  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_GET_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SCHEDULING_FETCH_FAILED",
      500
    );
  }
}

/* =========================================================
   POST
========================================================= */

export async function onRequestPost(context) {
  const db = context.env?.DB;

  const permissionName =
    "individual-scheduling.request.write";

  const permission =
    await requirePermission(
      context.request,
      context.env,
      permissionName
    );

  if (!permission.ok) {
    const managerPermission =
      await requirePermission(
        context.request,
        context.env,
        "individual-scheduling.write"
      );

    if (!managerPermission.ok) {
      return permission.response;
    }

    context.__alawabinManagerPermission =
      managerPermission;
  }

  const activePermission =
    context.__alawabinManagerPermission ||
    permission;

  if (!activePermission.ok) {
    return activePermission.response;
  }

  const dbPermissionUser =
    activePermission.user;

  if (!db) {
    return fail(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return fail("INVALID_JSON");
  }

  const action = clean(
    body?.action || body?.type
  ).toLowerCase();

  try {
    if (
      action === "add_slot" ||
      action === "create_slot" ||
      action === "slot"
    ) {
      const teacherId = id(
        body.teacher_id ??
        body.teacherId
      );

      const weekday = Number(
        body.weekday
      );

      const start = clean(
        body.start_time ??
        body.startTime
      );

      const end = clean(
        body.end_time ??
        body.endTime
      );

      const status = clean(
        body.status || "available"
      ).toLowerCase();

      const validFrom = nullable(
        body.valid_from ??
        body.validFrom
      );

      const validUntil = nullable(
        body.valid_until ??
        body.validUntil
      );

      if (!teacherId) {
        return fail(
          "TEACHER_ID_REQUIRED"
        );
      }

      if (!validWeekday(weekday)) {
        return fail(
          "INVALID_WEEKDAY"
        );
      }

      if (!validRange(start, end)) {
        return fail(
          "INVALID_TIME_RANGE"
        );
      }

      if (!SLOT_STATUSES.includes(status)) {
        return fail(
          "INVALID_SLOT_STATUS"
        );
      }

      if (
        (validFrom &&
          !validDate(validFrom)) ||
        (validUntil &&
          !validDate(validUntil))
      ) {
        return fail(
          "INVALID_VALIDITY_DATE"
        );
      }

      if (
        validFrom &&
        validUntil &&
        validFrom > validUntil
      ) {
        return fail(
          "VALID_UNTIL_BEFORE_VALID_FROM"
        );
      }

      const existingTeacher =
        await teacher(
          db,
          teacherId
        );

      if (!existingTeacher) {
        return fail(
          "TEACHER_NOT_FOUND",
          404
        );
      }

      const duplicate = await db
        .prepare(`
          SELECT id
          FROM teacher_availability_slots
          WHERE teacher_id = ?1
            AND weekday = ?2
            AND start_time = ?3
            AND end_time = ?4
          LIMIT 1
        `)
        .bind(
          teacherId,
          weekday,
          start,
          end
        )
        .first();

      if (duplicate) {
        return fail(
          "AVAILABILITY_SLOT_ALREADY_EXISTS",
          409,
          {
            slot_id: duplicate.id,
          }
        );
      }

      const result = await db
        .prepare(`
          INSERT INTO teacher_availability_slots (
            teacher_id,
            weekday,
            start_time,
            end_time,
            timezone,
            status,
            valid_from,
            valid_until,
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
            ?10
          )
        `)
        .bind(
          teacherId,
          weekday,
          start,
          end,
          clean(body.timezone) ||
            "Africa/Cairo",
          status,
          validFrom,
          validUntil,
          nullable(body.notes),
          timestamp()
        )
        .run();

      const created = await slot(
        db,
        result.meta.last_row_id
      );

      return json(
        {
          success: true,
          message:
            "AVAILABILITY_SLOT_CREATED",
          data: created,
        },
        201
      );
    }

    if (
      action === "request" ||
      action === "create_request" ||
      action === "request_slot"
    ) {
      if (isStudentUser(dbPermissionUser)) {
        const individualBookingSetting = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'academy.individual_booking_open' AND scope_type = 'global' LIMIT 1").first();
        const individualBookingOpen =
          individualBookingSetting?.setting_value === true ||
          individualBookingSetting?.setting_value === 1 ||
          String(individualBookingSetting?.setting_value).toLowerCase() === "true" ||
          String(individualBookingSetting?.setting_value) === "1";

        if (!individualBookingOpen) {
          return fail("INDIVIDUAL_BOOKING_CLOSED", 409);
        }
      }

      const requestedStudentId = id(
        body.student_id ??
        body.studentId
      );

      const studentId =
        isStudentUser(dbPermissionUser)
          ? id(dbPermissionUser.student_id)
          : requestedStudentId;

      const teacherId = id(
        body.teacher_id ??
        body.teacherId
      );

      const slotId = id(
        body.availability_slot_id ??
        body.availabilitySlotId
      );

      const date = clean(
        body.requested_date ??
        body.requestedDate
      );

      const start = clean(
        body.requested_start_time ??
        body.requestedStartTime ??
        body.start_time ??
        body.startTime
      );

      const end = clean(
        body.requested_end_time ??
        body.requestedEndTime ??
        body.end_time ??
        body.endTime
      );

      if (!studentId) {
        return fail(
          "STUDENT_ID_REQUIRED"
        );
      }

      if (!teacherId) {
        return fail(
          "TEACHER_ID_REQUIRED"
        );
      }

      if (isStudentUser(dbPermissionUser)) {
        if (
          !dbPermissionUser.student_id ||
          !sameId(
            dbPermissionUser.student_id,
            studentId
          )
        ) {
          return fail("FORBIDDEN", 403);
        }
      }

      if (isTeacherUser(dbPermissionUser)) {
        if (
          !dbPermissionUser.teacher_id ||
          !sameId(
            dbPermissionUser.teacher_id,
            teacherId
          )
        ) {
          return fail("FORBIDDEN", 403);
        }

        if (
          !(await canAccessStudent(
            db,
            dbPermissionUser,
            studentId
          ))
        ) {
          return fail("FORBIDDEN", 403);
        }
      }

      if (!validDate(date)) {
        return fail(
          "INVALID_REQUESTED_DATE"
        );
      }

      if (!validRange(start, end)) {
        return fail(
          "INVALID_TIME_RANGE"
        );
      }

      const existingStudent =
        await student(
          db,
          studentId
        );

      if (!existingStudent) {
        return fail(
          "STUDENT_NOT_FOUND",
          404
        );
      }

      const existingTeacher =
        await teacher(
          db,
          teacherId
        );

      if (!existingTeacher) {
        return fail(
          "TEACHER_NOT_FOUND",
          404
        );
      }

      const weekday = new Date(
        `${date}T00:00:00`
      ).getDay();

      let selectedSlot = null;

      if (slotId) {
        selectedSlot = await slot(
          db,
          slotId
        );

        if (!selectedSlot) {
          return fail(
            "SLOT_NOT_FOUND",
            404
          );
        }

        if (
          Number(selectedSlot.teacher_id) !==
          teacherId
        ) {
          return fail(
            "SLOT_TEACHER_MISMATCH",
            409
          );
        }

        if (
          selectedSlot.status !==
          "available"
        ) {
          return fail(
            "SLOT_NOT_AVAILABLE",
            409
          );
        }

        if (
          Number(selectedSlot.weekday) !==
          weekday
        ) {
          return fail(
            "DATE_DOES_NOT_MATCH_SLOT_WEEKDAY",
            409
          );
        }

        if (
          start < selectedSlot.start_time ||
          end > selectedSlot.end_time
        ) {
          return fail(
            "REQUEST_OUTSIDE_AVAILABLE_TIME",
            409
          );
        }

        if (
          selectedSlot.valid_from &&
          date < selectedSlot.valid_from
        ) {
          return fail(
            "DATE_BEFORE_SLOT_VALID_FROM",
            409
          );
        }

        if (
          selectedSlot.valid_until &&
          date > selectedSlot.valid_until
        ) {
          return fail(
            "DATE_AFTER_SLOT_VALID_UNTIL",
            409
          );
        }
      } else {
        selectedSlot = await db
          .prepare(`
            SELECT id
            FROM teacher_availability_slots
            WHERE teacher_id = ?1
              AND weekday = ?2
              AND status = 'available'
              AND start_time <= ?3
              AND end_time >= ?4
              AND (
                valid_from IS NULL
                OR valid_from <= ?5
              )
              AND (
                valid_until IS NULL
                OR valid_until >= ?5
              )
            ORDER BY id
            LIMIT 1
          `)
          .bind(
            teacherId,
            weekday,
            start,
            end,
            date
          )
          .first();

        if (!selectedSlot) {
          return fail(
            "NO_AVAILABLE_SLOT",
            409
          );
        }
      }

      const booked = await conflict(
        db,
        teacherId,
        date,
        start,
        end
      );

      if (booked) {
        return fail(
          "TIME_ALREADY_BOOKED",
          409,
          {
            conflict: booked,
          }
        );
      }

      const pending =
        await pendingConflict(
          db,
          teacherId,
          date,
          start,
          end
        );

      if (pending) {
        return fail(
          "TIME_ALREADY_REQUESTED",
          409,
          {
            conflict: pending,
          }
        );
      }

      const offeringId = id(
        body.offering_id ??
        body.offeringId
      );

      if (!offeringId) {
        return fail(
          "OFFERING_ID_REQUIRED"
        );
      }

      const selectedOffering =
        await db
          .prepare(`
            SELECT
              id,
              name,
              price,
              currency,
              duration_minutes,
              status
            FROM individual_session_offerings
            WHERE id = ?1
              AND status = 'active'
            LIMIT 1
          `)
          .bind(offeringId)
          .first();

      if (!selectedOffering) {
        return fail(
          "OFFERING_NOT_FOUND_OR_INACTIVE",
          404
        );
      }

      const requestedDuration =
        (
          new Date(
            `1970-01-01T${end}:00Z`
          ).getTime() -
          new Date(
            `1970-01-01T${start}:00Z`
          ).getTime()
        ) / 60000;

      if (
        !Number.isFinite(requestedDuration) ||
        requestedDuration !==
          Number(selectedOffering.duration_minutes)
      ) {
        return fail(
          "REQUEST_DURATION_MUST_MATCH_OFFERING",
          409,
          {
            offering_duration_minutes:
              Number(selectedOffering.duration_minutes),
            requested_duration_minutes:
              requestedDuration,
          }
        );
      }

      const subscriptionId = id(
        body.subscription_id ??
        body.subscriptionId
      );

      const circleId = id(
        body.circle_id ??
        body.circleId
      );

      const requestedBy =
        dbPermissionUser?.id ??
        null;

      const result = await db
        .prepare(`
          INSERT INTO individual_schedule_requests (
            student_id,
            teacher_id,
            availability_slot_id,
            circle_id,
            subscription_id,
            offering_id,
            requested_date,
            requested_start_time,
            requested_end_time,
            requested_by,
            status,
            teacher_response_note,
            student_note,
            decided_at,
            decided_by,
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
            'pending',
            NULL,
            ?11,
            NULL,
            NULL,
            ?12,
            ?12
          )
        `)
        .bind(
          studentId,
          teacherId,
          selectedSlot.id,
          circleId,
          subscriptionId,
          offeringId,
          date,
          start,
          end,
          requestedBy,
          nullable(
            body.student_note ??
            body.studentNote ??
            body.notes
          ),
          timestamp()
        )
        .run();

      const created = await request(
        db,
        result.meta.last_row_id
      );

      return json(
        {
          success: true,
          message:
            "SCHEDULE_REQUEST_SENT",
          data: created,
        },
        201
      );
    }

    return fail(
      "INVALID_SCHEDULING_ACTION"
    );
  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_POST_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SCHEDULING_CREATE_FAILED",
      500
    );
  }
}

/* =========================================================
   PATCH
========================================================= */

export async function onRequestPatch(context) {
  const permission = await requirePermission(context.request, context.env, "individual-scheduling.write");
  if (!permission.ok) return permission.response;
  const db = context.env?.DB;

  if (!db) {
    return fail(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return fail("INVALID_JSON");
  }

  const action = clean(
    body?.action || body?.type
  ).toLowerCase();

  try {
    if (
      action === "accept_request" ||
      action === "approve_request"
    ) {
      const requestId = id(
        body.id ??
        body.request_id ??
        body.requestId
      );

      if (!requestId) {
        return fail(
          "REQUEST_ID_REQUIRED"
        );
      }

      const current = await request(
        db,
        requestId
      );

      if (!current) {
        return fail(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      if (
        isStudentUser(permission.user)
      ) {
        return fail("FORBIDDEN", 403);
      }

      if (
        !(await canAccessRequest(
          db,
          permission.user,
          current
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      if (current.status !== "pending") {
        return fail(
          "REQUEST_IS_NOT_PENDING",
          409
        );
      }

      if (!current.offering_id) {
        return fail(
          "REQUEST_OFFERING_MISSING",
          409
        );
      }

      const selectedOffering =
        await db
          .prepare(`
            SELECT
              id,
              name,
              price,
              currency,
              duration_minutes,
              status
            FROM individual_session_offerings
            WHERE id = ?1
            LIMIT 1
          `)
          .bind(current.offering_id)
          .first();

      if (!selectedOffering) {
        return fail(
          "OFFERING_NOT_FOUND",
          404
        );
      }

      if (
        selectedOffering.status !== "active"
      ) {
        return fail(
          "OFFERING_INACTIVE",
          409
        );
      }

      const booked = await conflict(
        db,
        current.teacher_id,
        current.requested_date,
        current.requested_start_time,
        current.requested_end_time
      );

      if (booked) {
        return fail(
          "TIME_ALREADY_BOOKED",
          409,
          {
            conflict: booked,
          }
        );
      }

      const decidedBy =
        permission.user?.id ??
        null;

      const note = nullable(
        body.teacher_response_note ??
        body.teacherResponseNote
      );

      const createdAt = timestamp();
      const decidedAt = timestamp();

      /*
       * =====================================================
       * SUBSCRIPTION ENTITLEMENT COVERAGE
       * =====================================================
       *
       * Only a valid SESSION entitlement belonging to the
       * exact subscription attached to this request may cover
       * the individual booking.
       *
       * Sponsorship/manual entitlements are NOT consumed here.
       */

      let coveredEntitlement = null;

      if (current.subscription_id) {
        coveredEntitlement = await db
          .prepare(`
            SELECT
              se.id,
              se.student_id,
              se.source_type,
              se.source_id,
              se.entitlement_type,
              se.title,
              se.quantity,
              se.used_quantity,
              se.duration_minutes,
              se.valid_from,
              se.valid_until,
              se.status
            FROM student_entitlements se
            WHERE se.student_id = ?1
              AND se.source_type = 'subscription'
              AND se.source_id = ?2
              AND se.entitlement_type = 'session'
              AND se.status = 'active'
              AND se.used_quantity < se.quantity
              AND (
                se.valid_from IS NULL
                OR se.valid_from <= date('now')
              )
              AND (
                se.valid_until IS NULL
                OR se.valid_until >= date('now')
              )
              AND (
                se.duration_minutes IS NULL
                OR se.duration_minutes = ?3
              )
              AND EXISTS (
                SELECT 1
                FROM subscriptions sub
                WHERE sub.id = ?2
                  AND sub.status IN ('active', 'trial')
              )
            ORDER BY se.id
            LIMIT 1
          `)
          .bind(
            current.student_id,
            current.subscription_id,
            Number(selectedOffering.duration_minutes)
          )
          .first();
      }

      /*
       * =====================================================
       * ACCEPT REQUEST + CREATE BOOKING
       * =====================================================
       */

      const statements = [
        db
          .prepare(`
            UPDATE individual_schedule_requests
            SET
              status = 'accepted',
              teacher_response_note = ?2,
              decided_at = ?3,
              decided_by = ?4,
              updated_at = ?3
            WHERE id = ?1
              AND status = 'pending'
          `)
          .bind(
            requestId,
            note,
            decidedAt,
            decidedBy
          ),

        db
          .prepare(`
            INSERT INTO individual_schedule_bookings (
              request_id,
              student_id,
              teacher_id,
              circle_id,
              subscription_id,
              offering_id,
              booking_date,
              start_time,
              end_time,
              session_id,
              status,
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
              NULL,
              'confirmed',
              ?10,
              ?10
            )
          `)
          .bind(
            current.id,
            current.student_id,
            current.teacher_id,
            current.circle_id,
            current.subscription_id,
            current.offering_id,
            current.requested_date,
            current.requested_start_time,
            current.requested_end_time,
            createdAt
          ),
      ];

      const results = await db.batch(
        statements
      );

      const updatedRequest = results[0];
      const created = results[1];

      if (
        !updatedRequest?.meta?.changes ||
        updatedRequest.meta.changes !== 1
      ) {
        return fail(
          "REQUEST_ACCEPTANCE_CONFLICT",
          409
        );
      }

      const bookingId =
        created?.meta?.last_row_id;

      if (!bookingId) {
        return fail(
          "BOOKING_CREATION_FAILED",
          500
        );
      }

      /*
       * =====================================================
       * COVERED BOOKING
       * =====================================================
       *
       * Subscription entitlement exists:
       *
       * booking
       *   -> official individual session
       *   -> consume one entitlement
       *   -> NO monetary charge
       */

      if (coveredEntitlement) {
        try {
          const covered =
            await consumeEntitlementWithIndividualBookingSession(
              db,
              {
                studentId:
                  current.student_id,

                entitlementId:
                  coveredEntitlement.id,

                bookingId,

                circleId:
                  current.circle_id,

                teacherId:
                  current.teacher_id,

                sessionDate:
                  current.requested_date,

                startTime:
                  current.requested_start_time,

                endTime:
                  current.requested_end_time,

                durationMinutes:
                  Number(
                    selectedOffering.duration_minutes
                  ),

                notes:
                  note ||
                  `Individual booking #${bookingId}`,

                createdBy:
                  decidedBy,
              }
            );

          return json({
            success: true,
            message:
              "SCHEDULE_REQUEST_ACCEPTED",

            data: {
              request:
                await request(
                  db,
                  requestId
                ),

              booking:
                await booking(
                  db,
                  bookingId
                ),

              charge: null,

              entitlement: {
                id:
                  covered.entitlement.id,

                quantity:
                  covered.entitlement.quantity,

                used_quantity:
                  covered.entitlement.used_quantity,

                remaining_quantity:
                  Number(
                    covered.entitlement.quantity || 0
                  ) -
                  Number(
                    covered.entitlement.used_quantity || 0
                  ),

                status:
                  covered.entitlement.status,
              },

              session_id:
                covered.sessionId,
            },
          });

        } catch (entitlementError) {
          console.error(
            "INDIVIDUAL_BOOKING_ENTITLEMENT_ERROR",
            entitlementError
          );

          /*
           * IMPORTANT:
           * request_id is UNIQUE in individual_schedule_bookings.
           *
           * Therefore we DELETE this newly-created booking rather
           * than marking it cancelled, so the pending request can
           * be accepted again safely.
           */

          try {
            await db.batch([
              db
                .prepare(`
                  DELETE FROM individual_schedule_bookings
                  WHERE id = ?1
                    AND status = 'confirmed'
                    AND session_id IS NULL
                `)
                .bind(
                  bookingId
                ),

              db
                .prepare(`
                  UPDATE individual_schedule_requests
                  SET
                    status = 'pending',
                    decided_at = NULL,
                    decided_by = NULL,
                    teacher_response_note = NULL,
                    updated_at = ?2
                  WHERE id = ?1
                    AND status = 'accepted'
                `)
                .bind(
                  requestId,
                  timestamp()
                ),
            ]);
          } catch (rollbackError) {
            console.error(
              "INDIVIDUAL_BOOKING_ENTITLEMENT_ROLLBACK_ERROR",
              rollbackError
            );
          }

          return fail(
            "ENTITLEMENT_BOOKING_CREATION_FAILED",
            409
          );
        }
      }

      /*
       * =====================================================
       * NORMAL PAY-PER-SESSION BOOKING
       * =====================================================
       *
       * No valid subscription entitlement:
       * preserve the existing monetary payment flow.
       */

      try {
        await db
          .prepare(`
            INSERT INTO individual_booking_charges (
              booking_id,
              student_id,
              offering_id,
              amount,
              currency,
              status,
              payment_id,
              due_at,
              paid_at,
              created_at,
              updated_at
            )
            VALUES (
              ?1,
              ?2,
              ?3,
              ?4,
              ?5,
              'pending',
              NULL,
              NULL,
              NULL,
              ?6,
              ?6
            )
          `)
          .bind(
            bookingId,
            current.student_id,
            selectedOffering.id,
            Number(selectedOffering.price),
            selectedOffering.currency,
            createdAt
          )
          .run();

      } catch (chargeError) {
        console.error(
          "INDIVIDUAL_BOOKING_CHARGE_CREATE_ERROR",
          chargeError
        );

        /*
         * Same UNIQUE request_id consideration:
         * delete the fresh booking instead of leaving a cancelled
         * booking behind.
         */

        try {
          await db.batch([
            db
              .prepare(`
                DELETE FROM individual_schedule_bookings
                WHERE id = ?1
                  AND status = 'confirmed'
                  AND session_id IS NULL
              `)
              .bind(
                bookingId
              ),

            db
              .prepare(`
                UPDATE individual_schedule_requests
                SET
                  status = 'pending',
                  decided_at = NULL,
                  decided_by = NULL,
                  teacher_response_note = NULL,
                  updated_at = ?2
                WHERE id = ?1
                  AND status = 'accepted'
              `)
              .bind(
                requestId,
                timestamp()
              ),
          ]);
        } catch (rollbackError) {
          console.error(
            "INDIVIDUAL_BOOKING_CHARGE_ROLLBACK_ERROR",
            rollbackError
          );
        }

        return fail(
          "BOOKING_CHARGE_CREATION_FAILED",
          500
        );
      }

      return json({
        success: true,
        message:
          "SCHEDULE_REQUEST_ACCEPTED",

        data: {
          request:
            await request(
              db,
              requestId
            ),

          booking:
            await booking(
              db,
              bookingId
            ),

          charge:
            await db
              .prepare(`
                SELECT
                  id,
                  booking_id,
                  student_id,
                  offering_id,
                  amount,
                  currency,
                  status,
                  payment_id,
                  due_at,
                  paid_at,
                  created_at,
                  updated_at
                FROM individual_booking_charges
                WHERE booking_id = ?1
                LIMIT 1
              `)
              .bind(
                bookingId
              )
              .first(),
        },
      });
    }

    if (action === "reject_request") {
      const requestId = id(
        body.id ??
        body.request_id ??
        body.requestId
      );

      if (!requestId) {
        return fail(
          "REQUEST_ID_REQUIRED"
        );
      }

      const current = await request(
        db,
        requestId
      );

      if (!current) {
        return fail(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      if (
        !(await canAccessRequest(
          db,
          permission.user,
          current
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      if (current.status !== "pending") {
        return fail(
          "REQUEST_IS_NOT_PENDING",
          409
        );
      }

      const decidedAt = timestamp();

      const result = await db
        .prepare(`
          UPDATE individual_schedule_requests
          SET
            status = 'rejected',
            teacher_response_note = ?2,
            decided_at = ?3,
            decided_by = ?4,
            updated_at = ?3
          WHERE id = ?1
            AND status = 'pending'
        `)
        .bind(
          requestId,
          nullable(
            body.teacher_response_note ??
            body.teacherResponseNote
          ),
          decidedAt,
          permission.user?.id ?? null
        )
        .run();

      if (!result?.meta?.changes) {
        return fail(
          "REQUEST_IS_NOT_PENDING",
          409
        );
      }

      return json({
        success: true,
        message:
          "SCHEDULE_REQUEST_REJECTED",
        data: await request(
          db,
          requestId
        ),
      });
    }

    if (action === "cancel_request") {
      const requestId = id(
        body.id ??
        body.request_id ??
        body.requestId
      );

      if (!requestId) {
        return fail(
          "REQUEST_ID_REQUIRED"
        );
      }

      const current = await request(
        db,
        requestId
      );

      if (!current) {
        return fail(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      if (
        !(await canAccessRequest(
          db,
          permission.user,
          current
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      if (
        isStudentUser(permission.user) &&
        !sameId(
          permission.user.student_id,
          current.student_id
        )
      ) {
        return fail("FORBIDDEN", 403);
      }

      if (
        !["pending", "accepted"].includes(
          current.status
        )
      ) {
        return fail(
          "REQUEST_CANNOT_BE_CANCELLED",
          409
        );
      }

      const time = timestamp();

      /*
       * Find the current booking before changing its status.
       */
      const currentBooking =
        await db
          .prepare(`
            SELECT
              id,
              request_id,
              student_id,
              teacher_id,
              subscription_id,
              session_id,
              status
            FROM individual_schedule_bookings
            WHERE request_id = ?1
            ORDER BY id DESC
            LIMIT 1
          `)
          .bind(requestId)
          .first();

      /*
       * Covered individual booking:
       *
       * restore the consumed entitlement exactly once
       * and cancel the official session.
       */
      if (
        currentBooking &&
        ["confirmed", "rescheduled"].includes(
          currentBooking.status
        ) &&
        currentBooking.session_id
      ) {
        try {
          await restoreIndividualBookingEntitlement(
            db,
            {
              bookingId:
                currentBooking.id,
              createdBy:
                permission.user?.id ??
                null,
              reason:
                `Individual booking #${currentBooking.id} cancelled`,
            }
          );
        } catch (restoreError) {
          console.error(
            "INDIVIDUAL_BOOKING_ENTITLEMENT_RESTORE_ERROR",
            restoreError
          );

          return fail(
            "ENTITLEMENT_RESTORE_FAILED",
            409
          );
        }

        await db
          .prepare(`
            UPDATE sessions
            SET
              status = 'cancelled',
              updated_at = ?2
            WHERE id = ?1
              AND status IN (
                'scheduled',
                'rescheduled'
              )
          `)
          .bind(
            currentBooking.session_id,
            time
          )
          .run();
      }

      /*
       * Cancel any still-pending monetary charge for this booking.
       *
       * Covered entitlement bookings have no charge row.
       * Paid/waived/sponsored charges are intentionally untouched
       * because they require separate refund/settlement rules.
       */
      await db
        .prepare(`
          UPDATE individual_booking_charges
          SET
            status = 'cancelled',
            updated_at = ?2
          WHERE booking_id = ?1
            AND status = 'pending'
        `)
        .bind(
          currentBooking?.id ?? null,
          time
        )
        .run();

      /*
       * Cancel request + booking together.
       */
      await db.batch([
        db
          .prepare(`
            UPDATE individual_schedule_requests
            SET
              status = 'cancelled',
              decided_at = ?2,
              updated_at = ?2
            WHERE id = ?1
          `)
          .bind(
            requestId,
            time
          ),

        db
          .prepare(`
            UPDATE individual_schedule_bookings
            SET
              status = 'cancelled',
              updated_at = ?2
            WHERE request_id = ?1
              AND status IN (
                'confirmed',
                'rescheduled'
              )
          `)
          .bind(
            requestId,
            time
          ),
      ]);

      return json({
        success: true,
        message:
          "SCHEDULE_REQUEST_CANCELLED",
        data: await request(
          db,
          requestId
        ),
      });
    }


    if (
      action === "update_booking" ||
      action === "booking_status"
    ) {
      const bookingId = id(
        body.id ??
        body.booking_id ??
        body.bookingId
      );

      if (!bookingId) {
        return fail(
          "BOOKING_ID_REQUIRED"
        );
      }

      const current = await booking(
        db,
        bookingId
      );

      if (!current) {
        return fail(
          "BOOKING_NOT_FOUND",
          404
        );
      }

      if (
        !(await canAccessBooking(
          db,
          permission.user,
          current
        ))
      ) {
        return fail("FORBIDDEN", 403);
      }

      const status = clean(
        body.status || current.status
      ).toLowerCase();

      if (
        !BOOKING_STATUSES.includes(status)
      ) {
        return fail(
          "INVALID_BOOKING_STATUS"
        );
      }

      /*
       * Prevent reopening a cancelled booking blindly.
       *
       * A covered booking may already have had its entitlement
       * restored, so reopening it without a fresh acceptance
       * would create an untracked session.
       */
      if (
        current.status === "cancelled" &&
        ["confirmed", "rescheduled"].includes(
          status
        )
      ) {
        return fail(
          "CANCELLED_BOOKING_CANNOT_BE_REOPENED",
          409
        );
      }

      const sessionId =
        id(
          body.session_id ??
          body.sessionId
        ) || current.session_id;

      const time = timestamp();

      /*
       * Covered booking cancellation:
       *
       * confirmed/rescheduled
       *          ↓
       * restore entitlement
       *          ↓
       * cancel official session
       *          ↓
       * cancel booking
       */
      if (
        ["confirmed", "rescheduled"].includes(
          current.status
        ) &&
        status === "cancelled"
      ) {
        if (current.session_id) {
          try {
            await restoreIndividualBookingEntitlement(
              db,
              {
                bookingId:
                  bookingId,
                createdBy:
                  permission.user?.id ??
                  null,
                reason:
                  `Individual booking #${bookingId} cancelled`,
              }
            );
          } catch (restoreError) {
            console.error(
              "INDIVIDUAL_BOOKING_ENTITLEMENT_RESTORE_ERROR",
              restoreError
            );

            return fail(
              "ENTITLEMENT_RESTORE_FAILED",
              409
            );
          }

          await db
            .prepare(`
              UPDATE sessions
              SET
                status = 'cancelled',
                updated_at = ?2
              WHERE id = ?1
                AND status IN (
                  'scheduled',
                  'rescheduled'
                )
            `)
            .bind(
              current.session_id,
              time
            )
            .run();
        }
      }

      if (
        status === "cancelled"
      ) {
        await db
          .prepare(`
            UPDATE individual_booking_charges
            SET
              status = 'cancelled',
              updated_at = ?2
            WHERE booking_id = ?1
              AND status = 'pending'
          `)
          .bind(
            bookingId,
            time
          )
          .run();
      }

      await db
        .prepare(`
          UPDATE individual_schedule_bookings
          SET
            status = ?2,
            session_id = ?3,
            updated_at = ?4
          WHERE id = ?1
        `)
        .bind(
          bookingId,
          status,
          sessionId,
          time
        )
        .run();

      return json({
        success: true,
        message: "BOOKING_UPDATED",
        data: await booking(
          db,
          bookingId
        ),
      });
    }


    return fail(
      "INVALID_SCHEDULING_ACTION"
    );
  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_PATCH_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SCHEDULING_UPDATE_FAILED",
      500
    );
  }
}

export async function onRequest(context) {
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
      return fail(
        "METHOD_NOT_ALLOWED",
        405,
        {
          allowed: [
            "GET",
            "POST",
            "PATCH",
          ],
        }
      );
  }
}
