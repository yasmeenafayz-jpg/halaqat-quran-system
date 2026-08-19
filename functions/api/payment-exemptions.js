/**
 * الأوَّابين — Payment Exemptions API
 *
 * GET    /api/payment-exemptions
 * GET    /api/payment-exemptions?id=1
 * POST   /api/payment-exemptions
 * PATCH  /api/payment-exemptions
 *
 * ملاحظة:
 * هذا السجل إداري فقط.
 * لا يتم إرجاع بيانات الإعفاء لأي واجهة طالب
 * إلا من خلال صلاحية الإدارة في طبقة المصادقة.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const STATUSES = [
  "active",
  "expired",
  "cancelled",
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

function validDateTime(value) {
  const v = clean(value);

  if (!v) {
    return false;
  }

  return !Number.isNaN(
    Date.parse(v)
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
   Exemption record
========================================================= */

async function getExemption(
  db,
  exemptionId
) {
  return db
    .prepare(`
      SELECT
        pe.id,
        pe.student_id,
        pe.subscription_id,
        pe.amount,
        pe.reason,
        pe.approved_by,
        pe.starts_at,
        pe.ends_at,
        pe.status,
        pe.created_at,

        s.full_name AS student_name,

        u.name AS approved_by_name

      FROM payment_exemptions pe

      JOIN students s
        ON s.id = pe.student_id

      LEFT JOIN users u
        ON u.id = pe.approved_by

      WHERE pe.id = ?1
      LIMIT 1
    `)
    .bind(exemptionId)
    .first();
}

/* =========================================================
   Validation
========================================================= */

function validateStatus(status) {
  if (!STATUSES.includes(status)) {
    return "INVALID_EXEMPTION_STATUS";
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

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    ).toLowerCase();

  try {
    if (id) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_EXEMPTION_ID"
        );
      }

      const row =
        await getExemption(
          db,
          Number(id)
        );

      if (!row) {
        return errorResponse(
          "PAYMENT_EXEMPTION_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: row,
      });
    }

    let sql = `
      SELECT
        pe.id,
        pe.student_id,
        pe.subscription_id,
        pe.amount,
        pe.reason,
        pe.approved_by,
        pe.starts_at,
        pe.ends_at,
        pe.status,
        pe.created_at,

        s.full_name AS student_name,

        u.name AS approved_by_name

      FROM payment_exemptions pe

      JOIN students s
        ON s.id = pe.student_id

      LEFT JOIN users u
        ON u.id = pe.approved_by

      WHERE 1 = 1
    `;

    const params = [];

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
        AND pe.student_id = ?${params.length}
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
        AND pe.subscription_id = ?${params.length}
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
        AND pe.status = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        pe.starts_at DESC,
        pe.id DESC
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
      "PAYMENT_EXEMPTIONS_GET_ERROR",
      e
    );

    return errorResponse(
      "PAYMENT_EXEMPTIONS_FETCH_FAILED",
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

  const amountValue =
    data.amount;

  const amount =
    amountValue ===
      undefined ||
    amountValue ===
      null ||
    amountValue === ""
      ? null
      : Number(amountValue);

  const reason =
    nullable(data.reason);

  const approvedByValue =
    data.approved_by ??
    data.approvedBy;

  const approvedBy =
    approvedByValue ===
      undefined ||
    approvedByValue ===
      null ||
    approvedByValue === ""
      ? null
      : Number(
          approvedByValue
        );

  const startsAt =
    clean(
      data.starts_at ??
      data.startsAt
    ) || now();

  const endsAt =
    nullable(
      data.ends_at ??
      data.endsAt
    );

  const status =
    clean(
      data.status ||
      "active"
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

  if (
    amount !== null &&
    !validAmount(amount)
  ) {
    return errorResponse(
      "INVALID_EXEMPTION_AMOUNT"
    );
  }

  if (
    approvedBy !== null &&
    !validId(approvedBy)
  ) {
    return errorResponse(
      "INVALID_APPROVED_BY"
    );
  }

  if (
    !validDateTime(startsAt)
  ) {
    return errorResponse(
      "INVALID_START_DATE"
    );
  }

  if (
    endsAt &&
    !validDateTime(endsAt)
  ) {
    return errorResponse(
      "INVALID_END_DATE"
    );
  }

  if (
    endsAt &&
    Date.parse(endsAt) <
      Date.parse(startsAt)
  ) {
    return errorResponse(
      "END_DATE_BEFORE_START_DATE"
    );
  }

  const statusError =
    validateStatus(status);

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

    if (subscriptionId) {
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
        ) !==
        Number(studentId)
      ) {
        return errorResponse(
          "SUBSCRIPTION_DOES_NOT_BELONG_TO_STUDENT",
          409
        );
      }
    }

    if (approvedBy) {
      const approver =
        await db
          .prepare(`
            SELECT id
            FROM users
            WHERE id = ?1
            LIMIT 1
          `)
          .bind(approvedBy)
          .first();

      if (!approver) {
        return errorResponse(
          "APPROVER_NOT_FOUND",
          404
        );
      }
    }

    const created =
      await db
        .prepare(`
          INSERT INTO payment_exemptions (
            student_id,
            subscription_id,
            amount,
            reason,
            approved_by,
            starts_at,
            ends_at,
            status,
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
          studentId,
          subscriptionId,
          amount,
          reason,
          approvedBy,
          startsAt,
          endsAt,
          status,
          now()
        )
        .run();

    const exemptionId =
      created.meta?.last_row_id;

    const row =
      await getExemption(
        db,
        exemptionId
      );

    return json(
      {
        success: true,
        message:
          "PAYMENT_EXEMPTION_CREATED_SUCCESSFULLY",
        data: row,
      },
      201
    );
  } catch (e) {
    console.error(
      "PAYMENT_EXEMPTIONS_POST_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "PAYMENT_EXEMPTION_CREATE_FAILED",
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

  const exemptionId =
    data.id ??
    data.exemption_id ??
    data.exemptionId;

  if (!validId(exemptionId)) {
    return errorResponse(
      "EXEMPTION_ID_REQUIRED"
    );
  }

  try {
    const current =
      await db
        .prepare(`
          SELECT *
          FROM payment_exemptions
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(
          Number(exemptionId)
        )
        .first();

    if (!current) {
      return errorResponse(
        "PAYMENT_EXEMPTION_NOT_FOUND",
        404
      );
    }

    const amount =
      data.amount !==
        undefined
        ? (
            data.amount ===
              null ||
            data.amount === ""
              ? null
              : Number(
                  data.amount
                )
          )
        : current.amount;

    const reason =
      data.reason !==
        undefined
        ? nullable(
            data.reason
          )
        : current.reason;

    const approvedByValue =
      data.approved_by !==
        undefined ||
      data.approvedBy !==
        undefined
        ? (
            data.approved_by ??
            data.approvedBy
          )
        : current.approved_by;

    const approvedBy =
      approvedByValue ===
        null ||
      approvedByValue === ""
        ? null
        : Number(
            approvedByValue
          );

    const startsAt =
      data.starts_at !==
        undefined ||
      data.startsAt !==
        undefined
        ? clean(
            data.starts_at ??
            data.startsAt
          )
        : current.starts_at;

    const endsAt =
      data.ends_at !==
        undefined ||
      data.endsAt !==
        undefined
        ? nullable(
            data.ends_at ??
            data.endsAt
          )
        : current.ends_at;

    const status =
      data.status !==
        undefined
        ? clean(
            data.status
          ).toLowerCase()
        : current.status;

    if (
      amount !== null &&
      !validAmount(amount)
    ) {
      return errorResponse(
        "INVALID_EXEMPTION_AMOUNT"
      );
    }

    if (
      approvedBy !== null &&
      !validId(approvedBy)
    ) {
      return errorResponse(
        "INVALID_APPROVED_BY"
      );
    }

    if (
      !validDateTime(startsAt)
    ) {
      return errorResponse(
        "INVALID_START_DATE"
      );
    }

    if (
      endsAt &&
      !validDateTime(endsAt)
    ) {
      return errorResponse(
        "INVALID_END_DATE"
      );
    }

    if (
      endsAt &&
      Date.parse(endsAt) <
        Date.parse(startsAt)
    ) {
      return errorResponse(
        "END_DATE_BEFORE_START_DATE"
      );
    }

    const statusError =
      validateStatus(status);

    if (statusError) {
      return errorResponse(
        statusError
      );
    }

    if (approvedBy) {
      const approver =
        await db
          .prepare(`
            SELECT id
            FROM users
            WHERE id = ?1
            LIMIT 1
          `)
          .bind(approvedBy)
          .first();

      if (!approver) {
        return errorResponse(
          "APPROVER_NOT_FOUND",
          404
        );
      }
    }

    const updated =
      await db
        .prepare(`
          UPDATE payment_exemptions
          SET
            amount = ?2,
            reason = ?3,
            approved_by = ?4,
            starts_at = ?5,
            ends_at = ?6,
            status = ?7
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          Number(exemptionId),
          amount,
          reason,
          approvedBy,
          startsAt,
          endsAt,
          status
        )
        .first();

    const row =
      await getExemption(
        db,
        exemptionId
      );

    return json({
      success: true,
      message:
        "PAYMENT_EXEMPTION_UPDATED_SUCCESSFULLY",
      data:
        row || updated,
    });
  } catch (e) {
    console.error(
      "PAYMENT_EXEMPTIONS_PATCH_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "PAYMENT_EXEMPTION_UPDATE_FAILED",
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
