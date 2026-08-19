/**
 * الأوَّابين — Individual Scheduling API
 *
 * المسار:
 * /api/individual-scheduling
 *
 * الوظائف:
 * GET:
 *   - عرض المواعيد الفارغة للمعلمة
 *   - عرض طلبات المواعيد
 *   - عرض الحجوزات
 *   - عرض موعد/طلب/حجز محدد
 *
 * POST:
 *   - إضافة وقت متاح للمعلمة
 *   - إرسال طلب موعد من الطالب/ولي الأمر
 *
 * PATCH:
 *   - تعديل وقت متاح
 *   - قبول طلب
 *   - رفض طلب
 *   - إلغاء طلب
 *   - تحديث حالة الحجز
 *
 * سير العمل:
 * 1. المعلمة تضيف الأوقات التي تستطيع استقبال الطلاب فيها.
 * 2. الطالب أو ولي الأمر يرى الأوقات المتاحة فقط.
 * 3. يختار الموعد المناسب.
 * 4. يرسل طلبًا للمعلمة.
 * 5. المعلمة تقبل أو ترفض.
 * 6. عند القبول يتم إنشاء حجز مؤكد.
 *
 * متوافق مع:
 * migrations/006_professional_scheduling_and_billing.sql
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

function validDate(value) {
  const valueClean = clean(value);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      valueClean
    )
  ) {
    return false;
  }

  const date = new Date(
    `${valueClean}T00:00:00`
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) ===
      valueClean
  );
}

function validTime(value) {
  const valueClean = clean(value);

  if (
    !/^\d{2}:\d{2}$/.test(
      valueClean
    )
  ) {
    return false;
  }

  const [hours, minutes] =
    valueClean
      .split(":")
      .map(Number);

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

function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
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

function validateRequestStatus(
  status
) {
  if (
    !REQUEST_STATUSES.includes(status)
  ) {
    return "INVALID_REQUEST_STATUS";
  }

  return null;
}

function validateSlotStatus(status) {
  if (
    !SLOT_STATUSES.includes(status)
  ) {
    return "INVALID_SLOT_STATUS";
  }

  return null;
}

function validateBookingStatus(
  status
) {
  if (
    !BOOKING_STATUSES.includes(status)
  ) {
    return "INVALID_BOOKING_STATUS";
  }

  return null;
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function getTeacher(
  db,
  teacherId
) {
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
    .bind(Number(teacherId))
    .first();
}

async
