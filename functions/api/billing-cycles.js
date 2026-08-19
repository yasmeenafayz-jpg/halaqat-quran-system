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

const ITEM_TYPES = [
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
  const valueClean = clean(value);
  return valueClean || null;
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

  return requestedStatus || "open";
}

/* =========================================================
   Billing Settings
========================================================= */

async function getBillingSettings(db) {
  const fallback = {
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

    return row || fallback;
  } catch {
    return fallback;
  }
}

/* =========================================================
   Billing Month Rules
========================================================= */

async function getBillingMonthRules(db) {
  const fallback = {
    id: 1,
    cycle_anchor: "first_day_of_month",
    period_type: "calendar_month",
    new_student_starts_next_month: 1,
    calculate_price_before_start: 0,
    notify_student_before_cycle: 1,
    active: 1,
  };

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

    return row || fallback;
  } catch {
    return fallback;
  }
}

/* =========================================================
   Student Billing Settings
========================================================= */

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

/* =========================================================
   Student Billing Start
========================================================= */

async function getStudentBillingStart(
  db,
  studentId,
  subscriptionId
) {
  try {
    if (subscriptionId !== null) {
      return await db
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
    }

    return await db
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
        id,
        student_id,
        package_id,
        circle_id,
        start_date,
        end_date,
        status
      FROM subscriptions
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(subscriptionId)
    .first();
}

/* =========================================================
   Billing Cycle
========================================================= */

async function getBillingCycle(db, billingCycleId) {
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
   Validate Billing Items
========================================================= */

function validateItems(items) {
  if (!Array.isArray(items)) {
    return {
      valid: true,
      items: [],
    };
  }

  const normalized = [];

  for (const item of items) {
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

    if (!ITEM_TYPES.includes(itemType)) {
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

    let amountValue =
      item.amount ??
      (
        Number(quantity) *
        Number(unitPrice)
      );

    const amount =
      nonNegativeNumber(amountValue);

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
      referenceIdValue === undefined ||
      referenceIdValue === null ||
      referenceIdValue === ""
        ? null
        : validId(referenceIdValue)
          ? Number(referenceIdValue)
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

    normalized.push({
      item_type: itemType,
      description,
      quantity,
      unit_price: unitPrice,
      amount,
      reference_type: nullable(
        item.reference_type ??
          item.referenceType
      ),
      reference_id: referenceId,
    });
  }

  return {
    valid: true,
    items: normalized,
  };
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
      url.searchParams.get(
        "billing_month"
      )
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

    const result = await db
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

  const billingMonth =
    clean(
      data.billing_month ??
        data.billingMonth
    ) || currentMonth();

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
    validateStatus(
      requestedStatus
    );

  if (statusError) {
    return errorResponse(
      statusError
    );
  }

  /* -------------------------------------------------------
     الجلسات
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     المبالغ
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     الفترة
  ------------------------------------------------------- */

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

  /* -------------------------------------------------------
     إصلاح مهم:
     التحقق من البنود قبل إنشاء الدورة
  ------------------------------------------------------- */

  const itemsValidation =
    validateItems(data.items);

  if (!itemsValidation.valid) {
    return errorResponse(
      itemsValidation.error,
      400,
      itemsValidation.extra || {}
    );
  }

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
          "SUBSCRIPTION_NOT_BELONG_TO_STUDENT",
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
        subscriptionId
      );

    if (
      billingStart?.first_billing_month &&
      validMonth(
        billingStart.first_billing_month
      ) &&
      billingMonth <
        billingStart.first_billing_month
    ) {
      return errorResponse(
        "BILLING_MONTH_BEFORE_START",
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
      validMonth(configuredStartMonth) &&
      billingMonth <
        configuredStartMonth
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

    const finalCurrency =
      currency ||
      clean(settings.currency)
        .toUpperCase() ||
      "EGP";

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
        totalAmount - paidAmount
      );

    const finalStatus =
      calculateStatus(
        totalAmount,
        paidAmount,
        requestedStatus
      );

    /* -------------------------------------------------------
       منع التكرار
       مهم جدًا لأن subscription_id قد يكون NULL
    ------------------------------------------------------- */

    let existingQuery;
    let existing;

    if (subscriptionId === null) {
      existingQuery = `
        SELECT id
        FROM billing_cycles
        WHERE student_id = ?1
          AND subscription_id IS NULL
          AND billing_month = ?2
        LIMIT 1
      `;

      existing =
        await db
          .prepare(existingQuery)
          .bind(
            studentId,
            billingMonth
          )
          .first();
    } else {
      existingQuery = `
        SELECT id
        FROM billing_cycles
        WHERE student_id = ?1
          AND subscription_id = ?2
          AND billing_month = ?3
        LIMIT 1
      `;

      existing =
        await db
          .prepare(existingQuery)
          .bind(
            studentId,
            subscriptionId,
            billingMonth
          )
          .first();
    }

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

    /* -------------------------------------------------------
       التاريخ
    ------------------------------------------------------- */

    const defaultDueDayRaw =
      Number(
        studentSettings?.due_day ??
          settings.default_due_day ??
          7
      );

    const dueDay =
      Number.isInteger(
        defaultDueDayRaw
      )
        ? Math.min(
            28,
            Math.max(
              1,
              defaultDueDayRaw
            )
          )
        : 7;

    const issuedAt =
      data.issued_at !== undefined ||
      data.issuedAt !== undefined
        ? nullable(
            data.issued_at ??
              data.issuedAt
          )
        : settings.issue_invoice_automatically
          ? now()
          : null;

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

    /* -------------------------------------------------------
       إنشاء الدورة
    ------------------------------------------------------- */

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
            ?25
          )
        `)
        .bind(
          studentId,
          subscriptionId,
          billingMonth,
          periodStart,
          periodEnd,
          finalCurrency,

          plannedSessions,
          scheduledSessions,
          completedSessions,
          cancelledSessions,
          chargeableSessions,

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

    const billingCycleId =
      created.meta?.last_row_id;

    if (!billingCycleId) {
      return errorResponse(
        "BILLING_CYCLE_CREATE_FAILED",
        500
      );
    }

    /* -------------------------------------------------------
       إنشاء البنود بعد نجاح الدورة
    ------------------------------------------------------- */

    for (
      const item of
        itemsValidation.items
    ) {
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
          item.item_type,
          item.description,
          item.quantity,
          item.unit_price,
          item.amount,
          item.reference_type,
          item.reference_id,
          now()
        )
        .run();
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
      data.session_amount !== undefined ||
      data.sessionAmount !== undefined
        ? nonNegativeNumber(
            data.session_amount ??
              data.sessionAmount
          )
        : Number(
            current.session_amount
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
      data.chargeable_sessions !== undefined ||
      data.chargeableSessions !== undefined
        ? nonNegativeInteger(
            data.chargeable_sessions ??
              data.chargeableSessions
          )
        : Number(
            current.chargeable_sessions
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
        totalAmount - paidAmount
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
      totalAmount > 0 &&
      paidAmount >= totalAmount
    ) {
      paidAt =
        current.paid_at ||
        now();
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

          plannedSessions,
          scheduledSessions,
          completedSessions,
          cancelledSessions,
          chargeableSessions,

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

    return json({
      success: true,
      message:
        "BILLING_CYCLE_UPDATED_SUCCESSFULLY",
      data:
        await getBillingCycle(
          db,
          Number(billingCycleId)
        ),
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
  const method =
    context.request.method.toUpperCase();

  switch (method) {
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
