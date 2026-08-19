/**
 * الأوَّابين — Circles API
 *
 * GET  /api/circles
 * POST /api/circles
 *
 * يدعم:
 * - حلقات فردية
 * - حلقات جماعية
 * - سعة فردية لأكثر من طالب مثل الإخوة
 * - سعة جماعية حسب الإدارة
 * - ربط الحلقة بالمعلم
 * - ربط الحلقة بالباقة
 * - المستوى والمسار
 * - حالة الحلقة
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

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

function cleanString(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(1, Math.floor(number));
}

const VALID_TYPES = [
  "individual",
  "group",
];

const VALID_STATUSES = [
  "active",
  "inactive",
  "full",
  "archived",
];

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(context) {
  const db = context.env?.DB;

  if (!db) {
    return json({
      success: true,
      database: false,
      data: [],
    });
  }

  const url = new URL(
    context.request.url
  );

  const id =
    url.searchParams.get("id");

  const circleType =
    url.searchParams.get("circle_type");

  const status =
    url.searchParams.get("status");

  const teacherId =
    url.searchParams.get("teacher_id");

  const packageId =
    url.searchParams.get("package_id");

  try {
    let sql = `
      SELECT
        c.id,
        c.name,
        c.circle_type,
        c.teacher_id,
        c.package_id,
        c.capacity,
        c.status,
        c.schedule_note,
        c.level_name,
        c.path_name,
        c.created_at,
        c.updated_at,

        t.full_name AS teacher_name,

        p.name AS package_name,
        p.package_type,
        p.price AS package_price,
        p.currency AS package_currency,
        p.sessions_per_month,
        p.duration_minutes,
        p.capacity AS package_capacity

      FROM circles c

      LEFT JOIN teachers t
        ON t.id = c.teacher_id

      LEFT JOIN packages p
        ON p.id = c.package_id

      WHERE 1 = 1
    `;

    const params = [];

    if (id) {
      params.push(Number(id));
      sql += ` AND c.id = ?${params.length}`;
    }

    if (circleType) {
      if (!VALID_TYPES.includes(circleType)) {
        return errorResponse(
          "INVALID_CIRCLE_TYPE",
          400
        );
      }

      params.push(circleType);
      sql +=
        ` AND c.circle_type = ?${params.length}`;
    }

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return errorResponse(
          "INVALID_CIRCLE_STATUS",
          400
        );
      }

      params.push(status);
      sql +=
        ` AND c.status = ?${params.length}`;
    }

    if (teacherId) {
      params.push(Number(teacherId));
      sql +=
        ` AND c.teacher_id = ?${params.length}`;
    }

    if (packageId) {
      params.push(Number(packageId));
      sql +=
        ` AND c.package_id = ?${params.length}`;
    }

    sql += `
      ORDER BY c.created_at DESC
    `;

    const result = await db
      .prepare(sql)
      .bind(...params)
      .all();

    return json({
      success: true,
      data: result.results || [],
    });
  } catch (error) {
    console.error(
      "Circles GET error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLES_FETCH_FAILED",
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
      "INVALID_JSON",
      400
    );
  }

  if (!data || typeof data !== "object") {
    return errorResponse(
      "INVALID_REQUEST_BODY",
      400
    );
  }

  const name =
    cleanString(data.name);

  const circleType =
    cleanString(data.circle_type);

  const levelName =
    cleanString(data.level_name) ||
    null;

  const pathName =
    cleanString(data.path_name) ||
    null;

  const scheduleNote =
    cleanString(data.schedule_note) ||
    null;

  if (!name) {
    return errorResponse(
      "CIRCLE_NAME_REQUIRED",
      400
    );
  }

  if (!VALID_TYPES.includes(circleType)) {
    return errorResponse(
      "CIRCLE_TYPE_MUST_BE_INDIVIDUAL_OR_GROUP",
      400
    );
  }

  /*
   * السعة:
   *
   * الفردية:
   * يمكن أن تكون 1 أو 2 أو أكثر.
   * مثال: أخوان في نفس الحلقة الفردية.
   *
   * الجماعية:
   * السعة تحددها الإدارة أو الباقة.
   */

  let capacity =
    positiveInteger(
      data.capacity,
      1
    );

  const teacherId =
    data.teacher_id !== undefined &&
    data.teacher_id !== null &&
    data.teacher_id !== ""
      ? Number(data.teacher_id)
      : null;

  const packageId =
    data.package_id !== undefined &&
    data.package_id !== null &&
    data.package_id !== ""
      ? Number(data.package_id)
      : null;

  const requestedStatus =
    cleanString(
      data.status || "active"
    );

  if (
    !VALID_STATUSES.includes(
      requestedStatus
    )
  ) {
    return errorResponse(
      "INVALID_CIRCLE_STATUS",
      400
    );
  }

  if (
    teacherId !== null &&
    (
      !Number.isInteger(teacherId) ||
      teacherId <= 0
    )
  ) {
    return errorResponse(
      "INVALID_TEACHER_ID",
      400
    );
  }

  if (
    packageId !== null &&
    (
      !Number.isInteger(packageId) ||
      packageId <= 0
    )
  ) {
    return errorResponse(
      "INVALID_PACKAGE_ID",
      400
    );
  }

  try {
    /* =====================================================
       Package validation
    ===================================================== */

    let pkg = null;

    if (packageId !== null) {
      pkg = await db
        .prepare(`
          SELECT *
          FROM packages
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(packageId)
        .first();

      if (!pkg) {
        return errorResponse(
          "PACKAGE_NOT_FOUND",
          404
        );
      }

      if (pkg.status !== "active") {
        return errorResponse(
          "PACKAGE_IS_INACTIVE",
          409
        );
      }

      if (
        pkg.package_type !==
        circleType
      ) {
        return errorResponse(
          "PACKAGE_TYPE_DOES_NOT_MATCH_CIRCLE_TYPE",
          409
        );
      }

      /*
       * إذا كانت الباقة تحتوي على سعة،
       * فلا نسمح بإنشاء حلقة تتجاوزها.
       *
       * السعة الموجودة في الحلقة تظل قابلة
       * للتحديد من الإدارة داخل الحد المسموح.
       */
      const packageCapacity =
        Number(pkg.capacity || 0);

      if (
        packageCapacity > 0 &&
        capacity > packageCapacity
      ) {
        return errorResponse(
          "CIRCLE_CAPACITY_EXCEEDS_PACKAGE_CAPACITY",
          409,
          {
            package_capacity:
              packageCapacity,
            requested_capacity:
              capacity,
          }
        );
      }
    }

    /* =====================================================
       Teacher validation
    ===================================================== */

    if (teacherId !== null) {
      const teacher = await db
        .prepare(`
          SELECT *
          FROM teachers
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(teacherId)
        .first();

      if (!teacher) {
        return errorResponse(
          "TEACHER_NOT_FOUND",
          404
        );
      }
    }

    /* =====================================================
       Create Circle
    ===================================================== */

    const result = await db
      .prepare(`
        INSERT INTO circles (
          name,
          circle_type,
          teacher_id,
          package_id,
          capacity,
          status,
          schedule_note,
          level_name,
          path_name,
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
        name,
        circleType,
        teacherId,
        packageId,
        capacity,
        requestedStatus,
        scheduleNote,
        levelName,
        pathName,
        new Date().toISOString()
      )
      .run();

    const circleId =
      result.meta?.last_row_id;

    /* =====================================================
       Return Created Circle
    ===================================================== */

    const created = await db
      .prepare(`
        SELECT
          c.id,
          c.name,
          c.circle_type,
          c.teacher_id,
          c.package_id,
          c.capacity,
          c.status,
          c.schedule_note,
          c.level_name,
          c.path_name,
          c.created_at,
          c.updated_at,

          t.full_name AS teacher_name,

          p.name AS package_name,
          p.package_type,
          p.price AS package_price,
          p.currency AS package_currency,
          p.sessions_per_month,
          p.duration_minutes,
          p.capacity AS package_capacity

        FROM circles c

        LEFT JOIN teachers t
          ON t.id = c.teacher_id

        LEFT JOIN packages p
          ON p.id = c.package_id

        WHERE c.id = ?1
        LIMIT 1
      `)
      .bind(circleId)
      .first();

    return json(
      {
        success: true,
        message:
          "Circle created successfully.",
        data: created || {
          id: circleId,
          name,
          circle_type: circleType,
          teacher_id: teacherId,
          package_id: packageId,
          capacity,
          status: requestedStatus,
          schedule_note: scheduleNote,
          level_name: levelName,
          path_name: pathName,
        },
      },
      201
    );
  } catch (error) {
    console.error(
      "Circles POST error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLE_CREATE_FAILED",
      500
    );
  }
}
