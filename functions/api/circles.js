/**
 * الأوَّابين — Circles API
 *
 * GET    /api/circles
 * GET    /api/circles?id=1
 * POST   /api/circles
 * PATCH  /api/circles
 *
 * يدعم:
 * - الحلقات الفردية والجماعية
 * - ربط المعلم
 * - ربط الباقة
 * - السعة
 * - المستوى والمسار
 * - الجدول
 * - حالات الحلقة
 * - البحث والفلترة
 * - منع تجاوز السعة
 * - منع ربط الحلقة بمعلم غير نشط
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

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
   Helpers
========================================================= */

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

function cleanString(value) {
  return String(value ?? "").trim();
}

function nullableString(value) {
  const valueClean = cleanString(value);
  return valueClean ? valueClean : null;
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(
    1,
    Math.floor(number)
  );
}

function validId(value) {
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  );
}

/* =========================================================
   Circle Query
========================================================= */

async function getCircleById(db, id) {
  return db
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
        t.status AS teacher_status,

        p.name AS package_name,
        p.package_type,
        p.price AS package_price,
        p.currency AS package_currency,
        p.sessions_per_month,
        p.duration_minutes,
        p.capacity AS package_capacity,
        p.status AS package_status

      FROM circles c

      LEFT JOIN teachers t
        ON t.id = c.teacher_id

      LEFT JOIN packages p
        ON p.id = c.package_id

      WHERE c.id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

/* =========================================================
   Validate Teacher
========================================================= */

async function validateTeacher(db, teacherId) {
  if (
    teacherId === null ||
    teacherId === undefined
  ) {
    return null;
  }

  if (!validId(teacherId)) {
    return {
      error: "INVALID_TEACHER_ID",
    };
  }

  const teacher = await db
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

  if (!teacher) {
    return {
      error: "TEACHER_NOT_FOUND",
    };
  }

  if (teacher.status !== "active") {
    return {
      error: "TEACHER_IS_NOT_ACTIVE",
      teacher_status: teacher.status,
    };
  }

  return teacher;
}

/* =========================================================
   Validate Package
========================================================= */

async function validatePackage(
  db,
  packageId,
  circleType,
  capacity
) {
  if (
    packageId === null ||
    packageId === undefined
  ) {
    return null;
  }

  if (!validId(packageId)) {
    return {
      error: "INVALID_PACKAGE_ID",
    };
  }

  const pkg = await db
    .prepare(`
      SELECT
        id,
        name,
        package_type,
        capacity,
        status
      FROM packages
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(packageId)
    .first();

  if (!pkg) {
    return {
      error: "PACKAGE_NOT_FOUND",
    };
  }

  if (pkg.status !== "active") {
    return {
      error: "PACKAGE_IS_INACTIVE",
    };
  }

  if (pkg.package_type !== circleType) {
    return {
      error:
        "PACKAGE_TYPE_DOES_NOT_MATCH_CIRCLE_TYPE",
    };
  }

  const packageCapacity =
    Number(pkg.capacity || 0);

  if (
    packageCapacity > 0 &&
    capacity > packageCapacity
  ) {
    return {
      error:
        "CIRCLE_CAPACITY_EXCEEDS_PACKAGE_CAPACITY",
      package_capacity:
        packageCapacity,
      requested_capacity:
        capacity,
    };
  }

  return pkg;
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

  const id =
    url.searchParams.get("id");

  const circleType =
    url.searchParams.get(
      "circle_type"
    );

  const status =
    url.searchParams.get("status");

  const teacherId =
    url.searchParams.get(
      "teacher_id"
    );

  const packageId =
    url.searchParams.get(
      "package_id"
    );

  const search = cleanString(
    url.searchParams.get("search")
  );

  try {
    /* -----------------------------------------
       Circle by ID
    ----------------------------------------- */

    if (id) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_CIRCLE_ID",
          400
        );
      }

      const circle =
        await getCircleById(
          db,
          id
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: circle,
      });
    }

    /* -----------------------------------------
       Circles list
    ----------------------------------------- */

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
        t.status AS teacher_status,

        p.name AS package_name,
        p.package_type,
        p.price AS package_price,
        p.currency AS package_currency,
        p.sessions_per_month,
        p.duration_minutes,
        p.capacity AS package_capacity,
        p.status AS package_status

      FROM circles c

      LEFT JOIN teachers t
        ON t.id = c.teacher_id

      LEFT JOIN packages p
        ON p.id = c.package_id

      WHERE 1 = 1
    `;

    const params = [];

    if (circleType) {
      if (
        !VALID_TYPES.includes(
          circleType
        )
      ) {
        return errorResponse(
          "INVALID_CIRCLE_TYPE",
          400
        );
      }

      params.push(circleType);

      sql += `
        AND c.circle_type = ?${params.length}
      `;
    }

    if (status) {
      if (
        !VALID_STATUSES.includes(
          status
        )
      ) {
        return errorResponse(
          "INVALID_CIRCLE_STATUS",
          400
        );
      }

      params.push(status);

      sql += `
        AND c.status = ?${params.length}
      `;
    }

    if (teacherId) {
      if (!validId(teacherId)) {
        return errorResponse(
          "INVALID_TEACHER_ID",
          400
        );
      }

      params.push(
        Number(teacherId)
      );

      sql += `
        AND c.teacher_id = ?${params.length}
      `;
    }

    if (packageId) {
      if (!validId(packageId)) {
        return errorResponse(
          "INVALID_PACKAGE_ID",
          400
        );
      }

      params.push(
        Number(packageId)
      );

      sql += `
        AND c.package_id = ?${params.length}
      `;
    }

    if (search) {
      const searchValue =
        `%${search}%`;

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );

      const start =
        params.length - 4;

      sql += `
        AND (
          c.name LIKE ?${start}
          OR t.full_name LIKE ?${start + 1}
          OR p.name LIKE ?${start + 2}
          OR c.level_name LIKE ?${start + 3}
          OR c.path_name LIKE ?${start + 4}
        )
      `;
    }

    sql += `
      ORDER BY
        c.created_at DESC,
        c.id DESC
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
      "CIRCLES_GET_FAILED",
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

  if (
    !data ||
    typeof data !== "object"
  ) {
    return errorResponse(
      "INVALID_REQUEST_BODY",
      400
    );
  }

  const name = cleanString(
    data.name
  );

  const circleType =
    cleanString(
      data.circle_type ??
      data.circleType
    );

  if (!name) {
    return errorResponse(
      "CIRCLE_NAME_REQUIRED",
      400
    );
  }

  if (
    !VALID_TYPES.includes(
      circleType
    )
  ) {
    return errorResponse(
      "CIRCLE_TYPE_MUST_BE_INDIVIDUAL_OR_GROUP",
      400
    );
  }

  /*
   * الحلقة الفردية = طالب واحد.
   */
  const capacity =
    circleType === "individual"
      ? 1
      : positiveInteger(
          data.capacity,
          1
        );

  const teacherId =
    data.teacher_id !==
      undefined &&
    data.teacher_id !==
      null &&
    data.teacher_id !== ""
      ? Number(
          data.teacher_id
        )
      : null;

  const packageId =
    data.package_id !==
      undefined &&
    data.package_id !==
      null &&
    data.package_id !== ""
      ? Number(
          data.package_id
        )
      : null;

  const status =
    cleanString(
      data.status || "active"
    );

  if (
    !VALID_STATUSES.includes(
      status
    )
  ) {
    return errorResponse(
      "INVALID_CIRCLE_STATUS",
      400
    );
  }

  const scheduleNote =
    nullableString(
      data.schedule_note ??
      data.scheduleNote
    );

  const levelName =
    nullableString(
      data.level_name ??
      data.levelName
    );

  const pathName =
    nullableString(
      data.path_name ??
      data.pathName
    );

  try {
    /* -----------------------------------------
       Teacher validation
    ----------------------------------------- */

    const teacher =
      await validateTeacher(
        db,
        teacherId
      );

    if (teacher?.error) {
      return errorResponse(
        teacher.error,
        teacher.error ===
          "TEACHER_NOT_FOUND"
          ? 404
          : 409,
        teacher
      );
    }

    /* -----------------------------------------
       Package validation
    ----------------------------------------- */

    const pkg =
      await validatePackage(
        db,
        packageId,
        circleType,
        capacity
      );

    if (pkg?.error) {
      return errorResponse(
        pkg.error,
        pkg.error ===
          "PACKAGE_NOT_FOUND"
          ? 404
          : 409,
        pkg
      );
    }

    const now =
      new Date().toISOString();

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
          level
