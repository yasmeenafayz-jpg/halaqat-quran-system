/**
 * الأوَّابين — Payments API
 *
 * GET    /api/payments
 * GET    /api/payments?id=1
 * POST   /api/payments
 * PATCH  /api/payments
 *
 * طرق الدفع:
 * cash
 * bank_transfer
 * mobile_wallet
 * card
 * online
 * other
 *
 * الحالات:
 * pending
 * completed
 * failed
 * refunded
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "mobile_wallet",
  "card",
  "online",
  "other",
];

const PAYMENT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "refunded",
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
  const v = clean(value);
  return v || null;
}

function validId(value) {
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  );
}

function validAmount(value) {
  const n = Number(value);

  return (
    Number.isFinite(n) &&
    n >= 0
  );
}

function now() {
  return new Date().toISOString();
}

/* =========================================================
   Related records
========================================================= */

async function getStudent(
  db,
  studentId
) {
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
        sub.id,
        sub.student_id,
        sub.package_id,
        sub.circle_id,
        sub.start_date,
        sub.end_date,
        sub.status,

        p.name AS package_name,
        p.package_type,
        p.price AS package_price,
        p.currency AS package_currency

      FROM subscriptions sub

      LEFT JOIN packages p
        ON p.id = sub.package_id

      WHERE sub.id = ?1
      LIMIT 1
    `)
    .bind(subscriptionId)
    .first();
}

/* =========================================================
   Payment record
========================================================= */

async function getPayment(
  db,
  paymentId
) {
  return db
    .prepare(`
      SELECT
        p.id,
        p.student_id,
        p.subscription_id,
        p.amount,
        p.currency,
        p.payment_method,
        p.transaction_reference,
        p.payer_phone,
        p.paid_at,
        p.status,
        p.notes,
        p.created_at,

        s.full_name AS student_name,

        sub.package_id,
        sub.circle_id,
        sub.start_date AS subscription_start_date,
        sub.end_date AS subscription_end_date,
        sub.status AS subscription_status,

        pkg.name AS package_name

      FROM payments p

      JOIN students s
        ON s.id = p.student_id

      LEFT JOIN subscriptions sub
        ON sub.id = p.subscription_id

      LEFT JOIN packages pkg
        ON pkg.id = sub.package_id

      WHERE p.id = ?1
      LIMIT 1
    `)
    .bind(paymentId)
    .first();
}

/* =========================================================
   Validation
========================================================= */

function validatePaymentMethod(
  method
) {
  if (
    !PAYMENT_METHODS.includes(
      method
    )
  ) {
    return "INVALID_PAYMENT_METHOD";
  }

  return null;
}

function validatePaymentStatus(
  status
) {
  if (
    !PAYMENT_STATUSES.includes(
      status
    )
  ) {
    return "INVALID_PAYMENT_STATUS";
  }

  return null;
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
    new URL(
      context.request.url
    );

  const paymentId =
    url.searchParams.get("id");

  const studentId =
    url.searchParams.get(
      "student_id"
    );

  const subscriptionId =
    url.searchParams.get(
      "subscription_id"
    );

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    ).toLowerCase();

  const method =
    clean(
      url.searchParams.get(
        "payment_method"
      )
    ).toLowerCase();

  try {
    if (paymentId) {
      if (
        !validId(paymentId)
      ) {
        return errorResponse(
          "INVALID_PAYMENT_ID"
        );
      }

      const payment =
        await getPayment(
          db,
          Number(paymentId)
        );

      if (!payment) {
        return errorResponse(
          "PAYMENT_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: payment,
      });
    }

    let sql = `
      SELECT
        p.id,
        p.student_id,
        p.subscription_id,
        p.amount,
        p.currency,
        p.payment_method,
        p.transaction_reference,
        p.payer_phone,
        p.paid_at,
        p.status,
        p.notes,
        p.created_at,

        s.full_name AS student_name,

        sub.package_id,
        sub.circle_id,

        pkg.name AS package_name

      FROM payments p

      JOIN students s
        ON s.id = p.student_id

      LEFT JOIN subscriptions sub
        ON sub.id = p.subscription_id

      LEFT JOIN packages pkg
        ON pkg.id = sub.package_id

      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      if (
        !validId(studentId)
      ) {
        return errorResponse(
          "INVALID_STUDENT_ID"
        );
      }

      params.push(
        Number(studentId)
      );

      sql += `
        AND p.student_id = ?${params.length}
      `;
    }

    if (subscriptionId) {
      if (
        !validId(subscriptionId)
      ) {
        return errorResponse(
          "INVALID_SUBSCRIPTION_ID"
        );
      }

      params.push(
        Number(subscriptionId)
      );

      sql += `
        AND p.subscription_id = ?${params.length}
      `;
    }

    if (status) {
      const statusError =
        validatePaymentStatus(
          status
        );

      if (statusError) {
        return errorResponse(
          statusError
        );
      }

      params.push(status);

      sql += `
        AND p.status = ?${params.length}
      `;
    }

    if (method) {
      const methodError =
        validatePaymentMethod(
          method
        );

      if (methodError) {
        return errorResponse(
          methodError
        );
      }

      params.push(method);

      sql += `
        AND p.payment_method = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        p.paid_at DESC,
        p.id DESC
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
      "PAYMENTS_GET_ERROR",
      e
    );

    return errorResponse(
      "PAYMENTS_FETCH_FAILED",
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

  const studentId =
    Number(
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

  const amount =
    Number(data.amount);

  const currency =
    clean(
      data.currency ||
      "EGP"
    ).toUpperCase();

  const paymentMethod =
    clean(
      data.payment_method ??
      data.paymentMethod
    ).toLowerCase();

  const transactionReference =
    nullable(
      data.transaction_reference ??
      data.transactionReference
    );

  const payerPhone =
    nullable(
      data.payer_phone ??
      data.payerPhone
    );

  const paidAt =
    nullable(
      data.paid_at ??
      data.paidAt
    ) || now();

  const status =
    clean(
      data.status ||
      "completed"
    ).toLowerCase();

  const notes =
    nullable(data.notes);

  if (
    !validId(studentId)
  ) {
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

  if (
    !validAmount(amount)
  ) {
    return errorResponse(
      "INVALID_PAYMENT_AMOUNT"
    );
  }

  if (!currency) {
    return errorResponse(
      "CURRENCY_REQUIRED"
    );
  }

  const methodError =
    validatePaymentMethod(
      paymentMethod
    );

  if (methodError) {
    return errorResponse(
      methodError
    );
  }

  const statusError =
    validatePaymentStatus(
      status
    );

  if (statusError) {
    return errorResponse(
      statusError
    );
  }

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

    let subscription =
      null;

    if (subscriptionId) {
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
        ) !==
        Number(studentId)
      ) {
        return errorResponse(
          "SUBSCRIPTION_DOES_NOT_BELONG_TO_STUDENT",
          409
        );
      }
    }

    const created =
      await db
        .prepare(`
          INSERT INTO payments (
            student_id,
            subscription_id,
            amount,
            currency,
            payment_method,
            transaction_reference,
            payer_phone,
            paid_at,
            status,
            notes,
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
            ?9,
            ?10,
            ?11
          )
        `)
        .bind(
          studentId,
          subscriptionId,
          amount,
          currency,
          paymentMethod,
          transactionReference,
          payerPhone,
          paidAt,
          status,
          notes,
          now()
        )
        .run();

    const paymentId =
      created.meta?.last_row_id;

    const payment =
      await getPayment(
        db,
        paymentId
      );

    return json(
      {
        success: true,
        message:
          "PAYMENT_CREATED_SUCCESSFULLY",
        data: payment,
      },
      201
    );
  } catch (e) {
    console.error(
      "PAYMENTS_POST_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "PAYMENT_CREATE_FAILED",
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

  const paymentId =
    data.id ??
    data.payment_id ??
    data.paymentId;

  if (
    !validId(paymentId)
  ) {
    return errorResponse(
      "PAYMENT_ID_REQUIRED"
    );
  }

  try {
    const current =
      await db
        .prepare(`
          SELECT *
          FROM payments
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(
          Number(paymentId)
        )
        .first();

    if (!current) {
      return errorResponse(
        "PAYMENT_NOT_FOUND",
        404
      );
    }

    const amount =
      data.amount !==
        undefined
        ? Number(
            data.amount
          )
        : Number(
            current.amount
          );

    const currency =
      data.currency !==
        undefined
        ? clean(
            data.currency
          ).toUpperCase()
        : current.currency;

    const paymentMethod =
      data.payment_method !==
        undefined ||
      data.paymentMethod !==
        undefined
        ? clean(
            data.payment_method ??
            data.paymentMethod
          ).toLowerCase()
        : current.payment_method;

    const transactionReference =
      data.transaction_reference !==
        undefined ||
      data.transactionReference !==
        undefined
        ? nullable(
            data.transaction_reference ??
            data.transactionReference
          )
        : current.transaction_reference;

    const payerPhone =
      data.payer_phone !==
        undefined ||
      data.payerPhone !==
        undefined
        ? nullable(
            data.payer_phone ??
            data.payerPhone
          )
        : current.payer_phone;

    const paidAt =
      data.paid_at !==
        undefined ||
      data.paidAt !==
        undefined
        ? nullable(
            data.paid_at ??
            data.paidAt
          )
        : current.paid_at;

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
      !validAmount(amount)
    ) {
      return errorResponse(
        "INVALID_PAYMENT_AMOUNT"
      );
    }

    const methodError =
      validatePaymentMethod(
        paymentMethod
      );

    if (methodError) {
      return errorResponse(
        methodError
      );
    }

    const statusError =
      validatePaymentStatus(
        status
      );

    if (statusError) {
      return errorResponse(
        statusError
      );
    }

    const updated =
      await db
        .prepare(`
          UPDATE payments
          SET
            amount = ?2,
            currency = ?3,
            payment_method = ?4,
            transaction_reference = ?5,
            payer_phone = ?6,
            paid_at = ?7,
            status = ?8,
            notes = ?9
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          Number(paymentId),
          amount,
          currency,
          paymentMethod,
          transactionReference,
          payerPhone,
          paidAt,
          status,
          notes
        )
        .first();

    const payment =
      await getPayment(
        db,
        paymentId
      );

    return json({
      success: true,
      message:
        "PAYMENT_UPDATED_SUCCESSFULLY",
      data:
        payment || updated,
    });
  } catch (e) {
    console.error(
      "PAYMENTS_PATCH_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "PAYMENT_UPDATE_FAILED",
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
