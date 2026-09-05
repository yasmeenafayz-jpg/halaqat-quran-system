import { requirePermission } from "./_auth.js";
/**
 * الأوَّابين — Circles API
 *
 * GET    /api/circles
 * GET    /api/circles?id=1
 * POST   /api/circles
 * PATCH  /api/circles
 */

const HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",
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

function positiveInteger(value) {
  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0
  ) {
    return null;
  }

  return Math.floor(number);
}

function normalizeType(value) {
  const type = clean(value).toLowerCase();

  if (
    type === "فردية" ||
    type === "فردي"
  ) {
    return "individual";
  }

  if (
    type === "جماعية" ||
    type === "جماعي"
  ) {
    return "group";
  }

  return type;
}

async function getCircleById(
  db,
  circleId
) {
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
    .bind(circleId)
    .first();
}

async function getEnrollmentCount(
  db,
  circleId
) {
  const row =
    await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM circle_enrollments
        WHERE circle_id = ?1
          AND status IN (
            'pending',
            'active',
            'paused'
          )
      `)
      .bind(circleId)
      .first();

  return Number(row?.count || 0);
}

/* =========================================================
   Entity Scope
========================================================= */

function isPrivilegedCircleUser(user) {
  return (
    user?.role === "admin" ||
    user?.role === "supervisor"
  );
}

function canTeacherUseCircleTeacherId(
  user,
  teacherId
) {
  if (isPrivilegedCircleUser(user)) {
    return true;
  }

  return (
    user?.role === "teacher" &&
    user?.teacher_id &&
    Number(teacherId) ===
      Number(user.teacher_id)
  );
}

function canTeacherAccessCircle(
  user,
  circle
) {
  if (isPrivilegedCircleUser(user)) {
    return true;
  }

  return (
    user?.role === "teacher" &&
    user?.teacher_id &&
    circle &&
    Number(circle.teacher_id) ===
      Number(user.teacher_id)
  );
}

/* =========================================================
   Teacher Validation
========================================================= */

async function validateTeacher(
  db,
  teacherId
) {
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

  const teacher =
    await db
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
      teacher_status:
        teacher.status,
    };
  }

  return teacher;
}

/* =========================================================
   Package Validation
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

  const pkg =
    await db
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

  if (
    normalizeType(
      pkg.package_type
    ) !== circleType
  ) {
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

export async function onRequestGet(
  context
) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "circles.read"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const search =
    clean(
      url.searchParams.get(
        "search"
      )
    );

  try {
    if (id) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_CIRCLE_ID"
        );
      }

      const circle =
        await getCircleById(
          db,
          Number(id)
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      if (
        !canTeacherAccessCircle(
          permission.user,
          circle
        )
      ) {
        return errorResponse(
          "CIRCLE_OUT_OF_SCOPE",
          403
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

    if (
      permission.user?.role === "teacher" &&
      permission.user?.teacher_id
    ) {
      params.push(
        Number(permission.user.teacher_id)
      );

      sql += `
        AND c.teacher_id = ?${params.length}
      `;
    }

    if (circleType) {
      const normalized =
        normalizeType(
          circleType
        );

      if (
        !VALID_TYPES.includes(
          normalized
        )
      ) {
        return errorResponse(
          "INVALID_CIRCLE_TYPE"
        );
      }

      params.push(normalized);

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
          "INVALID_CIRCLE_STATUS"
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
          "INVALID_TEACHER_ID"
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
          "INVALID_PACKAGE_ID"
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
      const value =
        `%${search}%`;

      const first =
        params.length + 1;

      params.push(
        value,
        value,
        value,
        value,
        value
      );

      sql += `
        AND (
          c.name LIKE ?${first}
          OR t.full_name LIKE ?${first + 1}
          OR p.name LIKE ?${first + 2}
          OR c.level_name LIKE ?${first + 3}
          OR c.path_name LIKE ?${first + 4}
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
        result.results?.length ||
        0,
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

export async function onRequestPost(
  context
) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "circles.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const name =
    clean(data.name);

  const circleType =
    normalizeType(
      data.circle_type ??
      data.circleType
    );

  if (!name) {
    return errorResponse(
      "CIRCLE_NAME_REQUIRED"
    );
  }

  if (
    !VALID_TYPES.includes(
      circleType
    )
  ) {
    return errorResponse(
      "CIRCLE_TYPE_MUST_BE_INDIVIDUAL_OR_GROUP"
    );
  }

  /*
   * الفردية = طالب واحد فقط.
   *
   * الجماعية يجب أن تحدد لها السعة
   * صراحةً؛ لا نعطيها 1 تلقائيًا.
   */
  let capacity;

  if (
    circleType === "individual"
  ) {
    capacity = 1;
  } else {
    capacity =
      positiveInteger(
        data.capacity
      );

    if (!capacity) {
      return errorResponse(
        "GROUP_CIRCLE_CAPACITY_REQUIRED"
      );
    }
  }

  const teacherId =
    data.teacher_id !==
      undefined &&
    data.teacher_id !== null &&
    data.teacher_id !== ""
      ? Number(
          data.teacher_id
        )
      : null;

  const packageId =
    data.package_id !==
      undefined &&
    data.package_id !== null &&
    data.package_id !== ""
      ? Number(
          data.package_id
        )
      : null;

  const status =
    clean(
      data.status ||
        "active"
    );

  if (
    !VALID_STATUSES.includes(
      status
    )
  ) {
    return errorResponse(
      "INVALID_CIRCLE_STATUS"
    );
  }

  /*
   * لا نسمح بإنشاء حلقة full
   * يدويًا.
   */
  if (
    status === "full"
  ) {
    return errorResponse(
      "CIRCLE_FULL_STATUS_IS_AUTOMATIC"
    );
  }

  const scheduleNote =
    nullable(
      data.schedule_note ??
      data.scheduleNote
    );

  const levelName =
    nullable(
      data.level_name ??
      data.levelName
    );

  const pathName =
    nullable(
      data.path_name ??
      data.pathName
    );

  try {
    if (
      !canTeacherUseCircleTeacherId(
        permission.user,
        teacherId
      )
    ) {
      return errorResponse(
        "TEACHER_OUT_OF_SCOPE",
        403
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
          : 409
      );
    }

    /*
     * الباقة مطلوبة للحلقة.
     */
    if (!packageId) {
      return errorResponse(
        "PACKAGE_ID_REQUIRED"
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
          "CIRCLE_CREATED_SUCCESSFULLY",
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

export async function onRequestPatch(
  context
) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "circles.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const circleId =
    data.id ??
    data.circle_id ??
    data.circleId;

  if (!validId(circleId)) {
    return errorResponse(
      "CIRCLE_ID_REQUIRED"
    );
  }

  try {
    const current =
      await getCircleById(
        db,
        Number(circleId)
      );

    if (!current) {
      return errorResponse(
        "CIRCLE_NOT_FOUND",
        404
      );
    }

    if (
      !canTeacherAccessCircle(
        permission.user,
        current
      )
    ) {
      return errorResponse(
        "CIRCLE_OUT_OF_SCOPE",
        403
      );
    }

    const circleType =
      normalizeType(
        data.circle_type ??
        data.circleType ??
        current.circle_type
      );

    if (
      !VALID_TYPES.includes(
        circleType
      )
    ) {
      return errorResponse(
        "INVALID_CIRCLE_TYPE"
      );
    }

    const name =
      data.name !== undefined
        ? clean(data.name)
        : current.name;

    if (!name) {
      return errorResponse(
        "CIRCLE_NAME_REQUIRED"
      );
    }

    /*
     * تحديد السعة الجديدة.
     */
    let capacity;

    if (
      circleType ===
      "individual"
    ) {
      capacity = 1;
    } else if (
      data.capacity !==
        undefined
    ) {
      capacity =
        positiveInteger(
          data.capacity
        );

      if (!capacity) {
        return errorResponse(
          "GROUP_CIRCLE_CAPACITY_REQUIRED"
        );
      }
    } else {
      capacity =
        Number(
          current.capacity
        );

      if (
        !Number.isInteger(
          capacity
        ) ||
        capacity <= 0
      ) {
        return errorResponse(
          "GROUP_CIRCLE_CAPACITY_REQUIRED"
        );
      }
    }

    /*
     * لا يمكن خفض السعة عن عدد
     * الطلاب المسجلين حاليًا.
     */
    const enrolledCount =
      await getEnrollmentCount(
        db,
        Number(circleId)
      );

    if (
      capacity < enrolledCount
    ) {
      return errorResponse(
        "CAPACITY_CANNOT_BE_LESS_THAN_CURRENT_ENROLLMENTS",
        409,
        {
          current_enrollments:
            enrolledCount,
          requested_capacity:
            capacity,
        }
      );
    }

    const teacherId =
      data.teacher_id !==
        undefined
        ? (
            data.teacher_id ===
              null ||
            data.teacher_id ===
              ""
              ? null
              : Number(
                  data.teacher_id
                )
          )
        : current.teacher_id;

    const packageId =
      data.package_id !==
        undefined
        ? (
            data.package_id ===
              null ||
            data.package_id ===
              ""
              ? null
              : Number(
                  data.package_id
                )
          )
        : current.package_id;

    if (!packageId) {
      return errorResponse(
        "PACKAGE_ID_REQUIRED"
      );
    }

    if (
      !canTeacherUseCircleTeacherId(
        permission.user,
        teacherId
      )
    ) {
      return errorResponse(
        "TEACHER_OUT_OF_SCOPE",
        403
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
          : 409
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

    let status =
      data.status !== undefined
        ? clean(data.status)
        : current.status;

    if (
      !VALID_STATUSES.includes(
        status
      )
    ) {
      return errorResponse(
        "INVALID_CIRCLE_STATUS"
      );
    }

    /*
     * حالة full يتم حسابها تلقائيًا
     * بناءً على السعة.
     */
    if (
      enrolledCount >=
      capacity
    ) {
      status = "full";
    } else if (
      status === "full"
    ) {
      status = "active";
    }

    const scheduleNote =
      data.schedule_note !==
        undefined ||
      data.scheduleNote !==
        undefined
        ? nullable(
            data.schedule_note ??
            data.scheduleNote
          )
        : current.schedule_note;

    const levelName =
      data.level_name !==
        undefined ||
      data.levelName !==
        undefined
        ? nullable(
            data.level_name ??
            data.levelName
          )
        : current.level_name;

    const pathName =
      data.path_name !==
        undefined ||
      data.pathName !==
        undefined
        ? nullable(
            data.path_name ??
            data.pathName
          )
        : current.path_name;

    const updatedAt =
      new Date().toISOString();

    const updated =
      await db
        .prepare(`
          UPDATE circles
          SET
            name = ?2,
            circle_type = ?3,
            teacher_id = ?4,
            package_id = ?5,
            capacity = ?6,
            status = ?7,
            schedule_note = ?8,
            level_name = ?9,
            path_name = ?10,
            updated_at = ?11
          WHERE id = ?1
          RETURNING
            id,
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
        `)
        .bind(
          Number(circleId),
          name,
          circleType,
          teacherId,
          packageId,
          capacity,
          status,
          scheduleNote,
          levelName,
          pathName,
          updatedAt
        )
        .first();

    const complete =
      await getCircleById(
        db,
        Number(circleId)
      );

    return json({
      success: true,
      message:
        "CIRCLE_UPDATED_SUCCESSFULLY",
      data:
        complete || updated,
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
   Router
========================================================= */

export async function onRequest(
  context
) {
  const method =
    context.request.method.toUpperCase();

  switch (method) {
    case "GET":
      return onRequestGet(
        context
      );

    case "POST":
      return onRequestPost(
        context
      );

    case "PATCH":
      return onRequestPatch(
        context
      );

    default:
      return errorResponse(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
