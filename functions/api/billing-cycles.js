import { requirePermission } from "./_auth.js";
/**
 * الأوَّابين — Monthly Billing Cycles API
 *
 * GET    /api/billing-cycles
 * GET    /api/billing-cycles?id=1
 * GET    /api/billing-cycles?student_id=1
 * GET    /api/billing-cycles?billing_month=2026-08
 *
 * POST   /api/billing-cycles
 * PATCH  /api/billing-cycles
 *
 * متوافق مع:
 * - Migration 006 Professional Scheduling & Billing
 * - Migration 007 Monthly Billing Rules
 *
 * يدير:
 * - الفاتورة الشهرية للطالب
 * - بداية الدورة من أول الشهر
 * - بداية الطالب الجديد من الشهر الجديد
 * - الباقة الشهرية
 * - عدد الجلسات المخططة والمجدولة والمنفذة
 * - الجلسات القابلة للمحاسبة
 * - الخصومات
 * - الإعفاء
 * - الغرامات
 * - المدفوع
 * - المتبقي
 * - بنود الفاتورة
 * - قواعد الفوترة المركزية
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const STATUSES = [
  "open",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

const BILLING_ITEM_TYPES = [
  "package",
  "session",
  "discount",
  "exemption",
  "fine",
  "adjustment",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function errorResponse(message, status = 400, extra = {}) {
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
  const v = clean(value);
  return v || null;
}

function validId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(clean(value));
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

function currentMonth() {
  return today().slice(0, 7);
}

function firstDayOfMonth(month) {
  return `${month}-01`;
}

function lastDayOfMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);

  const date = new Date(
    Date.UTC(year, monthNumber, 0)
  );

  return date.toISOString().slice(0, 10);
}

function money(value) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(
    (n + Number.EPSILON) * 100
  ) / 100;
}

function nonNegativeNumber(value) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return null;
  }

  return money(n);
}

function nonNegativeInteger(value) {
  const n = Number(value);

  if (!Number.isInteger(n) || n < 0) {
    return null;
  }

  return n;
}

function validateStatus(status) {
  return STATUSES.includes(status)
    ? null
    : "INVALID_BILLING_STATUS";
}

function calculateTotal({
  packageAmount,
  sessionAmount,
  discountAmount,
  exemptionAmount,
  fineAmount,
}) {
  return Math.max(
    0,
    money(
      Number(packageAmount || 0) +
        Number(sessionAmount || 0) +
        Number(fineAmount || 0) -
        Number(discountAmount || 0) -
        Number(exemptionAmount || 0)
    )
  );
}

function calculateStatus(
  totalAmount,
  paidAmount,
  requestedStatus
) {
  if (requestedStatus === "cancelled") {
    return "cancelled";
  }

  if (totalAmount <= 0) {
    return "paid";
  }

  if (paidAmount >= totalAmount) {
    return "paid";
  }

  if (paidAmount > 0) {
    return "partially_paid";
  }

  if (requestedStatus === "overdue") {
    return "overdue";
  }

  if (requestedStatus === "issued") {
    return "issued";
  }

  return "open";
}

/* =========================================================
   Migration 007
   قواعد الفوترة
========================================================= */


function calculateSessionChargeability({
  attendanceStatus,
  excuseSubmittedAt,
  excuseStatus,
  excuseDeadlineHours = 4,
  sessionStartTime,
  academyCancelled = false
}) {
  if (academyCancelled) {
    return {
      chargeable: false,
      reason: "cancelled_by_academy"
    };
  }

  const status = String(attendanceStatus || "").trim().toLowerCase();

  if (status === "present" || status === "late") {
    return {
      chargeable: false,
      reason: status
    };
  }

  if (status === "excused") {
    return {
      chargeable: false,
      reason: "excused_absence"
    };
  }

  if (status !== "absent" && status !== "no_show" && status !== "") {
    return {
      chargeable: false,
      reason: "not_chargeable"
    };
  }

  if (!excuseSubmittedAt || !sessionStartTime) {
    return {
      chargeable: true,
      reason: "absence_without_excuse"
    };
  }

  const submitted = new Date(excuseSubmittedAt);
  const start = new Date(sessionStartTime);

  if (
    Number.isNaN(submitted.getTime()) ||
    Number.isNaN(start.getTime())
  ) {
    return {
      chargeable: true,
      reason: "absence_without_valid_excuse_time"
    };
  }

  const deadline = new Date(
    start.getTime() - excuseDeadlineHours * 60 * 60 * 1000
  );

  if (submitted.getTime() > deadline.getTime()) {
    return {
      chargeable: true,
      reason: "late_excuse"
    };
  }

  return {
    chargeable: false,
    reason: "valid_excuse"
  };
}

function cairoDateTimeToDate(
  sessionDate,
  startTime
) {
  if (!sessionDate || !startTime) {
    return null;
  }

  const match = String(startTime).match(
    /^(\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return null;
  }

  const yearMonthDay =
    String(sessionDate).slice(0, 10);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  /*
   * Convert Cairo wall-clock time to an absolute Date
   * using the real Africa/Cairo timezone rules.
   *
   * لا نستخدم +02:00 أو +03:00 ثابتة، لأن القاهرة
   * قد تنتقل بين التوقيت الشتوي والصيفي.
   */
  const localAsUtc = new Date(
    `${yearMonthDay}T` +
    `${String(hour).padStart(2, "0")}:` +
    `${String(minute).padStart(2, "0")}:` +
    `${String(second).padStart(2, "0")}Z`
  );

  if (Number.isNaN(localAsUtc.getTime())) {
    return null;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }
    ).formatToParts(localAsUtc);

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const cairoAsUtc = new Date(
    `${values.year}-${values.month}-${values.day}T` +
    `${values.hour}:${values.minute}:${values.second}Z`
  );

  if (Number.isNaN(cairoAsUtc.getTime())) {
    return null;
  }

  const offset =
    cairoAsUtc.getTime() -
    localAsUtc.getTime();

  const result =
    new Date(
      localAsUtc.getTime() -
      offset
    );

  return Number.isNaN(result.getTime())
    ? null
    : result;
}

function calculateSessionChargeabilityCairo({
  attendanceStatus,
  excuseSubmittedAt,
  excuseStatus,
  excuseDeadlineHours = 4,
  lateExcuseIsChargeable = true,
  absentWithoutExcuseIsChargeable = true,
  excusedAbsenceIsChargeable = false,
  cancelledByAcademyIsChargeable = false,
  sessionDate,
  sessionStartTime,
  academyCancelled = false
}) {
  if (academyCancelled) {
    return {
      chargeable: Boolean(cancelledByAcademyIsChargeable),
      reason: cancelledByAcademyIsChargeable
        ? "cancelled_by_academy"
        : "cancelled_by_academy"
    };
  }

  const status =
    String(attendanceStatus || "")
      .trim()
      .toLowerCase();

  const excuse =
    String(excuseStatus || "")
      .trim()
      .toLowerCase();

  if (
    status === "present" ||
    status === "late"
  ) {
    return {
      chargeable: false,
      reason: status
    };
  }

  if (
    status !== "absent" &&
    status !== "no_show" &&
    status !== "" &&
    status !== "excused"
  ) {
    return {
      chargeable: false,
      reason: "not_chargeable"
    };
  }

  /*
   * الاعتذار المرفوض = الغياب قابل للفوترة.
   * الرفض يتغلب على كون الاعتذار قد قُدم مبكرًا.
   */
  if (excuse === "rejected") {
    return {
      chargeable: true,
      reason: "rejected_excuse"
    };
  }

  /*
   * الاعتذار المقبول لا يصبح معفيًا من الفوترة إلا
   * إذا كان قد قُدم في الموعد.
   *
   * لذلك نؤجل الحكم على approved إلى ما بعد حساب
   * موعد المهلة، حتى لا يؤدي اعتماد اعتذار متأخر
   * إلى إلغاء رسوم الجلسة تلقائيًا.
   */

  /*
   * حالة attendance = excused القديمة/اليدوية.
   * لا نكسر السجلات القديمة التي لا تحتوي على attendance_excuses.
   */
  if (
    status === "excused" &&
    !excuse
  ) {
    return {
      chargeable: Boolean(excusedAbsenceIsChargeable),
      reason: "excused_absence"
    };
  }

  const sessionStart =
    cairoDateTimeToDate(
      sessionDate,
      sessionStartTime
    );

  /*
   * إذا تعذر تحديد بداية الجلسة،
   * لا يمكن إثبات أن الاعتذار قُدم في الموعد.
   */
  if (!sessionStart) {
    return {
      chargeable: Boolean(absentWithoutExcuseIsChargeable),
      reason: "absence_without_valid_session_time"
    };
  }

  const deadline =
    new Date(
      sessionStart.getTime() -
      Number(excuseDeadlineHours) * 60 * 60 * 1000
    );

  /*
   * الاعتذار موجود لكنه ما زال قيد المراجعة.
   * إذا كان في الموعد فهو غير قابل للفوترة مؤقتًا.
   */
  if (
    excuse === "pending" &&
    excuseSubmittedAt
  ) {
    const submitted =
      new Date(excuseSubmittedAt);

    if (
      !Number.isNaN(submitted.getTime())
    ) {
      if (
        submitted.getTime() <=
        deadline.getTime()
      ) {
        return {
          chargeable: false,
          reason: "pending_valid_excuse"
        };
      }

      return {
        chargeable: Boolean(lateExcuseIsChargeable),
        reason: "late_excuse"
      };
    }
  }

  /*
   * قبل انتهاء المهلة:
   * عدم وجود اعتذار حتى الآن لا يجعل الغياب مدفوعًا.
   */
  if (
    new Date().getTime() <=
    deadline.getTime()
  ) {
    return {
      chargeable: false,
      reason: "excuse_deadline_not_reached"
    };
  }

  /*
   * انتهت المهلة ولم يقدم الطالب اعتذارًا.
   */
  if (!excuseSubmittedAt) {
    return {
      chargeable: Boolean(absentWithoutExcuseIsChargeable),
      reason: "absence_without_excuse"
    };
  }

  const submitted =
    new Date(excuseSubmittedAt);

  if (
    Number.isNaN(
      submitted.getTime()
    )
  ) {
    return {
      chargeable: Boolean(absentWithoutExcuseIsChargeable),
      reason: "absence_without_valid_excuse_time"
    };
  }

  /*
   * الاعتذار قُدم بعد الموعد.
   */
  if (
    submitted.getTime() >
    deadline.getTime()
  ) {
    return {
      chargeable: Boolean(lateExcuseIsChargeable),
      reason: "late_excuse"
    };
  }

  /*
   * اعتذار في الموعد ولم تتم مراجعته بعد.
   */
  return {
    chargeable: false,
    reason: "valid_excuse"
  };
}

async function getAutomaticSessionBilling(
  db,
  {
    studentId,
    subscriptionId,
    periodStart,
    periodEnd
  }
) {
  if (
    !studentId ||
    !subscriptionId
  ) {
    return {
      plannedSessions: 0,
      scheduledSessions: 0,
      completedSessions: 0,
      cancelledSessions: 0,
      chargeableSessions: 0,
      sessionAmount: 0,
      sessionUnitPrice: 0,
      items: []
    };
  }

  const subscription =
    await getSubscription(
      db,
      Number(subscriptionId)
    );

  if (!subscription) {
    return {
      plannedSessions: 0,
      scheduledSessions: 0,
      completedSessions: 0,
      cancelledSessions: 0,
      chargeableSessions: 0,
      sessionAmount: 0,
      sessionUnitPrice: 0,
      items: []
    };
  }

  const excuseRules =
    await db
      .prepare(`
        SELECT
          excuse_deadline_hours,
          late_excuse_is_chargeable,
          absent_without_excuse_is_chargeable,
          excused_absence_is_chargeable,
          cancelled_by_academy_is_chargeable
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

  const lateExcuseIsChargeable =
    Number(
      excuseRules?.late_excuse_is_chargeable ?? 1
    ) === 1;

  const absentWithoutExcuseIsChargeable =
    Number(
      excuseRules?.absent_without_excuse_is_chargeable ?? 1
    ) === 1;

  const excusedAbsenceIsChargeable =
    Number(
      excuseRules?.excused_absence_is_chargeable ?? 0
    ) === 1;

  const cancelledByAcademyIsChargeable =
    Number(
      excuseRules?.cancelled_by_academy_is_chargeable ?? 0
    ) === 1;

  const result =
    await db
      .prepare(`
        SELECT
          a.id AS attendance_id,
          ?1 AS student_id,
          s.id AS session_id,
          a.status AS attendance_status,

          s.session_date,
          s.start_time,
          s.status AS session_status,
          s.circle_id,

          ae.submitted_at AS excuse_submitted_at,
          ae.status AS excuse_status

        FROM sessions s

        LEFT JOIN attendance a
          ON a.session_id = s.id
         AND a.student_id = ?1

        LEFT JOIN attendance_excuses ae
          ON ae.attendance_id = a.id

        WHERE s.session_date >= ?2
          AND s.session_date <= ?3

          AND s.session_date >=
              COALESCE(
                ?6,
                s.session_date
              )

          AND (
            s.session_date <=
              COALESCE(
                ?7,
                s.session_date
              )
          )

          AND (
            (
              ?4 != -1
              AND s.circle_id = ?4
            )
            OR EXISTS (
              SELECT 1
              FROM individual_schedule_bookings isb
              WHERE isb.session_id = s.id
                AND isb.student_id = ?1
                AND isb.subscription_id = ?5
            )
          )

        ORDER BY
          s.session_date ASC,
          s.start_time ASC,
          s.id ASC
      `)
      .bind(
        Number(studentId),
        periodStart,
        periodEnd,
        subscription.circle_id === null
          ? -1
          : Number(subscription.circle_id),
        Number(subscriptionId),
        subscription.start_date || null,
        subscription.end_date || null
      )
      .all();

  const rows =
    result.results || [];

  let scheduledSessions = 0;
  let completedSessions = 0;
  let cancelledSessions = 0;
  let chargeableSessions = 0;

  const items = [];

  for (const row of rows) {
    const sessionStatus =
      String(
        row.session_status || ""
      )
        .trim()
        .toLowerCase();

    if (sessionStatus === "scheduled") {
      scheduledSessions += 1;
    } else if (
      sessionStatus === "completed"
    ) {
      completedSessions += 1;
    } else if (
      sessionStatus === "cancelled"
    ) {
      cancelledSessions += 1;
    }

    const decision =
      calculateSessionChargeabilityCairo({
        attendanceStatus:
          row.attendance_status,
        excuseSubmittedAt:
          row.excuse_submitted_at,
        excuseStatus:
          row.excuse_status,
        sessionDate:
          row.session_date,
        sessionStartTime:
          row.start_time,
        excuseDeadlineHours,
        lateExcuseIsChargeable,
        absentWithoutExcuseIsChargeable,
        excusedAbsenceIsChargeable,
        cancelledByAcademyIsChargeable,
        academyCancelled:
          sessionStatus === "cancelled"
      });

    if (decision.chargeable) {
      chargeableSessions += 1;
    }

    items.push({
      sessionId:
        Number(row.session_id),
      attendanceId:
        Number(row.attendance_id),
      sessionDate:
        row.session_date,
      chargeable:
        decision.chargeable ? 1 : 0,
      reason:
        decision.reason
    });
  }

  const sessionsPerMonth =
    Number(
      subscription.sessions_per_month || 0
    );

  const packagePrice =
    Number(
      subscription.package_price || 0
    );

  const sessionUnitPrice =
    sessionsPerMonth > 0
      ? money(
          packagePrice /
          sessionsPerMonth
        )
      : 0;

  const sessionAmount =
    money(
      chargeableSessions *
      sessionUnitPrice
    );

  return {
    plannedSessions:
      rows.length,
    scheduledSessions,
    completedSessions,
    cancelledSessions,
    chargeableSessions,
    sessionAmount,
    sessionUnitPrice,
    items
  };
}

async function replaceBillingSessionItems(
  db,
  billingCycleId,
  studentId,
  automaticBilling
) {
  await db
    .prepare(`
      DELETE FROM billing_session_items
      WHERE billing_cycle_id = ?1
    `)
    .bind(
      Number(billingCycleId)
    )
    .run();

  for (
    const item of automaticBilling.items
  ) {
    const amount =
      item.chargeable
        ? automaticBilling.sessionUnitPrice
        : 0;

    await db
      .prepare(`
        INSERT INTO billing_session_items (
          billing_cycle_id,
          session_id,
          student_id,
          session_date,
          chargeable,
          amount,
          reason,
          created_at
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6,
          ?7,
          ?8
        )
      `)
      .bind(
        Number(billingCycleId),
        Number(item.sessionId),
        Number(studentId),
        item.sessionDate,
        Number(item.chargeable),
        amount,
        item.reason,
        now()
      )
      .run();
  }
}

async function getBillingSettings(db) {
  try {
    const row = await db
      .prepare(`
        SELECT
          id,
          billing_day,
          default_due_day,
          currency,
          count_scheduled_sessions,
          count_completed_sessions,
          count_cancelled_sessions,
          charge_cancelled_sessions,
          create_cycle_automatically,
          calculate_sessions_automatically,
          issue_invoice_automatically,
          send_invoice_notification,
          active
        FROM billing_settings
        WHERE id = 1
        LIMIT 1
      `)
      .first();

    return (
      row || {
        id: 1,
        billing_day: 1,
        default_due_day: 7,
        currency: "EGP",
        count_scheduled_sessions: 1,
        count_completed_sessions: 1,
        count_cancelled_sessions: 0,
        charge_cancelled_sessions: 0,
        create_cycle_automatically: 1,
        calculate_sessions_automatically: 1,
        issue_invoice_automatically: 1,
        send_invoice_notification: 1,
        active: 1,
      }
    );
  } catch {
    return {
      id: 1,
      billing_day: 1,
      default_due_day: 7,
      currency: "EGP",
      count_scheduled_sessions: 1,
      count_completed_sessions: 1,
      count_cancelled_sessions: 0,
      charge_cancelled_sessions: 0,
      create_cycle_automatically: 1,
      calculate_sessions_automatically: 1,
      issue_invoice_automatically: 1,
      send_invoice_notification: 1,
      active: 1,
    };
  }
}

async function getBillingMonthRules(db) {
  try {
    const row = await db
      .prepare(`
        SELECT
          id,
          cycle_anchor,
          period_type,
          new_student_starts_next_month,
          calculate_price_before_start,
          notify_student_before_cycle,
          active
        FROM billing_month_rules
        WHERE id = 1
        LIMIT 1
      `)
      .first();

    return (
      row || {
        id: 1,
        cycle_anchor: "first_day_of_month",
        period_type: "calendar_month",
        new_student_starts_next_month: 1,
        calculate_price_before_start: 0,
        notify_student_before_cycle: 1,
        active: 1,
      }
    );
  } catch {
    return {
      id: 1,
      cycle_anchor: "first_day_of_month",
      period_type: "calendar_month",
      new_student_starts_next_month: 1,
      calculate_price_before_start: 0,
      notify_student_before_cycle: 1,
      active: 1,
    };
  }
}

async function getStudentBillingSettings(db, studentId) {
  try {
    return await db
      .prepare(`
        SELECT
          id,
          student_id,
          billing_start_date,
          billing_day,
          due_day,
          billing_mode,
          count_from_new_month,
          active
        FROM student_billing_settings
        WHERE student_id = ?1
        LIMIT 1
      `)
      .bind(studentId)
      .first();
  } catch {
    return null;
  }
}

async function getStudentBillingStart(
  db,
  studentId,
  subscriptionId,
  billingMonth
) {
  try {
    let row;

    if (subscriptionId) {
      row = await db
        .prepare(`
          SELECT
            id,
            student_id,
            subscription_id,
            billing_start_date,
            first_billing_month,
            status
          FROM student_billing_starts
          WHERE student_id = ?1
            AND subscription_id = ?2
            AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        `)
        .bind(studentId, subscriptionId)
        .first();
    } else {
      row = await db
        .prepare(`
          SELECT
            id,
            student_id,
            subscription_id,
            billing_start_date,
            first_billing_month,
            status
          FROM student_billing_starts
          WHERE student_id = ?1
            AND subscription_id IS NULL
            AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        `)
        .bind(studentId)
        .first();
    }

    if (!row) {
      return null;
    }

    if (
      validMonth(row.first_billing_month) &&
      row.first_billing_month > billingMonth
    ) {
      return {
        ...row,
        not_started: true,
      };
    }

    return row;
  } catch {
    return null;
  }
}

/* =========================================================
   Student
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
   Subscription
========================================================= */

async function getSubscription(db, subscriptionId) {
  if (!subscriptionId) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        sub.id,
        sub.student_id,
        sub.package_id,
        sub.circle_id,
        sub.start_date,
        sub.end_date,
        sub.status,

        p.name AS package_name,
        p.price AS package_price,
        p.currency AS package_currency,
        p.sessions_per_month,
        p.duration_minutes

      FROM subscriptions sub

      JOIN packages p
        ON p.id = sub.package_id

      WHERE sub.id = ?1
      LIMIT 1
    `)
    .bind(subscriptionId)
    .first();
}

/* =========================================================
   Billing Cycle
========================================================= */

async function getBillingCycle(
  db,
  billingCycleId
) {
  const cycle = await db
    .prepare(`
      SELECT
        bc.*,
        st.full_name AS student_name,
        sub.package_id,
        sub.circle_id,
        sub.status AS subscription_status
      FROM billing_cycles bc
      JOIN students st
        ON st.id = bc.student_id
      LEFT JOIN subscriptions sub
        ON sub.id = bc.subscription_id
      WHERE bc.id = ?1
      LIMIT 1
    `)
    .bind(billingCycleId)
    .first();

  if (!cycle) {
    return null;
  }

  const items = await db
    .prepare(`
      SELECT
        id,
        billing_cycle_id,
        item_type,
        description,
        quantity,
        unit_price,
        amount,
        reference_type,
        reference_id,
        created_at
      FROM billing_cycle_items
      WHERE billing_cycle_id = ?1
      ORDER BY id ASC
    `)
    .bind(billingCycleId)
    .all();

  return {
    ...cycle,
    items: items.results || [],
  };
}

/* =========================================================
   Validate invoice items BEFORE creating the cycle
   حتى لا يتم إنشاء دورة ناقصة إذا كان أحد البنود خاطئًا.
========================================================= */

function validateItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return {
      valid: true,
      items: [],
    };
  }

  const items = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") {
      return {
        valid: false,
        error: "INVALID_BILLING_ITEM",
      };
    }

    const itemType = clean(
      item.item_type ??
        item.itemType
    ).toLowerCase();

    if (!BILLING_ITEM_TYPES.includes(itemType)) {
      return {
        valid: false,
        error: "INVALID_BILLING_ITEM_TYPE",
        extra: {
          item_type: itemType,
        },
      };
    }

    const description = clean(
      item.description
    );

    if (!description) {
      return {
        valid: false,
        error:
          "BILLING_ITEM_DESCRIPTION_REQUIRED",
      };
    }

    const quantity = nonNegativeNumber(
      item.quantity ?? 1
    );

    const unitPrice = nonNegativeNumber(
      item.unit_price ??
        item.unitPrice ??
        0
    );

    const amount = nonNegativeNumber(
      item.amount ??
        Number(quantity ?? 0) *
          Number(unitPrice ?? 0)
    );

    if (
      quantity === null ||
      unitPrice === null ||
      amount === null
    ) {
      return {
        valid: false,
        error:
          "INVALID_BILLING_ITEM_AMOUNT",
      };
    }

    const referenceIdValue =
      item.reference_id ??
      item.referenceId;

    const referenceId =
      referenceIdValue !== undefined &&
      referenceIdValue !== null &&
      referenceIdValue !== ""
        ? validId(referenceIdValue)
          ? Number(referenceIdValue)
          : null
        : null;

    if (
      referenceIdValue !== undefined &&
      referenceIdValue !== null &&
      referenceIdValue !== "" &&
      referenceId === null
    ) {
      return {
        valid: false,
        error:
          "INVALID_BILLING_ITEM_REFERENCE_ID",
      };
    }

    items.push({
      itemType,
      description,
      quantity,
      unitPrice,
      amount,
      referenceType: nullable(
        item.reference_type ??
          item.referenceType
      ),
      referenceId,
    });
  }

  return {
    valid: true,
    items,
  };
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(context) {
  const permission = await requirePermission(context.request, context.env, "billing-cycles.read");
  if (!permission.ok) return permission.response;
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const url =
    new URL(context.request.url);

  const id =
    url.searchParams.get("id");

  const studentId =
    url.searchParams.get("student_id");

  const subscriptionId =
    url.searchParams.get("subscription_id");

  const billingMonth =
    clean(
      url.searchParams.get("billing_month")
    );

  const status =
    clean(
      url.searchParams.get("status")
    ).toLowerCase();

  try {
    if (id) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_BILLING_CYCLE_ID"
        );
      }

      const cycle =
        await getBillingCycle(
          db,
          Number(id)
        );

      if (!cycle) {
        return errorResponse(
          "BILLING_CYCLE_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: cycle,
      });
    }

    let sql = `
      SELECT
        bc.*,
        st.full_name AS student_name
      FROM billing_cycles bc
      JOIN students st
        ON st.id = bc.student_id
      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      if (!validId(studentId)) {
        return errorResponse(
          "INVALID_STUDENT_ID"
        );
      }

      params.push(Number(studentId));

      sql += `
        AND bc.student_id = ?${params.length}
      `;
    }

    if (subscriptionId) {
      if (!validId(subscriptionId)) {
        return errorResponse(
          "INVALID_SUBSCRIPTION_ID"
        );
      }

      params.push(
        Number(subscriptionId)
      );

      sql += `
        AND bc.subscription_id = ?${params.length}
      `;
    }

    if (billingMonth) {
      if (!validMonth(billingMonth)) {
        return errorResponse(
          "INVALID_BILLING_MONTH"
        );
      }

      params.push(billingMonth);

      sql += `
        AND bc.billing_month = ?${params.length}
      `;
    }

    if (status) {
      const statusError =
        validateStatus(status);

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      params.push(status);

      sql += `
        AND bc.status = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        bc.billing_month DESC,
        bc.id DESC
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
      "BILLING_CYCLES_GET_ERROR",
      error
    );

    return errorResponse(
      "BILLING_CYCLES_FETCH_FAILED",
      500
    );
  }
}

/* =========================================================
   POST
========================================================= */

export async function onRequestPost(context) {
  const permission = await requirePermission(context.request, context.env, "billing-cycles.write");
  if (!permission.ok) return permission.response;
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
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return errorResponse(
      "INVALID_REQUEST_BODY"
    );
  }

  const studentId = Number(
    data.student_id ??
      data.studentId
  );

  const subscriptionValue =
    data.subscription_id ??
    data.subscriptionId;

  const subscriptionId =
    subscriptionValue === undefined ||
    subscriptionValue === null ||
    subscriptionValue === ""
      ? null
      : Number(subscriptionValue);

  const requestedBillingMonth =
    clean(
      data.billing_month ??
        data.billingMonth
    );

  const billingMonth =
    requestedBillingMonth ||
    currentMonth();

  const currency =
    clean(data.currency)
      .toUpperCase();

  const requestedStatus =
    clean(
      data.status || "open"
    ).toLowerCase();

  if (!validId(studentId)) {
    return errorResponse(
      "STUDENT_ID_REQUIRED"
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

  if (!validMonth(billingMonth)) {
    return errorResponse(
      "INVALID_BILLING_MONTH"
    );
  }

  const statusError =
    validateStatus(requestedStatus);

  if (statusError) {
    return errorResponse(
      statusError
    );
  }

  const plannedSessions =
    nonNegativeInteger(
      data.planned_sessions ??
        data.plannedSessions ??
        0
    );

  const scheduledSessions =
    nonNegativeInteger(
      data.scheduled_sessions ??
        data.scheduledSessions ??
        0
    );

  const completedSessions =
    nonNegativeInteger(
      data.completed_sessions ??
        data.completedSessions ??
        0
    );

  const cancelledSessions =
    nonNegativeInteger(
      data.cancelled_sessions ??
        data.cancelledSessions ??
        0
    );

  const chargeableSessions =
    nonNegativeInteger(
      data.chargeable_sessions ??
        data.chargeableSessions ??
        0
    );

  if (
    plannedSessions === null ||
    scheduledSessions === null ||
    completedSessions === null ||
    cancelledSessions === null ||
    chargeableSessions === null
  ) {
    return errorResponse(
      "INVALID_SESSION_COUNTS"
    );
  }

  const packageAmount =
    nonNegativeNumber(
      data.package_amount ??
        data.packageAmount ??
        0
    );

  const sessionAmount =
    nonNegativeNumber(
      data.session_amount ??
        data.sessionAmount ??
        0
    );

  const discountAmount =
    nonNegativeNumber(
      data.discount_amount ??
        data.discountAmount ??
        0
    );

  const exemptionAmount =
    nonNegativeNumber(
      data.exemption_amount ??
        data.exemptionAmount ??
        0
    );

  const fineAmount =
    nonNegativeNumber(
      data.fine_amount ??
        data.fineAmount ??
        0
    );

  const paidAmount =
    nonNegativeNumber(
      data.paid_amount ??
        data.paidAmount ??
        0
    );

  if (
    packageAmount === null ||
    sessionAmount === null ||
    discountAmount === null ||
    exemptionAmount === null ||
    fineAmount === null ||
    paidAmount === null
  ) {
    return errorResponse(
      "INVALID_BILLING_AMOUNT"
    );
  }

  const periodStart =
    clean(
      data.period_start ??
        data.periodStart
    ) ||
    firstDayOfMonth(
      billingMonth
    );

  const periodEnd =
    clean(
      data.period_end ??
        data.periodEnd
    ) ||
    lastDayOfMonth(
      billingMonth
    );

  if (!validDate(periodStart)) {
    return errorResponse(
      "INVALID_PERIOD_START"
    );
  }

  if (!validDate(periodEnd)) {
    return errorResponse(
      "INVALID_PERIOD_END"
    );
  }

  if (periodEnd < periodStart) {
    return errorResponse(
      "PERIOD_END_BEFORE_START"
    );
  }

  /*
   * مهم:
   * نتحقق من البنود قبل INSERT.
   * هذا يمنع إنشاء billing_cycle ناقص
   * ثم اكتشاف خطأ في item لاحقًا.
   */
  const itemsValidation =
    validateItems(data.items);

  if (!itemsValidation.valid) {
    return errorResponse(
      itemsValidation.error,
      400,
      itemsValidation.extra || {}
    );
  }

  const items =
    itemsValidation.items;

  try {
    const settings =
      await getBillingSettings(db);

    const monthRules =
      await getBillingMonthRules(db);

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

    let subscription = null;

    if (subscriptionId !== null) {
      subscription =
        await getSubscription(
          db,
          subscriptionId
        );

      if (!subscription) {
        return errorResponse(
          "SUBSCRIPTION_NOT_FOUND",
          404
        );
      }

      if (
        Number(
          subscription.student_id
        ) !== studentId
      ) {
        return errorResponse(
          "SUBSCRIPTION_DOES_NOT_BELONG_TO_STUDENT",
          409
        );
      }
    }

    const studentSettings =
      await getStudentBillingSettings(
        db,
        studentId
      );

    const billingStart =
      await getStudentBillingStart(
        db,
        studentId,
        subscriptionId,
        billingMonth
      );

    if (
      billingStart?.not_started
    ) {
      return errorResponse(
        "BILLING_MONTH_NOT_STARTED_FOR_STUDENT",
        409,
        {
          first_billing_month:
            billingStart.first_billing_month,
        }
      );
    }

    const configuredStartMonth =
      billingStart?.first_billing_month ||
      (
        studentSettings?.billing_start_date
          ? String(
              studentSettings.billing_start_date
            ).slice(0, 7)
          : null
      ) ||
      (
        subscription?.start_date
          ? String(
              subscription.start_date
            ).slice(0, 7)
          : null
      );

    if (
      monthRules.new_student_starts_next_month &&
      configuredStartMonth &&
      billingMonth < configuredStartMonth
    ) {
      return errorResponse(
        "BILLING_MONTH_BEFORE_STUDENT_START",
        409,
        {
          first_billing_month:
            configuredStartMonth,
        }
      );
    }

    const automaticBilling =
      subscriptionId !== null &&
      studentSettings?.billing_mode !== "manual" &&
      Number(
        settings.calculate_sessions_automatically ?? 1
      ) === 1
        ? await getAutomaticSessionBilling(
            db,
            {
              studentId,
              subscriptionId,
              periodStart,
              periodEnd
            }
          )
        : null;

    const finalPlannedSessions =
      automaticBilling
        ? automaticBilling.plannedSessions
        : plannedSessions;

    const finalScheduledSessions =
      automaticBilling
        ? automaticBilling.scheduledSessions
        : scheduledSessions;

    const finalCompletedSessions =
      automaticBilling
        ? automaticBilling.completedSessions
        : completedSessions;

    const finalCancelledSessions =
      automaticBilling
        ? automaticBilling.cancelledSessions
        : cancelledSessions;

    const finalChargeableSessions =
      automaticBilling
        ? automaticBilling.chargeableSessions
        : chargeableSessions;

    const finalSessionAmount =
      automaticBilling
        ? automaticBilling.sessionAmount
        : sessionAmount;

    const finalCurrency =
      currency ||
      clean(settings.currency).toUpperCase() ||
      "EGP";

    const totalAmount =
      calculateTotal({
        packageAmount,
        sessionAmount: finalSessionAmount,
        discountAmount,
        exemptionAmount,
        fineAmount,
      });

    if (paidAmount > totalAmount) {
      return errorResponse(
        "PAID_AMOUNT_EXCEEDS_TOTAL",
        409
      );
    }

    const remainingAmount =
      money(
        Math.max(
          0,
          totalAmount - paidAmount
        )
      );

    const finalStatus =
      calculateStatus(
        totalAmount,
        paidAmount,
        requestedStatus
      );

    const defaultDueDay =
      Number(
        studentSettings?.due_day ??
          settings.default_due_day ??
          7
      );

    const dueDay =
      Math.min(
        28,
        Math.max(
          1,
          Number.isInteger(defaultDueDay)
            ? defaultDueDay
            : 7
        )
      );

    const defaultIssuedAt =
      settings.issue_invoice_automatically
        ? now()
        : null;

    const issuedAt =
      data.issued_at !== undefined ||
      data.issuedAt !== undefined
        ? nullable(
            data.issued_at ??
              data.issuedAt
          )
        : defaultIssuedAt;

    const dueAt =
      data.due_at !== undefined ||
      data.dueAt !== undefined
        ? nullable(
            data.due_at ??
              data.dueAt
          )
        : `${billingMonth}-${String(
            dueDay
          ).padStart(2, "0")}T23:59:59.000Z`;

    const paidAt =
      paidAmount >= totalAmount &&
      totalAmount > 0
        ? now()
        : nullable(
            data.paid_at ??
              data.paidAt
          );

    const notes =
      nullable(data.notes);

    /*
     * مهم جدًا:
     * نستخدم IS بدل = لأن subscription_id
     * يمكن أن يكون NULL في SQLite.
     *
     * هذا يمنع تكرار دورة الطالب لنفس الشهر
     * عند الاستدعاءات العادية.
     */
    const existing =
      await db
        .prepare(`
          SELECT id
          FROM billing_cycles
          WHERE student_id = ?1
            AND subscription_id IS ?2
            AND billing_month = ?3
          LIMIT 1
        `)
        .bind(
          studentId,
          subscriptionId,
          billingMonth
        )
        .first();

    if (existing) {
      return errorResponse(
        "BILLING_CYCLE_ALREADY_EXISTS",
        409,
        {
          billing_cycle_id:
            existing.id,
        }
      );
    }

    const created =
      await db
        .prepare(`
          INSERT INTO billing_cycles (
            student_id,
            subscription_id,
            billing_month,
            period_start,
            period_end,
            currency,

            planned_sessions,
            scheduled_sessions,
            completed_sessions,
            cancelled_sessions,
            chargeable_sessions,

            package_amount,
            session_amount,

            discount_amount,
            exemption_amount,
            fine_amount,

            total_amount,
            paid_amount,
            remaining_amount,

            status,

            issued_at,
            due_at,
            paid_at,

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

            ?12,
            ?13,

            ?14,
            ?15,
            ?16,

            ?17,
            ?18,
            ?19,

            ?20,

            ?21,
            ?22,
            ?23,

            ?24,
            ?25,
            ?26
          )
        `)
        .bind(
          studentId,
          subscriptionId,
          billingMonth,
          periodStart,
          periodEnd,
          finalCurrency,

          finalPlannedSessions,
          finalScheduledSessions,
          finalCompletedSessions,
          finalCancelledSessions,
          finalChargeableSessions,

          packageAmount,
          finalSessionAmount,

          discountAmount,
          exemptionAmount,
          fineAmount,

          totalAmount,
          paidAmount,
          remainingAmount,

          finalStatus,

          issuedAt,
          dueAt,
          paidAt,

          notes,
          now()
        )
        .run();

    const billingCycleId =
      created.meta?.last_row_id;

    if (!billingCycleId) {
      return errorResponse(
        "BILLING_CYCLE_CREATE_FAILED",
        500
      );
    }

    /*
     * البنود تم التحقق منها بالكامل قبل إنشاء الدورة،
     * لذلك هنا نضيفها فقط.
     */
    for (const item of items) {
      await db
        .prepare(`
          INSERT INTO billing_cycle_items (
            billing_cycle_id,
            item_type,
            description,
            quantity,
            unit_price,
            amount,
            reference_type,
            reference_id,
            created_at
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
            ?9
          )
        `)
        .bind(
          billingCycleId,
          item.itemType,
          item.description,
          item.quantity,
          item.unitPrice,
          item.amount,
          item.referenceType,
          item.referenceId,
          now()
        )
        .run();
    }

    if (automaticBilling) {
      await replaceBillingSessionItems(
        db,
        billingCycleId,
        studentId,
        automaticBilling
      );
    }

    return json(
      {
        success: true,
        message:
          "BILLING_CYCLE_CREATED_SUCCESSFULLY",
        data:
          await getBillingCycle(
            db,
            billingCycleId
          ),
      },
      201
    );
  } catch (error) {
    console.error(
      "BILLING_CYCLES_POST_ERROR",
      error
    );

    /*
     * في حالة اصطدام INSERT بفهرس UNIQUE
     * نعيد رسالة مفهومة بدل خطأ داخلي عام فقط.
     */
    const message =
      clean(error?.message).toLowerCase();

    if (
      message.includes("unique") ||
      message.includes("constraint")
    ) {
      return errorResponse(
        "BILLING_CYCLE_ALREADY_EXISTS",
        409
      );
    }

    return errorResponse(
      "BILLING_CYCLE_CREATE_FAILED",
      500
    );
  }
}

/* =========================================================
   PATCH
========================================================= */

export async function onRequestPatch(context) {
  const permission = await requirePermission(context.request, context.env, "billing-cycles.write");
  if (!permission.ok) return permission.response;
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
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return errorResponse(
      "INVALID_REQUEST_BODY"
    );
  }

  const billingCycleId =
    data.id ??
    data.billing_cycle_id ??
    data.billingCycleId;

  if (!validId(billingCycleId)) {
    return errorResponse(
      "BILLING_CYCLE_ID_REQUIRED"
    );
  }

  try {
    const current =
      await db
        .prepare(`
          SELECT *
          FROM billing_cycles
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(
          Number(billingCycleId)
        )
        .first();

    if (!current) {
      return errorResponse(
        "BILLING_CYCLE_NOT_FOUND",
        404
      );
    }

    const patchSettings =
      await getBillingSettings(db);

    const patchStudentSettings =
      await getStudentBillingSettings(
        db,
        Number(current.student_id)
      );

    const automaticBilling =
      current.subscription_id &&
      patchStudentSettings?.billing_mode !== "manual" &&
      Number(
        patchSettings.calculate_sessions_automatically ?? 1
      ) === 1
        ? await getAutomaticSessionBilling(
            db,
            {
              studentId:
                Number(current.student_id),
              subscriptionId:
                Number(current.subscription_id),
              periodStart:
                current.period_start,
              periodEnd:
                current.period_end
            }
          )
        : null;

    const packageAmount =
      data.package_amount !== undefined ||
      data.packageAmount !== undefined
        ? nonNegativeNumber(
            data.package_amount ??
              data.packageAmount
          )
        : Number(
            current.package_amount
          );

    const sessionAmount =
      automaticBilling
        ? automaticBilling.sessionAmount
        : (
            data.session_amount !== undefined ||
            data.sessionAmount !== undefined
              ? nonNegativeNumber(
                  data.session_amount ??
                    data.sessionAmount
                )
              : Number(
                  current.session_amount
                )
          );

    const discountAmount =
      data.discount_amount !== undefined ||
      data.discountAmount !== undefined
        ? nonNegativeNumber(
            data.discount_amount ??
              data.discountAmount
          )
        : Number(
            current.discount_amount
          );

    const exemptionAmount =
      data.exemption_amount !== undefined ||
      data.exemptionAmount !== undefined
        ? nonNegativeNumber(
            data.exemption_amount ??
              data.exemptionAmount
          )
        : Number(
            current.exemption_amount
          );

    const fineAmount =
      data.fine_amount !== undefined ||
      data.fineAmount !== undefined
        ? nonNegativeNumber(
            data.fine_amount ??
              data.fineAmount
          )
        : Number(
            current.fine_amount
          );

    const paidAmount =
      data.paid_amount !== undefined ||
      data.paidAmount !== undefined
        ? nonNegativeNumber(
            data.paid_amount ??
              data.paidAmount
          )
        : Number(
            current.paid_amount
          );

    if (
      packageAmount === null ||
      sessionAmount === null ||
      discountAmount === null ||
      exemptionAmount === null ||
      fineAmount === null ||
      paidAmount === null
    ) {
      return errorResponse(
        "INVALID_BILLING_AMOUNT"
      );
    }

    const totalAmount =
      calculateTotal({
        packageAmount,
        sessionAmount,
        discountAmount,
        exemptionAmount,
        fineAmount,
      });

    if (paidAmount > totalAmount) {
      return errorResponse(
        "PAID_AMOUNT_EXCEEDS_TOTAL",
        409
      );
    }

    const remainingAmount =
      money(
        Math.max(
          0,
          totalAmount - paidAmount
        )
      );

    const requestedStatus =
      data.status !== undefined
        ? clean(data.status)
            .toLowerCase()
        : current.status;

    const statusError =
      validateStatus(
        requestedStatus
      );

    if (statusError) {
      return errorResponse(
        statusError
      );
    }

    const finalStatus =
      calculateStatus(
        totalAmount,
        paidAmount,
        requestedStatus
      );

    const plannedSessions =
      data.planned_sessions !== undefined ||
      data.plannedSessions !== undefined
        ? nonNegativeInteger(
            data.planned_sessions ??
              data.plannedSessions
          )
        : Number(
            current.planned_sessions
          );

    const scheduledSessions =
      data.scheduled_sessions !== undefined ||
      data.scheduledSessions !== undefined
        ? nonNegativeInteger(
            data.scheduled_sessions ??
              data.scheduledSessions
          )
        : Number(
            current.scheduled_sessions
          );

    const completedSessions =
      data.completed_sessions !== undefined ||
      data.completedSessions !== undefined
        ? nonNegativeInteger(
            data.completed_sessions ??
              data.completedSessions
          )
        : Number(
            current.completed_sessions
          );

    const cancelledSessions =
      data.cancelled_sessions !== undefined ||
      data.cancelledSessions !== undefined
        ? nonNegativeInteger(
            data.cancelled_sessions ??
              data.cancelledSessions
          )
        : Number(
            current.cancelled_sessions
          );

    const chargeableSessions =
      automaticBilling
        ? automaticBilling.chargeableSessions
        : (
            data.chargeable_sessions !== undefined ||
            data.chargeableSessions !== undefined
              ? nonNegativeInteger(
                  data.chargeable_sessions ??
                    data.chargeableSessions
                )
              : Number(
                  current.chargeable_sessions
                )
          );

    if (
      plannedSessions === null ||
      scheduledSessions === null ||
      completedSessions === null ||
      cancelledSessions === null ||
      chargeableSessions === null
    ) {
      return errorResponse(
        "INVALID_SESSION_COUNTS"
      );
    }

    const issuedAt =
      data.issued_at !== undefined ||
      data.issuedAt !== undefined
        ? nullable(
            data.issued_at ??
              data.issuedAt
          )
        : current.issued_at;

    const dueAt =
      data.due_at !== undefined ||
      data.dueAt !== undefined
        ? nullable(
            data.due_at ??
              data.dueAt
          )
        : current.due_at;

    let paidAt;

    if (
      paidAmount >= totalAmount &&
      totalAmount > 0
    ) {
      paidAt =
        current.paid_at || now();
    } else if (
      data.paid_at !== undefined ||
      data.paidAt !== undefined
    ) {
      paidAt = nullable(
        data.paid_at ??
          data.paidAt
      );
    } else {
      paidAt = current.paid_at;
    }

    const notes =
      data.notes !== undefined
        ? nullable(data.notes)
        : current.notes;

    const updated =
      await db
        .prepare(`
          UPDATE billing_cycles
          SET
            planned_sessions = ?2,
            scheduled_sessions = ?3,
            completed_sessions = ?4,
            cancelled_sessions = ?5,
            chargeable_sessions = ?6,

            package_amount = ?7,
            session_amount = ?8,

            discount_amount = ?9,
            exemption_amount = ?10,
            fine_amount = ?11,

            total_amount = ?12,
            paid_amount = ?13,
            remaining_amount = ?14,

            status = ?15,

            issued_at = ?16,
            due_at = ?17,
            paid_at = ?18,

            notes = ?19,
            updated_at = ?20

          WHERE id = ?1
        `)
        .bind(
          Number(billingCycleId),

          automaticBilling
            ? automaticBilling.plannedSessions
            : plannedSessions,
          automaticBilling
            ? automaticBilling.scheduledSessions
            : scheduledSessions,
          automaticBilling
            ? automaticBilling.completedSessions
            : completedSessions,
          automaticBilling
            ? automaticBilling.cancelledSessions
            : cancelledSessions,
          automaticBilling
            ? automaticBilling.chargeableSessions
            : chargeableSessions,

          packageAmount,
          sessionAmount,
          discountAmount,
          exemptionAmount,
          fineAmount,

          totalAmount,
          paidAmount,
          remainingAmount,

          finalStatus,

          issuedAt,
          dueAt,
          paidAt,

          notes,

          now()
        )
        .run();

    if (!updated.success) {
      return errorResponse(
        "BILLING_CYCLE_UPDATE_FAILED",
        500
      );
    }

    if (automaticBilling) {
      await replaceBillingSessionItems(
        db,
        Number(billingCycleId),
        Number(current.student_id),
        automaticBilling
      );
    }

    const row =
      await getBillingCycle(
        db,
        Number(billingCycleId)
      );

    return json({
      success: true,
      message:
        "BILLING_CYCLE_UPDATED_SUCCESSFULLY",
      data: row,
    });
  } catch (error) {
    console.error(
      "BILLING_CYCLES_PATCH_ERROR",
      error
    );

    return errorResponse(
      "BILLING_CYCLE_UPDATE_FAILED",
      500
    );
  }
}

/* =========================================================
   Router
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
          allow: "GET, POST, PATCH",
        }
      );
  }
}
