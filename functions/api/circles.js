/**
 * الأوَّابين — Circles API
 *
 * GET    /api/circles
 * GET    /api/circles?id=1
 * POST   /api/circles
 * PATCH  /api/circles
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

function validId(value) {
  const number = Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  );
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

/* =========================================================
   Get Circle
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

  const url =
    new URL(context.request.url);

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

  const search =
    cleanString(
      url.searchParams.get("search")
    );

  try {
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

      params.push(Number(teacherId));

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

      params.push(Number(packageId));

      sql += `
        AND c.package_id = ?${params.length}
      `;
    }

    if (search) {
      const searchValue =
        `%${search}%`;

      const firstSearchParam =
        params.length + 1;

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );

      sql += `
        AND (
          c.name LIKE ?${firstSearchParam}
          OR t.full_name LIKE ?${firstSearchParam + 1}
          OR p.name LIKE ?${firstSearchParam + 2}
          OR c.level_name LIKE ?${firstSearchParam + 3}
          OR c.path_name LIKE ?${firstSearchParam + 4}
        )
      `;
    }

    sql += `
      ORDER BY
        c.created_at DESC,
        c.id DESC
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

  const name =
    cleanString(data.name);

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
    data.teacher_id !== null &&
    data.teacher_id !== ""
      ? Number(data.teacher_id)
      : null;

  const packageId =
    data.package_id !==
      undefined &&
    data.package_id !== null &&
    data.package_id !== ""
      ? Number(data.package_id)
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

    const result =
      await db
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
          status,
          scheduleNote,
          levelName,
          pathName,
          now
        )
        .run();

    const circleId =
      result.meta?.last_row_id;

    const created =
      await getCircleById(
        db,
        circleId
      );

    return json(
      {
        success: true,
        message:
          "Circle created successfully.",
        data: created,
      },
      201
    );
  } catch (error) {
    console.error(
      "CIRCLES_POST_FAILED",
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

  const circleId =
    data.id ??
    data.circle_id ??
    data.circleId;

  if (!validId(circleId)) {
    return errorResponse(
      "CIRCLE_ID_REQUIRED",
      400
    );
  }

  try {
    const current =
      await getCircleById(
        db,
        circleId
      );

    if (!current) {
      return errorResponse(
        "CIRCLE_NOT_FOUND",
        404
      );
    }

    const name =
      data.name !== undefined
        ? cleanString(data.name)
        : current.name;

    if (!name) {
      return errorResponse(
        "CIRCLE_NAME_REQUIRED",
        400
      );
    }

    const circleType =
      data.circle_type !==
        undefined ||
      data.circleType !==
        undefined
        ? cleanString(
            data.circle_type ??
            data.circleType
          )
        : current.circle_type;

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

    const capacity =
      circleType === "individual"
        ? 1
        : data.capacity !==
            undefined
          ? positiveInteger(
              data.capacity,
              current.capacity
            )
          : current.capacity;

    const teacherId =
      data.teacher_id !==
        undefined ||
      data.teacherId !==
        undefined
        ? (
            data.teacher_id ??
            data.teacherId
          ) === null ||
          (
            data.teacher_id ??
            data.teacherId
          ) === ""
          ? null
          : Number(
              data.teacher_id ??
              data.teacherId
            )
        : current.teacher_id;

    const packageId =
      data.package_id !==
        undefined ||
      data.packageId !==
        undefined
        ? (
            data.package_id ??
            data.packageId
          ) === null ||
          (
            data.package_id ??
            data.packageId
          ) === ""
          ? null
          : Number(
              data.package_id ??
              data.packageId
            )
        : current.package_id;

    const status =
      data.status !== undefined
        ? cleanString(data.status)
        : current.status;

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

    const activeCount =
      await db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM circle_enrollments
          WHERE circle_id = ?1
            AND status = 'active'
        `)
        .bind(circleId)
        .first();

    const enrolledCount =
      Number(
        activeCount?.count || 0
      );

    if (
      capacity <
      enrolledCount
    ) {
      return errorResponse(
        "CAPACITY_BELOW_ACTIVE_ENROLLMENTS",
        409,
        {
          active_enrollments:
            enrolledCount,
          requested_capacity:
            capacity,
        }
      );
    }

    const scheduleNote =
      data.schedule_note !==
        undefined ||
      data.scheduleNote !==
        undefined
        ? nullableString(
            data.schedule_note ??
            data.scheduleNote
          )
        : current.schedule_note;

    const levelName =
      data.level_name !==
        undefined ||
      data.levelName !==
        undefined
        ? nullableString(
            data.level_name ??
            data.levelName
          )
        : current.level_name;

    const pathName =
      data.path_name !==
        undefined ||
      data.pathName !==
        undefined
        ? nullableString(
            data.path_name ??
            data.pathName
          )
        : current.path_name;

    let finalStatus = status;

    if (
      status === "active" &&
      enrolledCount >= capacity
    ) {
      finalStatus = "full";
    }

    const now =
      new Date().toISOString();

    await db
      .prepare(`
        UPDATE circles
        SET
          name = ?1,
          circle_type = ?2,
          teacher_id = ?3,
          package_id = ?4,
          capacity = ?5,
          status = ?6,
          schedule_note = ?7,
          level_name = ?8,
          path_name = ?9,
          updated_at = ?10
        WHERE id = ?11
      `)
      .bind(
        name,
        circleType,
        teacherId,
        packageId,
        capacity,
        finalStatus,
        scheduleNote,
        levelName,
        pathName,
        now,
        circleId
      )
      .run();

    const updated =
      await getCircleById(
        db,
        circleId
      );

    return json({
      success: true,
      message:
        "Circle updated successfully.",
      data: updated,
    });
  } catch (error) {
    console.error(
      "CIRCLES_PATCH_FAILED",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLE_UPDATE_FAILED",
      500
    );
  }
}

/* =========================================================
   Method Router
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
        405
      );
  }
}
