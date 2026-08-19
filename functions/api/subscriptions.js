/**
 * الأوَّابين — Subscriptions API
 *
 * GET    /api/subscriptions
 * GET    /api/subscriptions?id=1
 * POST   /api/subscriptions
 * PATCH  /api/subscriptions
 *
 * يدعم:
 * - الاشتراكات الفردية والجماعية
 * - ربط الطالب بالباقة والحلقة
 * - التجربة المجانية
 * - الاشتراك النشط
 * - الإيقاف
 * - الانتهاء
 * - الإلغاء
 * - تاريخ البداية والنهاية
 * - تاريخ انتهاء التجربة
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "expired",
  "paused",
  "cancelled",
];

const CIRCLE_TYPES = [
  "individual",
  "group",
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
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  );
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(
    clean(value)
  );
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(
    `${dateString}T00:00:00`
  );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  date.setDate(
    date.getDate() + days
  );

  return date
    .toISOString()
    .slice(0, 10);
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

async function getPackage(
  db,
  packageId
) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        package_type,
        duration_days,
        price,
        currency,
        capacity,
        status
      FROM packages
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(packageId)
    .first();
}

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
        id,
        name,
        circle_type,
        teacher_id,
        package_id,
        capacity,
        status
      FROM circles
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(circleId)
    .first();
}

async function getSubscription(
  db,
  subscriptionId
) {
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
        sub.trial_ends_at,
        sub.notes,
        sub.created_at,
        sub.updated_at,

        st.full_name AS student_name,

        p.name AS package_name,
        p.package_type,
        p.duration_days,
        p.price AS package_price,
        p.currency AS package_currency,

        c.name AS circle_name,
        c.circle_type

      FROM subscriptions sub

      JOIN students st
        ON st.id = sub.student_id

      JOIN packages p
        ON p.id = sub.package_id

      LEFT JOIN circles c
        ON c.id = sub.circle_id

      WHERE sub.id = ?1
      LIMIT 1
    `)
    .bind(subscriptionId)
    .first();
}

/* =========================================================
   Validation
========================================================= */

function validateStatus(
  status
) {
  if (
    !SUBSCRIPTION_STATUSES.includes(
      status
    )
  ) {
    return "INVALID_SUBSCRIPTION_STATUS";
  }

  return null;
}

function validateDates(
  startDate,
  endDate
) {
  if (
    !validDate(startDate)
  ) {
    return "INVALID_START_DATE";
  }

  if (
    endDate &&
    !validDate(endDate)
  ) {
    return "INVALID_END_DATE";
  }

  if (
    endDate &&
    endDate < startDate
  ) {
    return "END_DATE_BEFORE_START_DATE";
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

  const subscriptionId =
    url.searchParams.get("id");

  const studentId =
    url.searchParams.get(
      "student_id"
    );

  const packageId =
    url.searchParams.get(
      "package_id"
    );

  const circleId =
    url.searchParams.get(
      "circle_id"
    );

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    ).toLowerCase();

  try {
    if (subscriptionId) {
      if (
        !validId(subscriptionId)
      ) {
        return errorResponse(
          "INVALID_SUBSCRIPTION_ID"
        );
      }

      const row =
        await getSubscription(
          db,
          Number(subscriptionId)
        );

      if (!row) {
        return errorResponse(
          "SUBSCRIPTION_NOT_FOUND",
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
        sub.id,
        sub.student_id,
        sub.package_id,
        sub.circle_id,
        sub.start_date,
        sub.end_date,
        sub.status,
        sub.trial_ends_at,
        sub.notes,
        sub.created_at,
        sub.updated_at,

        st.full_name AS student_name,

        p.name AS package_name,
        p.package_type,
        p.duration_days,
        p.price AS package_price,
        p.currency AS package_currency,

        c.name AS circle_name,
        c.circle_type

      FROM subscriptions sub

      JOIN students st
        ON st.id = sub.student_id

      JOIN packages p
        ON p.id = sub.package_id

      LEFT JOIN circles c
        ON c.id = sub.circle_id

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
        AND sub.student_id = ?${params.length}
      `;
    }

    if (packageId) {
      if (
        !validId(packageId)
      ) {
        return errorResponse(
          "INVALID_PACKAGE_ID"
        );
      }

      params.push(
        Number(packageId)
      );

      sql += `
        AND sub.package_id = ?${params.length}
      `;
    }

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
        AND sub.circle_id = ?${params.length}
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
        AND sub.status = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        sub.created_at DESC,
        sub.id DESC
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
      "SUBSCRIPTIONS_GET_ERROR",
      e
    );

    return errorResponse(
      "SUBSCRIPTIONS_FETCH_FAILED",
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

  const packageId =
    Number(
      data.package_id ??
      data.packageId
    );

  const circleId =
    data.circle_id ??
    data.circleId;

  const finalCircleId =
    circleId === undefined ||
    circleId === null ||
    circleId === ""
      ? null
      : Number(circleId);

  let status =
    clean(
      data.status ||
      "active"
    ).toLowerCase();

  let startDate =
    clean(
      data.start_date ??
      data.startDate
    ) || today();

  let endDate =
    nullable(
      data.end_date ??
      data.endDate
    );

  let trialEndsAt =
    nullable(
      data.trial_ends_at ??
      data.trialEndsAt
    );

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
    !validId(packageId)
  ) {
    return errorResponse(
      "PACKAGE_ID_REQUIRED"
    );
  }

  if (
    finalCircleId !== null &&
    !validId(finalCircleId)
  ) {
    return errorResponse(
      "INVALID_CIRCLE_ID"
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

    const pkg =
      await getPackage(
        db,
        packageId
      );

    if (!pkg) {
      return errorResponse(
        "PACKAGE_NOT_FOUND",
        404
      );
    }

    if (
      pkg.status !== "active"
    ) {
      return errorResponse(
        "PACKAGE_IS_NOT_ACTIVE",
        409
      );
    }

    let circle = null;

    if (finalCircleId) {
      circle =
        await getCircle(
          db,
          finalCircleId
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      if (
        circle.status ===
          "inactive" ||
        circle.status ===
          "archived"
      ) {
        return errorResponse(
          "CIRCLE_NOT_AVAILABLE",
          409
        );
      }

      /*
       * يجب أن تتوافق الباقة
       * مع نوع الحلقة.
       */
      if (
        pkg.package_type !==
        circle.circle_type
      ) {
        return errorResponse(
          "PACKAGE_TYPE_DOES_NOT_MATCH_CIRCLE_TYPE",
          409
        );
      }
    }

    /*
     * إذا لم يرسل المستخدم تاريخ نهاية،
     * نستخدم مدة الباقة إن كانت موجودة.
     */
    if (
      !endDate &&
      pkg.duration_days
    ) {
      endDate =
        addDays(
          startDate,
          Number(
            pkg.duration_days
          )
        );
    }

    /*
     * تجربة 3 أيام عند اختيار trial.
     */
    if (
      status === "trial"
    ) {
      if (!trialEndsAt) {
        trialEndsAt =
          addDays(
            startDate,
            3
          );
      }
    }

    const dateError =
      validateDates(
        startDate,
        endDate
      );

    if (dateError) {
      return errorResponse(
        dateError
      );
    }

    /*
     * منع وجود اشتراك فعال
     * لنفس الطالب في نفس الحلقة.
     */
    if (finalCircleId) {
      const existing =
        await db
          .prepare(`
            SELECT *
            FROM subscriptions
            WHERE student_id = ?1
              AND circle_id = ?2
              AND status IN (
                'trial',
                'active',
                'paused'
              )
            ORDER BY id DESC
            LIMIT 1
          `)
          .bind(
            studentId,
            finalCircleId
          )
          .first();

      if (existing) {
        return errorResponse(
          "STUDENT_ALREADY_HAS_ACTIVE_SUBSCRIPTION",
          409,
          {
            subscription:
              existing,
          }
        );
      }
    }

    const created =
      await db
        .prepare(`
          INSERT INTO subscriptions (
            student_id,
            package_id,
            circle_id,
            start_date,
            end_date,
            status,
            trial_ends_at,
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
            ?9
          )
        `)
        .bind(
          studentId,
          packageId,
          finalCircleId,
          startDate,
          endDate,
          status,
          trialEndsAt,
          notes,
          now()
        )
        .run();

    const subscriptionId =
      created.meta?.last_row_id;

    const row =
      await getSubscription(
        db,
        subscriptionId
      );

    return json(
      {
        success: true,
        message:
          "SUBSCRIPTION_CREATED_SUCCESSFULLY",
        data: row,
      },
      201
    );
  } catch (e) {
    console.error(
      "SUBSCRIPTIONS_POST_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "SUBSCRIPTION_CREATE_FAILED",
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

  const subscriptionId =
    data.id ??
    data.subscription_id ??
    data.subscriptionId;

  if (
    !validId(subscriptionId)
  ) {
    return errorResponse(
      "SUBSCRIPTION_ID_REQUIRED"
    );
  }

  try {
    const current =
      await db
        .prepare(`
          SELECT *
          FROM subscriptions
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(
          Number(subscriptionId)
        )
        .first();

    if (!current) {
      return errorResponse(
        "SUBSCRIPTION_NOT_FOUND",
        404
      );
    }

    const status =
      data.status !==
        undefined
        ? clean(
            data.status
          ).toLowerCase()
        : current.status;

    const statusError =
      validateStatus(status);

    if (statusError) {
      return errorResponse(
        statusError
      );
    }

    const startDate =
      data.start_date !==
        undefined ||
      data.startDate !==
        undefined
        ? clean(
            data.start_date ??
            data.startDate
          )
        : current.start_date;

    const endDate =
      data.end_date !==
        undefined ||
      data.endDate !==
        undefined
        ? nullable(
            data.end_date ??
            data.endDate
          )
        : current.end_date;

    const trialEndsAt =
      data.trial_ends_at !==
        undefined ||
      data.trialEndsAt !==
        undefined
        ? nullable(
            data.trial_ends_at ??
            data.trialEndsAt
          )
        : current.trial_ends_at;

    const notes =
      data.notes !==
        undefined
        ? nullable(
            data.notes
          )
        : current.notes;

    const dateError =
      validateDates(
        startDate,
        endDate
      );

    if (dateError) {
      return errorResponse(
        dateError
      );
    }

    /*
     * إذا تحول الاشتراك إلى trial
     * ولا يوجد تاريخ تجربة،
     * نضع تجربة 3 أيام.
     */
    let finalTrialEndsAt =
      trialEndsAt;

    if (
      status === "trial" &&
      !finalTrialEndsAt
    ) {
      finalTrialEndsAt =
        addDays(
          startDate,
          3
        );
    }

    const updated =
      await db
        .prepare(`
          UPDATE subscriptions
          SET
            start_date = ?2,
            end_date = ?3,
            status = ?4,
            trial_ends_at = ?5,
            notes = ?6,
            updated_at = ?7
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          Number(subscriptionId),
          startDate,
          endDate,
          status,
          finalTrialEndsAt,
          notes,
          now()
        )
        .first();

    const row =
      await getSubscription(
        db,
        subscriptionId
      );

    return json({
      success: true,
      message:
        "SUBSCRIPTION_UPDATED_SUCCESSFULLY",
      data:
        row || updated,
    });
  } catch (e) {
    console.error(
      "SUBSCRIPTIONS_PATCH_ERROR",
      e
    );

    return errorResponse(
      e instanceof Error
        ? e.message
        : "SUBSCRIPTION_UPDATE_FAILED",
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
