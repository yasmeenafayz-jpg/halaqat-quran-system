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
 * يدير:
 * - الفاتورة الشهرية للطالب
 * - بداية الدورة من أول الشهر
 * - الباقة الشهرية
 * - عدد الجلسات المخططة والمجدولة والمنفذة
 * - الجلسات القابلة للمحاسبة
 * - الخصومات
 * - الإعفاء
 * - الغرامات
 * - المدفوع
 * - المتبقي
 * - بنود الفاتورة
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
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(
    clean(value)
  );
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    clean(value)
  );
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
  const [year, monthNumber] =
    month.split("-").map(Number);

  const date = new Date(
    Date.UTC(
      year,
      monthNumber,
      0
    )
  );

  return date
    .toISOString()
    .slice(0, 10);
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

  if (
    !Number.isInteger(n) ||
    n < 0
  ) {
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
  if (
    requestedStatus === "cancelled"
  ) {
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

  if (
    requestedStatus === "overdue"
  ) {
    return "overdue";
  }

  return requestedStatus || "open";
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

async function getSubscription(
  db,
  subscriptionId
) {
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

async function getBillingCycle(
  db,
  billingCycleId
) {
  const cycle =
    await db
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

  const items =
    await db
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
   GET
========================================================= */

export async function onRequestGet(
  context
) {
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
    url.searchParams.get(
      "student_id"
    );

  const subscriptionId =
    url.searchParams.get(
      "subscription_id"
    );

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

export async function onRequestPost(
  context
) {
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
    subscriptionValue ===
      undefined ||
    subscriptionValue ===
      null ||
    subscriptionValue === ""
      ? null
      : Number(
          subscriptionValue
        );

  const billingMonth =
    clean(
      data.billing_month ??
        data.billingMonth
    ) || currentMonth();

  const currency =
    clean(data.currency)
      .toUpperCase() || "EGP";

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
    ) || firstDayOfMonth(
      billingMonth
    );

  const periodEnd =
    clean(
      data.period_end ??
        data.periodEnd
    ) || lastDayOfMonth(
      billingMonth
    );

  if (
    !validDate(periodStart)
  ) {
    return errorResponse(
      "INVALID_PERIOD_START"
    );
  }

  if (
    !validDate(periodEnd)
  ) {
    return errorResponse(
      "INVALID_PERIOD_END"
    );
  }

  if (periodEnd < periodStart) {
    return errorResponse(
      "PERIOD_END_BEFORE_START"
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

  const finalStatus =
    calculateStatus(
      totalAmount,
      paidAmount,
      requestedStatus
    );

  const issuedAt =
    data.issued_at ??
    data.issuedAt ??
    null;

  const dueAt =
    data.due_at ??
    data.dueAt ??
    null;

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

  try {
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

    if (
      subscriptionId !== null
    ) {
      const subscription =
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
            ?25
          )
        `)
        .bind(
          studentId,
          subscriptionId,
          billingMonth,
          periodStart,
          periodEnd,
          currency,

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

    const items =
      Array.isArray(data.items)
        ? data.items
        : [];

    for (
      const item of items
    ) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const itemType =
        clean(
          item.item_type ??
            item.itemType
        ).toLowerCase();

      const allowedTypes = [
        "package",
        "session",
        "discount",
        "exemption",
        "fine",
        "adjustment",
      ];

      if (
        !allowedTypes.includes(
          itemType
        )
      ) {
        return errorResponse(
          "INVALID_BILLING_ITEM_TYPE",
          400,
          {
            item_type: itemType,
          }
        );
      }

      const description =
        clean(
          item.description
        );

      if (!description) {
        return errorResponse(
          "BILLING_ITEM_DESCRIPTION_REQUIRED"
        );
      }

      const quantity =
        nonNegativeNumber(
          item.quantity ?? 1
        );

      const unitPrice =
        nonNegativeNumber(
          item.unit_price ??
            item.unitPrice ??
            0
        );

      const amount =
        nonNegativeNumber(
          item.amount ??
            (
              Number(quantity) *
              Number(unitPrice)
            )
        );

      if (
        quantity === null ||
        unitPrice === null ||
        amount === null
      ) {
        return errorResponse(
          "INVALID_BILLING_ITEM_AMOUNT"
        );
      }

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
          itemType,
          description,
          quantity,
          unitPrice,
          amount,
          nullable(
            item.reference_type ??
              item.referenceType
          ),
          validId(
            item.reference_id ??
              item.referenceId
          )
            ? Number(
                item.reference_id ??
                  item.referenceId
              )
            : null,
          now()
        )
        .run();
    }

    const row =
      await getBillingCycle(
        db,
        billingCycleId
      );

    return json(
      {
        success: true,
        message:
          "BILLING_CYCLE_CREATED_SUCCESSFULLY",
        data: row,
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

export async function onRequestPatch(
  context
) {
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
          Number(
            billingCycleId
          )
        )
        .first();

    if (!current) {
      return errorResponse(
        "BILLING_CYCLE_NOT_FOUND",
        404
      );
    }

    const packageAmount =
      data.package_amount !==
        undefined ||
      data.packageAmount !==
        undefined
        ? nonNegativeNumber(
            data.package_amount ??
              data.packageAmount
          )
        : Number(
            current.package_amount
          );

    const sessionAmount =
      data.session_amount !==
        undefined ||
      data.sessionAmount !==
        undefined
        ? nonNegativeNumber(
            data.session_amount ??
              data.sessionAmount
          )
        : Number(
            current.session_amount
          );

    const discountAmount =
      data.discount_amount !==
        undefined ||
      data.discountAmount !==
        undefined
        ? nonNegativeNumber(
            data.discount_amount ??
              data.discountAmount
          )
        : Number(
            current.discount_amount
          );

    const exemptionAmount =
      data.exemption_amount !==
        undefined ||
      data.exemptionAmount !==
        undefined
        ? nonNegativeNumber(
            data.exemption_amount ??
              data.exemptionAmount
          )
        : Number(
            current.exemption_amount
          );

    const fineAmount =
      data.fine_amount !==
        undefined ||
      data.fineAmount !==
        undefined
        ? nonNegativeNumber(
            data.fine_amount ??
              data.fineAmount
          )
        : Number(
            current.fine_amount
          );

    const paidAmount =
      data.paid_amount !==
        undefined ||
      data.paidAmount !==
        undefined
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

          data.planned_sessions !==
            undefined ||
          data.plannedSessions !==
            undefined
            ? nonNegativeInteger(
                data.planned_sessions ??
                  data.plannedSessions
              )
            : Number(
                current.planned_sessions
              ),

          data.scheduled_sessions !==
            undefined ||
          data.scheduledSessions !==
            undefined
            ? nonNegativeInteger(
                data.scheduled_sessions ??
                  data.scheduledSessions
              )
            : Number(
                current.scheduled_sessions
              ),

          data.completed_sessions !==
            undefined ||
          data.completedSessions !==
            undefined
            ? nonNegativeInteger(
                data.completed_sessions ??
                  data.completedSessions
              )
            : Number(
                current.completed_sessions
              ),

          data.cancelled_sessions !==
            undefined ||
          data.cancelledSessions !==
            undefined
            ? nonNegativeInteger(
                data.cancelled_sessions ??
                  data.cancelledSessions
              )
            : Number(
                current.cancelled_sessions
              ),

          data.chargeable_sessions !==
            undefined ||
          data.chargeableSessions !==
            undefined
            ? nonNegativeInteger(
                data.chargeable_sessions ??
                  data.chargeableSessions
              )
            : Number(
                current.chargeable_sessions
              ),

          packageAmount,
          sessionAmount,
          discountAmount,
          exemptionAmount,
          fineAmount,

          totalAmount,
          paidAmount,
          remainingAmount,

          finalStatus,

          data.issued_at !==
              undefined ||
          data.issuedAt !==
              undefined
            ? nullable(
                data.issued_at ??
                  data.issuedAt
              )
            : current.issued_at,

          data.due_at !==
              undefined ||
          data.dueAt !==
              undefined
            ? nullable(
                data.due_at ??
                  data.dueAt
              )
            : current.due_at,

          paidAmount >= totalAmount &&
            totalAmount > 0
            ? current.paid_at ||
              now()
            : data.paid_at !==
                undefined ||
              data.paidAt !==
                undefined
            ? nullable(
                data.paid_at ??
                  data.paidAt
              )
            : current.paid_at,

          data.notes !==
            undefined
            ? nullable(data.notes)
            : current.notes,

          now()
        )
        .run();

    if (!updated.success) {
      return errorResponse(
        "BILLING_CYCLE_UPDATE_FAILED",
        500
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
