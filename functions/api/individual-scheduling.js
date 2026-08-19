/**
 * الأوَّابين — Individual Scheduling API
 *
 * GET
 * /api/individual-scheduling
 *
 * POST
 * - إضافة موعد متاح للمعلمة
 * - إرسال طلب موعد
 *
 * PATCH
 * - تعديل موعد المعلمة
 * - قبول / رفض / إلغاء طلب
 * - تحديث حالة الحجز
 *
 * مبدأ العمل:
 * 1. المعلمة تضيف أوقاتها المتاحة.
 * 2. الطالب/ولي الأمر يرى المواعيد الشاغرة.
 * 3. يختار الموعد ويرسل طلبًا.
 * 4. المعلمة تقبل أو ترفض.
 * 5. عند القبول يتم إنشاء الحجز المؤكد.
 */

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

function validDate(value) {
  const valueClean = clean(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueClean)) {
    return false;
  }

  const date = new Date(`${valueClean}T00:00:00`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === valueClean
  );
}

function validTime(value) {
  const valueClean = clean(value);

  if (!/^\d{2}:\d{2}$/.test(valueClean)) {
    return false;
  }

  const [hours, minutes] =
    valueClean.split(":").map(Number);

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

function now() {
  return new Date().toISOString();
}

function validateTimeRange(
  startTime,
  endTime
) {
  if (!validTime(startTime)) {
    return "INVALID_START_TIME";
  }

  if (!validTime(endTime)) {
    return "INVALID_END_TIME";
  }

  if (startTime >= endTime) {
    return "END_TIME_MUST_BE_AFTER_START_TIME";
  }

  return null;
}

function validateDateRange(
  validFrom,
  validUntil
) {
  if (
    validFrom !== null &&
    !validDate(validFrom)
  ) {
    return "INVALID_VALID_FROM";
  }

  if (
    validUntil !== null &&
    !validDate(validUntil)
  ) {
    return "INVALID_VALID_UNTIL";
  }

  if (
    validFrom &&
    validUntil &&
    validFrom > validUntil
  ) {
    return "VALID_UNTIL_BEFORE_VALID_FROM";
  }

  return null;
}

function validateRequestStatus(status) {
  if (!REQUEST_STATUSES.includes(status)) {
    return "INVALID_REQUEST_STATUS";
  }

  return null;
}

function validateSlotStatus(status) {
  if (!SLOT_STATUSES.includes(status)) {
    return "INVALID_SLOT_STATUS";
  }

  return null;
}

function validateBookingStatus(status) {
  if (!BOOKING_STATUSES.includes(status)) {
    return "INVALID_BOOKING_STATUS";
  }

  return null;
}


/* =========================================================
   HELPERS
========================================================= */

async function getSlot(db, slotId) {
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

      JOIN teachers t
        ON t.id = s.teacher_id

      WHERE s.id = ?1
      LIMIT 1
    `)
    .bind(slotId)
    .first();
}


async function getRequest(db, requestId) {
  return db
    .prepare(`
      SELECT
        r.id,
        r.student_id,
        r.teacher_id,
        r.availability_slot_id,
        r.circle_id,
        r.subscription_id,

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

      JOIN students st
        ON st.id = r.student_id

      JOIN teachers t
        ON t.id = r.teacher_id

      LEFT JOIN circles c
        ON c.id = r.circle_id

      WHERE r.id = ?1
      LIMIT 1
    `)
    .bind(requestId)
    .first();
}


async function getBooking(db, bookingId) {
  return db
    .prepare(`
      SELECT
        b.id,
        b.request_id,

        b.student_id,
        b.teacher_id,

        b.circle_id,
        b.subscription_id,

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

      JOIN students st
        ON st.id = b.student_id

      JOIN teachers t
        ON t.id = b.teacher_id

      LEFT JOIN circles c
        ON c.id = b.circle_id

      WHERE b.id = ?1
      LIMIT 1
    `)
    .bind(bookingId)
    .first();
}


/* =========================================================
   CHECK INDIVIDUAL SUBSCRIPTION
========================================================= */

async function getValidIndividualSubscription(
  db,
  subscriptionId,
  studentId
) {
  if (!validId(subscriptionId)) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        s.id,
        s.student_id,
        s.package_id,
        s.circle_id,
        s.start_date,
        s.end_date,
        s.status,

        p.package_type,
        p.name AS package_name

      FROM subscriptions s

      JOIN packages p
        ON p.id = s.package_id

      WHERE s.id = ?1
        AND s.student_id = ?2

        AND s.status IN (
          'trial',
          'active'
        )

        AND LOWER(COALESCE(p.package_type, ''))
          IN (
            'individual',
            'private',
            'فردية',
            'فردي'
          )

      LIMIT 1
    `)
    .bind(
      Number(subscriptionId),
      Number(studentId)
    )
    .first();
}


/* =========================================================
   CHECK TEACHER
========================================================= */

async function getTeacher(db, teacherId) {
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
   CHECK STUDENT
========================================================= */

async function getStudent(db, studentId) {
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


/* =========================================================
   CHECK REAL BOOKING CONFLICT
========================================================= */

async function getBookingConflict(
  db,
  teacherId,
  bookingDate,
  startTime,
  endTime
) {
  return db
    .prepare(`
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

        AND status IN (
          'confirmed',
          'completed'
        )

        AND start_time < ?4
        AND end_time > ?3

      LIMIT 1
    `)
    .bind(
      teacherId,
      bookingDate,
      startTime,
      endTime
    )
    .first();
}


/* =========================================================
   GET
========================================================= */

export async function onRequestGet(context) {
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const url = new URL(
    context.request.url
  );

  const type =
    clean(
      url.searchParams.get("type")
    ).toLowerCase() || "slots";

  try {

    /* -----------------------------------------------------
       SINGLE SLOT
    ----------------------------------------------------- */

    if (type === "slot") {
      const slotId =
        url.searchParams.get("id");

      if (!validId(slotId)) {
        return errorResponse(
          "SLOT_ID_REQUIRED"
        );
      }

      const slot =
        await getSlot(
          db,
          Number(slotId)
        );

      if (!slot) {
        return errorResponse(
          "SLOT_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: slot,
      });
    }


    /* -----------------------------------------------------
       SINGLE REQUEST
    ----------------------------------------------------- */

    if (type === "request") {
      const requestId =
        url.searchParams.get("id");

      if (!validId(requestId)) {
        return errorResponse(
          "REQUEST_ID_REQUIRED"
        );
      }

      const request =
        await getRequest(
          db,
          Number(requestId)
        );

      if (!request) {
        return errorResponse(
          "SCHEDULE_REQUEST_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: request,
      });
    }


    /* -----------------------------------------------------
       SINGLE BOOKING
    ----------------------------------------------------- */

    if (type === "booking") {
      const bookingId =
        url.searchParams.get("id");

      if (!validId(bookingId)) {
        return errorResponse(
          "BOOKING_ID_REQUIRED"
        );
      }

      const booking =
        await getBooking(
          db,
          Number(bookingId)
        );

      if (!booking) {
        return errorResponse(
          "BOOKING_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: booking,
      });
    }


    /* -----------------------------------------------------
       REQUESTS
    ----------------------------------------------------- */

    if (type === "requests") {
      const teacherId =
        url.searchParams.get(
          "teacher_id"
        );

      const studentId =
        url.searchParams.get(
          "student_id"
        );

      const status =
        clean(
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

        JOIN students st
          ON st.id = r.student_id

        JOIN teachers t
          ON t.id = r.teacher_id

        LEFT JOIN circles c
          ON c.id = r.circle_id

        WHERE 1 = 1
      `;

      const params = [];

      if (teacherId) {
        if (!validId(teacherId)) {
          return errorResponse(
            "INVALID_TEACHER_ID"
          );
        }

        params.push(
          Number(teacherId)
        );

        sql += `
          AND r.teacher_id = ?${params.length}
        `;
      }

      if (studentId) {
        if (!validId(studentId)) {
          return errorResponse(
            "INVALID_STUDENT_ID"
          );
        }

        params.push(
          Number(studentId)
        );

        sql += `
          AND r.student_id = ?${params.length}
        `;
      }

      if (status) {
        const statusError =
          validateRequestStatus(status);

        if (statusError) {
          return errorResponse(
            statusError
          );
        }

        params.push(status);

        sql += `
          AND r.status = ?${params.length}
        `;
      }

      sql += `
        ORDER BY
          r.requested_date ASC,
          r.requested_start_time ASC,
          r.id DESC
      `;

      const result =
        await db
          .prepare(sql)
          .bind(...params)
          .all();

      return json({
        success: true,
        data: result.results || [],
        count:
          result.results?.length || 0,
      });
    }


    /* -----------------------------------------------------
       BOOKINGS
    ----------------------------------------------------- */

    if (type === "bookings") {
      const teacherId =
        url.searchParams.get(
          "teacher_id"
        );

      const studentId =
        url.searchParams.get(
          "student_id"
        );

      const bookingDate =
        clean(
          url.searchParams.get("date")
        );

      let sql = `
        SELECT
          b.id,
          b.request_id,

          b.student_id,
          b.teacher_id,

          b.circle_id,
          b.subscription_id,

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

        JOIN students st
          ON st.id = b.student_id

        JOIN teachers t
          ON t.id = b.teacher_id

        LEFT JOIN circles c
          ON c.id = b.circle_id

        WHERE 1 = 1
      `;

      const params = [];

      if (teacherId) {
        if (!validId(teacherId)) {
          return errorResponse(
            "INVALID_TEACHER_ID"
          );
        }

        params.push(
          Number(teacherId)
        );

        sql += `
          AND b.teacher_id = ?${params.length}
        `;
      }

      if (studentId) {
        if (!validId(studentId)) {
          return errorResponse(
            "INVALID_STUDENT_ID"
          );
        }

        params.push(
          Number(studentId)
        );

        sql += `
          AND b.student_id = ?${params.length}
        `;
      }

      if (bookingDate) {
        if (!validDate(bookingDate)) {
          return errorResponse(
            "INVALID_DATE"
          );
        }

        params.push(bookingDate);

        sql += `
          AND b.booking_date = ?${params.length}
        `;
      }

      sql += `
        ORDER BY
          b.booking_date ASC,
          b.start_time ASC,
          b.id ASC
      `;

      const result =
        await db
          .prepare(sql)
          .bind(...params)
          .all();

      return json({
        success: true,
        data: result.results || [],
        count:
          result.results?.length || 0,
      });
    }


    /* -----------------------------------------------------
       AVAILABLE SLOTS ONLY
       إذا تم إرسال date:
       يتم استبعاد أي موعد محجوز فعليًا.
    ----------------------------------------------------- */

    const teacherId =
      url.searchParams.get(
        "teacher_id"
      );

    const weekday =
      url.searchParams.get(
        "weekday"
      );

    const date =
      clean(
        url.searchParams.get("date")
      );

    if (
      teacherId &&
      !validId(teacherId)
    ) {
      return errorResponse(
        "INVALID_TEACHER_ID"
      );
    }

    if (
      weekday !== null &&
      !validWeekday(weekday)
    ) {
      return errorResponse(
        "INVALID_WEEKDAY"
      );
    }

    if (
      date &&
      !validDate(date)
    ) {
      return errorResponse(
        "INVALID_DATE"
      );
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

        t.full_name AS teacher_name

      FROM teacher_availability_slots s

      JOIN teachers t
        ON t.id = s.teacher_id

      WHERE s.status = 'available'
    `;

    const params = [];

    if (teacherId) {
      params.push(
        Number(teacherId)
      );

      sql += `
        AND s.teacher_id = ?${params.length}
      `;
    }

    if (weekday !== null) {
      params.push(
        Number(weekday)
      );

      sql += `
        AND s.weekday = ?${params.length}
      `;
    }

    if (date) {
      params.push(date);
      params.push(date);

      sql += `
        AND (
          s.valid_from IS NULL
          OR s.valid_from <= ?${params.length - 1}
        )

        AND (
          s.valid_until IS NULL
          OR s.valid_until >= ?${params.length}
        )

        AND NOT EXISTS (
          SELECT 1

          FROM individual_schedule_bookings b

          WHERE b.teacher_id = s.teacher_id

            AND b.booking_date = ?${params.length + 1}

            AND b.status IN (
              'confirmed',
              'completed'
            )

            AND b.start_time < s.end_time
            AND b.end_time > s.start_time
        )
      `;

      params.push(date);
    }

    sql += `
      ORDER BY
        s.weekday ASC,
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
      data: result.results || [],
      count:
        result.results?.length || 0,
    });

  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_GET_ERROR",
      error
    );

    return errorResponse(
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

  const type =
    clean(data.type).toLowerCase();

  try {

    /* -----------------------------------------------------
       CREATE SLOT
    ----------------------------------------------------- */

    if (
      type === "slot" ||
      type === "availability"
    ) {
      const teacherId =
        Number(
          data.teacher_id ??
          data.teacherId
        );

      const weekday =
        Number(data.weekday);

      const startTime =
        clean(
          data.start_time ??
          data.startTime
        );

      const endTime =
        clean(
          data.end_time ??
          data.endTime
        );

      const timezone =
        clean(data.timezone) ||
        "Africa/Cairo";

      const status =
        clean(
          data.status ||
          "available"
        ).toLowerCase();

      const validFrom =
        nullable(
          data.valid_from ??
          data.validFrom
        );

      const validUntil =
        nullable(
          data.valid_until ??
          data.validUntil
        );

      const notes =
        nullable(data.notes);

      if (!validId(teacherId)) {
        return errorResponse(
          "TEACHER_ID_REQUIRED"
        );
      }

      if (!validWeekday(weekday)) {
        return errorResponse(
          "INVALID_WEEKDAY"
        );
      }

      const timeError =
        validateTimeRange(
          startTime,
          endTime
        );

      if (timeError) {
        return errorResponse(
          timeError
        );
      }

      const statusError =
        validateSlotStatus(status);

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      const dateError =
        validateDateRange(
          validFrom,
          validUntil
        );

      if (dateError) {
        return errorResponse(
          dateError
        );
      }

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

      const duplicate =
        await db
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
            startTime,
            endTime
          )
          .first();

      if (duplicate) {
        return errorResponse(
          "AVAILABILITY_SLOT_ALREADY_EXISTS",
          409,
          {
            id: duplicate.id,
          }
        );
      }

      const created =
        await db
          .prepare(`
            INSERT INTO
              teacher_availability_slots (
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
            startTime,
            endTime,
            timezone,
            status,
            validFrom,
            validUntil,
            notes,
            now()
          )
          .run();

      const slotId =
        created.meta?.last_row_id;

      return json(
        {
          success: true,
          message:
            "AVAILABILITY_SLOT_CREATED_SUCCESSFULLY",
          data:
            await getSlot(
              db,
              slotId
            ),
        },
        201
      );
    }


    /* -----------------------------------------------------
       CREATE REQUEST
    ----------------------------------------------------- */

    if (
      type === "request" ||
      type === "booking_request"
    ) {
      const studentId =
        Number(
          data.student_id ??
          data.studentId
        );

      const teacherId =
        Number(
          data.teacher_id ??
          data.teacherId
        );

      const slotValue =
        data.availability_slot_id ??
        data.availabilitySlotId;

      const slotId =
        slotValue === undefined ||
        slotValue === null ||
        slotValue === ""
          ? null
          : Number(slotValue);

      const subscriptionValue =
        data.subscription_id ??
        data.subscriptionId;

      const subscriptionId =
        subscriptionValue === undefined ||
        subscriptionValue === null ||
        subscriptionValue === ""
          ? null
          : Number(subscriptionValue);

      const circleValue =
        data.circle_id ??
        data.circleId;

      const circleId =
        circleValue === undefined ||
        circleValue === null ||
        circleValue === ""
          ? null
          : Number(circleValue);

      const requestedDate =
        clean(
          data.requested_date ??
          data.requestedDate
        );

      const requestedStart =
        clean(
          data.requested_start_time ??
          data.requestedStartTime
        );

      const requestedEnd =
        clean(
          data.requested_end_time ??
          data.requestedEndTime
        );

      const requestedByValue =
        data.requested_by ??
        data.requestedBy;

      const requestedBy =
        requestedByValue === undefined ||
        requestedByValue === null ||
        requestedByValue === ""
          ? null
          : Number(requestedByValue);

      const studentNote =
        nullable(
          data.student_note ??
          data.studentNote
        );

      if (!validId(studentId)) {
        return errorResponse(
          "STUDENT_ID_REQUIRED"
        );
      }

      if (!validId(teacherId)) {
        return errorResponse(
          "TEACHER_ID_REQUIRED"
        );
      }

      if (
        slotId !== null &&
        !validId(slotId)
      ) {
        return errorResponse(
          "INVALID_AVAILABILITY_SLOT_ID"
        );
      }

      if (
        subscriptionId !== null &&
        !validId(subscriptionId)
      ) {
        return errorResponse(
          "INVALID_SUBSCRIPTION_ID"
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
        requestedBy !== null &&
        !validId(requestedBy)
      ) {
        return errorResponse(
          "INVALID_REQUESTED_BY"
        );
      }

      if (!validDate(requestedDate)) {
        return errorResponse(
          "INVALID_REQUESTED_DATE"
        );
      }

      const timeError =
        validateTimeRange(
          requestedStart,
          requestedEnd
        );

      if (timeError) {
        return errorResponse(
          timeError
        );
      }


      /* -----------------------------------------------
         Student
      ----------------------------------------------- */

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


      /* -----------------------------------------------
         Teacher
      ----------------------------------------------- */

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


      /* -----------------------------------------------
         Subscription
         إذا أُرسلت يجب أن تكون فردية وفعالة
      ----------------------------------------------- */

      if (subscriptionId !== null) {
        const subscription =
          await getValidIndividualSubscription(
            db,
            subscriptionId,
            studentId
          );

        if (!subscription) {
          return errorResponse(
            "INVALID_OR_INACTIVE_INDIVIDUAL_SUBSCRIPTION",
            409
          );
        }
      }


      /* -----------------------------------------------
         Slot
      ----------------------------------------------- */

      if (slotId !== null) {
        const slot =
          await db
            .prepare(`
              SELECT *
              FROM teacher_availability_slots

              WHERE id = ?1
                AND teacher_id = ?2
                AND status = 'available'

              LIMIT 1
            `)
            .bind(
              slotId,
              teacherId
            )
            .first();

        if (!slot) {
          return errorResponse(
            "AVAILABILITY_SLOT_NOT_AVAILABLE",
            409
          );
        }

        if (
          slot.valid_from &&
          requestedDate <
            slot.valid_from
        ) {
          return errorResponse(
            "DATE_OUTSIDE_SLOT_VALIDITY",
            409
          );
        }

        if (
          slot.valid_until &&
          requestedDate >
            slot.valid_until
        ) {
          return errorResponse(
            "DATE_OUTSIDE_SLOT_VALIDITY",
            409
          );
        }

        const dateObject =
          new Date(
            `${requestedDate}T00:00:00`
          );

        if (
          dateObject.getDay() !==
          Number(slot.weekday)
        ) {
          return errorResponse(
            "DATE_DOES_NOT_MATCH_SLOT_WEEKDAY",
            409
          );
        }

        if (
          requestedStart <
            slot.start_time ||
          requestedEnd >
            slot.end_time
        ) {
          return errorResponse(
            "REQUEST_TIME_OUTSIDE_AVAILABLE_SLOT",
            409
          );
        }
      }


      /* -----------------------------------------------
         لا تسمح بطلب وقت محجوز بالفعل
      ----------------------------------------------- */

      const conflict =
        await getBookingConflict(
          db,
          teacherId,
          requestedDate,
          requestedStart,
          requestedEnd
        );

      if (conflict) {
        return errorResponse(
          "APPOINTMENT_ALREADY_BOOKED",
          409,
          {
            booking: conflict,
          }
        );
      }


      /* -----------------------------------------------
         لا تكرر الطلب المعلق
      ----------------------------------------------- */

      const pending =
        await db
          .prepare(`
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
              AND student_id = ?2

              AND requested_date = ?3
              AND requested_start_time = ?4
              AND requested_end_time = ?5

              AND status = 'pending'

            LIMIT 1
          `)
          .bind(
            teacherId,
            studentId,
            requestedDate,
            requestedStart,
            requestedEnd
          )
          .first();

      if (pending) {
        return errorResponse(
          "APPOINTMENT_REQUEST_ALREADY_EXISTS",
          409,
          {
            request: pending,
          }
        );
      }


      /* -----------------------------------------------
         Create request
      ----------------------------------------------- */

      const created =
        await db
          .prepare(`
            INSERT INTO
              individual_schedule_requests (

                student_id,
                teacher_id,

                availability_slot_id,

                circle_id,
                subscription_id,

                requested_date,
                requested_start_time,
                requested_end_time,

                requested_by,

                status,

                student_note,

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

              'pending',

              ?10,

              ?11,
              ?11
            )
          `)
          .bind(

            studentId,
            teacherId,

            slotId,

            circleId,
            subscriptionId,

            requestedDate,
            requestedStart,
            requestedEnd,

            requestedBy,

            studentNote,

            now()
          )
          .run();

      const requestId =
        created.meta?.last_row_id;

      return json(
        {
          success: true,
          message:
            "APPOINTMENT_REQUEST_SENT_SUCCESSFULLY",
          data:
            await getRequest(
              db,
              requestId
            ),
        },
        201
      );
    }


    return errorResponse(
      "INVALID_POST_TYPE"
    );

  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_POST_ERROR",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "INDIVIDUAL_SCHEDULING_CREATE_FAILED",
      500
    );
  }
}


/* =========================================================
   PATCH
========================================================= */

export async function onRequestPatch(context) {
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

  const type =
    clean(data.type).toLowerCase();

  try {

    /* -----------------------------------------------------
       UPDATE SLOT
    ----------------------------------------------------- */

    if (
      type === "slot" ||
      type === "availability"
    ) {
      const slotId =
        data.id ??
        data.slot_id ??
        data.slotId;

      if (!validId(slotId)) {
        return errorResponse(
          "SLOT_ID_REQUIRED"
        );
      }

      const current =
        await db
          .prepare(`
            SELECT *
            FROM teacher_availability_slots
            WHERE id = ?1
            LIMIT 1
          `)
          .bind(Number(slotId))
          .first();

      if (!current) {
        return errorResponse(
          "SLOT_NOT_FOUND",
          404
        );
      }

      const weekday =
        data.weekday !== undefined
          ? Number(data.weekday)
          : Number(current.weekday);

      const startTime =
        data.start_time !== undefined ||
        data.startTime !== undefined
          ? clean(
              data.start_time ??
              data.startTime
            )
          : current.start_time;

      const endTime =
        data.end_time !== undefined ||
        data.endTime !== undefined
          ? clean(
              data.end_time ??
              data.endTime
            )
          : current.end_time;

      const status =
        data.status !== undefined
          ? clean(
              data.status
            ).toLowerCase()
          : current.status;

      const validFrom =
        data.valid_from !== undefined ||
        data.validFrom !== undefined
          ? nullable(
              data.valid_from ??
              data.validFrom
            )
          : current.valid_from;

      const validUntil =
        data.valid_until !== undefined ||
        data.validUntil !== undefined
          ? nullable(
              data.valid_until ??
              data.validUntil
            )
          : current.valid_until;

      const notes =
        data.notes !== undefined
          ? nullable(data.notes)
          : current.notes;

      if (!validWeekday(weekday)) {
        return errorResponse(
          "INVALID_WEEKDAY"
        );
      }

      const timeError =
        validateTimeRange(
          startTime,
          endTime
        );

      if (timeError) {
        return errorResponse(
          timeError
        );
      }

      const statusError =
        validateSlotStatus(status);

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      const dateError =
        validateDateRange(
          validFrom,
          validUntil
        );

      if (dateError) {
        return errorResponse(
          dateError
        );
      }

      const duplicate =
        await db
          .prepare(`
            SELECT id
            FROM teacher_availability_slots

            WHERE teacher_id = ?1
              AND weekday = ?2
              AND start_time = ?3
              AND end_time = ?4
              AND id != ?5

            LIMIT 1
          `)
          .bind(
            current.teacher_id,
            weekday,
            startTime,
            endTime,
            Number(slotId)
          )
          .first();

      if (duplicate) {
        return errorResponse(
          "AVAILABILITY_SLOT_ALREADY_EXISTS",
          409
        );
      }

      await db
        .prepare(`
          UPDATE
            teacher_availability_slots

          SET
            weekday = ?2,
            start_time = ?3,
            end_time = ?4,
            status = ?5,
            valid_from = ?6,
            valid_until = ?7,
            notes = ?8,
            updated_at = ?9

          WHERE id = ?1
        `)
        .bind(
          Number(slotId),
          weekday,
          startTime,
          endTime,
          status,
          validFrom,
          validUntil,
          notes,
          now()
        )
        .run();

      return json({
        success: true,
        message:
          "AVAILABILITY_SLOT_UPDATED_SUCCESSFULLY",
        data:
          await getSlot(
            db,
            Number(slotId)
          ),
      });
    }


    /* -----------------------------------------------------
       REQUEST
    ----------------------------------------------------- */

    if (
      type === "request" ||
      type === "booking_request"
    ) {
      const requestId =
        data.id ??
        data.request_id ??
        data.requestId;

      if (!validId(requestId)) {
        return errorResponse(
          "REQUEST_ID_REQUIRED"
        );
      }

      const action =
        clean(
          data.action ??
          data.status
        ).toLowerCase();

      const current =
        await db
          .prepare(`
            SELECT *
            FROM individual_schedule_requests

            WHERE id = ?1
            LIMIT 1
          `)
          .bind(Number(requestId))
          .first();

      if (!current) {
        return errorResponse(
          "SCHEDULE_REQUEST_NOT_FOUND",
          404
        );
      }

      if (current.status !== "pending") {
        return errorResponse(
          "REQUEST_IS_NOT_PENDING",
          409
        );
      }

      let newStatus;

      if (action === "accept") {
        newStatus = "accepted";
      } else if (action === "reject") {
        newStatus = "rejected";
      } else if (action === "cancel") {
        newStatus = "cancelled";
      } else {
        return errorResponse(
          "INVALID_REQUEST_ACTION"
        );
      }

      const responseNote =
        nullable(
          data.teacher_response_note ??
          data.teacherResponseNote ??
          data.note
        );

      const decidedByValue =
        data.decided_by ??
        data.decidedBy;

      const decidedBy =
        decidedByValue === undefined ||
        decidedByValue === null ||
        decidedByValue === ""
          ? null
          : Number(decidedByValue);

      if (
        decidedBy !== null &&
        !validId(decidedBy)
      ) {
        return errorResponse(
          "INVALID_DECIDED_BY"
        );
      }


      /* -----------------------------------------------
         REJECT / CANCEL
      ----------------------------------------------- */

      if (newStatus !== "accepted") {
        await db
          .prepare(`
            UPDATE
              individual_schedule_requests

            SET
              status = ?2,
              teacher_response_note = ?3,
              decided_at = ?4,
              decided_by = ?5,
              updated_at = ?4

            WHERE id = ?1
          `)
          .bind(
            Number(requestId),
            newStatus,
            responseNote,
            now(),
            decidedBy
          )
          .run();

        return json({
          success: true,
          message:
            newStatus === "rejected"
              ? "APPOINTMENT_REQUEST_REJECTED_SUCCESSFULLY"
              : "APPOINTMENT_REQUEST_CANCELLED_SUCCESSFULLY",
          data:
            await getRequest(
              db,
              Number(requestId)
            ),
        });
      }


      /* -----------------------------------------------
         ACCEPT
      ----------------------------------------------- */

      const conflict =
        await getBookingConflict(
          db,
          current.teacher_id,
          current.requested_date,
          current.requested_start_time,
          current.requested_end_time
        );

      if (conflict) {
        return errorResponse(
          "APPOINTMENT_ALREADY_BOOKED",
          409,
          {
            booking: conflict,
          }
        );
      }


      /* -----------------------------------------------
         تحقق إضافي من الاشتراك
      ----------------------------------------------- */

      if (current.subscription_id) {
        const subscription =
          await getValidIndividualSubscription(
            db,
            current.subscription_id,
            current.student_id
          );

        if (!subscription) {
          return errorResponse(
            "INDIVIDUAL_SUBSCRIPTION_IS_NOT_ACTIVE",
            409
          );
        }
      }


      /* -----------------------------------------------
         تحقق من عدم وجود حجز سابق للطلب
      ----------------------------------------------- */

      const existingBooking =
        await db
          .prepare(`
            SELECT id
            FROM individual_schedule_bookings

            WHERE request_id = ?1
            LIMIT 1
          `)
          .bind(Number(requestId))
          .first();

      if (existingBooking) {
        return errorResponse(
          "BOOKING_ALREADY_EXISTS",
          409,
          {
            booking_id:
              existingBooking.id,
          }
        );
      }


      /*
       * مهم:
       * ننشئ الحجز ونقبل الطلب في batch واحد.
       *
       * إذا فشلت عملية الحجز بسبب تعارض UNIQUE
       * فلن يتم اعتماد الطلب منفردًا.
       */

      const timestamp = now();

      const bookingStatement =
        db.prepare(`
          INSERT INTO
            individual_schedule_bookings (

              request_id,

              student_id,
              teacher_id,

              circle_id,
              subscription_id,

              booking_date,
              start_time,
              end_time,

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

            'confirmed',

            ?9,
            ?9
          )
        `).bind(

          Number(requestId),

          current.student_id,
          current.teacher_id,

          current.circle_id,
          current.subscription_id,

          current.requested_date,
          current.requested_start_time,
          current.requested_end_time,

          timestamp
        );


      const requestStatement =
        db.prepare(`
          UPDATE
            individual_schedule_requests

          SET
            status = 'accepted',
            teacher_response_note = ?2,
            decided_at = ?3,
            decided_by = ?4,
            updated_at = ?3

          WHERE id = ?1
            AND status = 'pending'
        `).bind(

          Number(requestId),

          responseNote,
          timestamp,
          decidedBy
        );


      try {
        await db.batch([
          bookingStatement,
          requestStatement,
        ]);
      } catch (error) {
        console.error(
          "APPOINTMENT_ACCEPT_BATCH_ERROR",
          error
        );

        return errorResponse(
          "APPOINTMENT_ACCEPT_FAILED_DUE_TO_CONFLICT",
          409
        );
      }


      const request =
        await getRequest(
          db,
          Number(requestId)
        );

      const booking =
        await db
          .prepare(`
            SELECT
              id
            FROM individual_schedule_bookings

            WHERE request_id = ?1

            ORDER BY id DESC
            LIMIT 1
          `)
          .bind(Number(requestId))
          .first();

      return json({
        success: true,
        message:
          "APPOINTMENT_REQUEST_ACCEPTED_SUCCESSFULLY",
        data: {
          request,
          booking:
            booking
              ? await getBooking(
                  db,
                  booking.id
                )
              : null,
        },
      });
    }


    /* -----------------------------------------------------
       BOOKING STATUS
    ----------------------------------------------------- */

    if (type === "booking") {
      const bookingId =
        data.id ??
        data.booking_id ??
        data.bookingId;

      if (!validId(bookingId)) {
        return errorResponse(
          "BOOKING_ID_REQUIRED"
        );
      }

      const status =
        clean(data.status).toLowerCase();

      const statusError =
        validateBookingStatus(status);

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      const current =
        await db
          .prepare(`
            SELECT *
            FROM individual_schedule_bookings

            WHERE id = ?1
            LIMIT 1
          `)
          .bind(Number(bookingId))
          .first();

      if (!current) {
        return errorResponse(
          "BOOKING_NOT_FOUND",
          404
        );
      }

      await db
        .prepare(`
          UPDATE
            individual_schedule_bookings

          SET
            status = ?2,
            updated_at = ?3

          WHERE id = ?1
        `)
        .bind(
          Number(bookingId),
          status,
          now()
        )
        .run();

      return json({
        success: true,
        message:
          "BOOKING_UPDATED_SUCCESSFULLY",
        data:
          await getBooking(
            db,
            Number(bookingId)
          ),
      });
    }


    return errorResponse(
      "INVALID_PATCH_TYPE"
    );

  } catch (error) {
    console.error(
      "INDIVIDUAL_SCHEDULING_PATCH_ERROR",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "INDIVIDUAL_SCHEDULING_UPDATE_FAILED",
      500
    );
  }
}


/* =========================================================
   ROUTER
========================================================= */

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
      return errorResponse(
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
