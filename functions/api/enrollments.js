/**
 * الأوَّابين — Circles API
 *
 * GET   /api/circles
 * POST  /api/circles
 * PATCH /api/circles
 *
 * يدعم:
 * - حلقات فردية
 * - حلقات جماعية
 * - الحلقة الفردية يمكن أن تضم 1 أو 2 أو أكثر
 *   مثل الإخوة
 * - سعة الحلقة الجماعية حسب الإدارة
 * - الإدارة/المشرف يستطيعان تعديل السعة
 * - عدم حذف أي طالب عند تخفيض السعة
 * - تحويل الحلقة إلى full عند اكتمال السعة
 * - إعادة الحلقة إلى active عند زيادة السعة
 * - ربط الحلقة بالمعلم
 * - ربط الحلقة بالباقة
 * - المستوى والمسار
 * - حالة الحلقة
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

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

function positiveInteger(
  value,
  fallback = 1
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(
    1,
    Math.floor(number)
  );
}

function isPositiveInteger(value) {
  return (
    Number.isInteger(value) &&
    value > 0
  );
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
   Permissions
========================================================= */

async function canManageCircles(
  db,
  userId
) {
  if (!userId) {
    return false;
  }

  const user = await db
    .prepare(`
      SELECT
        id,
        role,
        status
      FROM users
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(userId)
    .first();

  return Boolean(
    user &&
    user.status === "active" &&
    (
      user.role === "admin" ||
      user.role === "supervisor"
    )
  );
}

/* =========================================================
   Circle student count
========================================================= */

async function getCircleStudentCount(
  db,
  circleId
) {
  const row = await db
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

  return Number(
    row?.count || 0
  );
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const db = context.env?.DB;

  /*
   * إذا لم تكن قاعدة البيانات مربوطة،
   * لا نكسر الواجهة.
   */
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

    /* =====================================================
       Filter: ID
    ===================================================== */

    if (id) {
      const numericId =
        Number(id);

      if (
        !isPositiveInteger(
          numericId
        )
      ) {
        return errorResponse(
          "INVALID_CIRCLE_ID",
          400
        );
      }

      params.push(numericId);

      sql +=
        ` AND c.id = ?${params.length}`;
    }

    /* =====================================================
       Filter: Circle Type
    ===================================================== */

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

      sql +=
        ` AND c.circle_type = ?${params.length}`;
    }

    /* =====================================================
       Filter: Status
    ===================================================== */

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

      sql +=
        ` AND c.status = ?${params.length}`;
    }

    /* =====================================================
       Filter: Teacher
    ===================================================== */

    if (teacherId) {
      const numericTeacherId =
        Number(teacherId);

      if (
        !isPositiveInteger(
          numericTeacherId
        )
      ) {
        return errorResponse(
          "INVALID_TEACHER_ID",
          400
        );
      }

      params.push(
        numericTeacherId
      );

      sql +=
        ` AND c.teacher_id = ?${params.length}`;
    }

    /* =====================================================
       Filter: Package
    ===================================================== */

    if (packageId) {
      const numericPackageId =
        Number(packageId);

      if (
        !isPositiveInteger(
          numericPackageId
        )
      ) {
        return errorResponse(
          "INVALID_PACKAGE_ID",
          400
        );
      }

      params.push(
        numericPackageId
      );

      sql +=
        ` AND c.package_id = ?${params.length}`;
    }

    sql += `
      ORDER BY c.created_at DESC
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
   POST — Create Circle
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
      data.circle_type
    );

  const levelName =
    cleanString(
      data.level_name
    ) || null;

  const pathName =
    cleanString(
      data.path_name
    ) || null;

  const scheduleNote =
    cleanString(
      data.schedule_note
    ) || null;

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
   * السعة:
   *
   * الفردية:
   * يمكن أن تكون 1 أو 2 أو أكثر.
   * مثال: أخوان في نفس الحلقة الفردية.
   *
   * الجماعية:
   * السعة تحددها الإدارة.
   */

  const capacity =
    positiveInteger(
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

  const requestedStatus =
    cleanString(
      data.status ||
        "active"
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
    !isPositiveInteger(
      teacherId
    )
  ) {
    return errorResponse(
      "INVALID_TEACHER_ID",
      400
    );
  }

  if (
    packageId !== null &&
    !isPositiveInteger(
      packageId
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

    if (
      packageId !== null
    ) {
      pkg =
        await db
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

      if (
        pkg.status !==
        "active"
      ) {
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
       * إذا كانت الباقة لها سعة محددة،
       * فلا نسمح للحلقة بتجاوزها.
       */
      const packageCapacity =
        Number(
          pkg.capacity || 0
        );

      if (
        packageCapacity > 0 &&
        capacity >
          packageCapacity
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

    if (
      teacherId !== null
    ) {
      const teacher =
        await db
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

    const created =
      await db
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

            t.full_name
              AS teacher_name,

            p.name
              AS package_name,

            p.package_type,

            p.price
              AS package_price,

            p.currency
              AS package_currency,

            p.sessions_per_month,

            p.duration_minutes,

            p.capacity
              AS package_capacity

          FROM circles c

          LEFT JOIN teachers t
            ON t.id =
              c.teacher_id

          LEFT JOIN packages p
            ON p.id =
              c.package_id

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

        data:
          created || {
            id: circleId,
            name,
            circle_type:
              circleType,
            teacher_id:
              teacherId,
            package_id:
              packageId,
            capacity,
            status:
              requestedStatus,
            schedule_note:
              scheduleNote,
            level_name:
              levelName,
            path_name:
              pathName,
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

/* =========================================================
   PATCH — تعديل سعة الحلقة
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
    Number(
      data.circle_id
    );

  const capacity =
    Number(
      data.capacity
    );

  const decidedBy =
    Number(
      data.decided_by
    );

  /* =====================================================
     Validate Circle
  ===================================================== */

  if (
    !isPositiveInteger(
      circleId
    )
  ) {
    return errorResponse(
      "CIRCLE_ID_REQUIRED",
      400
    );
  }

  /* =====================================================
     Validate Capacity
  ===================================================== */

  if (
    !isPositiveInteger(
      capacity
    )
  ) {
    return errorResponse(
      "CAPACITY_MUST_BE_A_POSITIVE_INTEGER",
      400
    );
  }

  /* =====================================================
     Validate User
  ===================================================== */

  if (
    !isPositiveInteger(
      decidedBy
    )
  ) {
    return errorResponse(
      "DECIDED_BY_REQUIRED",
      400
    );
  }

  /* =====================================================
     Admin / Supervisor Only
  ===================================================== */

  const allowed =
    await canManageCircles(
      db,
      decidedBy
    );

  if (!allowed) {
    return errorResponse(
      "ONLY_ADMIN_OR_SUPERVISOR_CAN_CHANGE_CAPACITY",
      403
    );
  }

  try {
    /* =====================================================
       Get Circle
    ===================================================== */

    const circle =
      await db
        .prepare(`
          SELECT *
          FROM circles
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(circleId)
        .first();

    if (!circle) {
      return errorResponse(
        "CIRCLE_NOT_FOUND",
        404
      );
    }

    /* =====================================================
       Package Capacity
    ===================================================== */

    let packageCapacity = 0;

    if (
      circle.package_id
    ) {
      const pkg =
        await db
          .prepare(`
            SELECT
              capacity
            FROM packages
            WHERE id = ?1
            LIMIT 1
          `)
          .bind(
            circle.package_id
          )
          .first();

      packageCapacity =
        Number(
          pkg?.capacity || 0
        );
    }

    /*
     * الإدارة تستطيع تعديل السعة،
     * ولكن لا يمكن تجاوز السعة
     * القصوى المحددة للباقة إن وجدت.
     */

    if (
      packageCapacity > 0 &&
      capacity >
        packageCapacity
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

    /* =====================================================
       Current Students
    ===================================================== */

    const currentCount =
      await getCircleStudentCount(
        db,
        circleId
      );

    /* =====================================================
       Determine New Status
    ===================================================== */

    let newStatus =
      circle.status;

    /*
     * الفردية:
     *
     * لا نطبق عليها منطق
     * امتلاء الحلقة الجماعية.
     *
     * وبالتالي يمكن أن تكون:
     * 1
     * 2
     * 3
     * أو أكثر
     * حسب ما تحدده الإدارة.
     */

    if (
      circle.circle_type ===
      "group"
    ) {
      /*
       * إذا كان العدد الحالي
       * وصل إلى السعة أو تجاوزها:
       *
       * لا نحذف أي طالب.
       * فقط نعتبر الحلقة ممتلئة.
       */

      if (
        currentCount >=
        capacity
      ) {
        newStatus =
          "full";
      } else if (
        circle.status ===
        "full"
      ) {
        /*
         * الإدارة رفعت السعة
         * وأصبح هناك مكان.
         */
        newStatus =
          "active";
      }
    }

    /* =====================================================
       Update Circle
    ===================================================== */

    await db
      .prepare(`
        UPDATE circles

        SET
          capacity = ?1,
          status = ?2,
          updated_at = ?3

        WHERE id = ?4
      `)
      .bind(
        capacity,
        newStatus,
        new Date().toISOString(),
        circleId
      )
      .run();

    /* =====================================================
       Optional Audit Log
    ===================================================== */

    /*
     * لا نجعل فشل سجل التدقيق
     * يمنع تعديل السعة.
     */

    try {
      await db
        .prepare(`
          INSERT INTO audit_logs (
            user_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
          )
          VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6
          )
        `)
        .bind(
          decidedBy,

          "update_circle_capacity",

          "circle",

          circleId,

          JSON.stringify({
            old_capacity:
              Number(
                circle.capacity ||
                0
              ),

            new_capacity:
              capacity,

            current_students:
              currentCount,

            old_status:
              circle.status,

            new_status:
              newStatus,
          }),

          new Date().toISOString()
        )
        .run();
    } catch (auditError) {
      console.error(
        "Circle capacity audit error:",
        auditError
      );
    }

    /* =====================================================
       Get Updated Circle
    ===================================================== */

    const updated =
      await db
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

            t.full_name
              AS teacher_name,

            p.name
              AS package_name,

            p.package_type,

            p.price
              AS package_price,

            p.currency
              AS package_currency,

            p.sessions_per_month,

            p.duration_minutes,

            p.capacity
              AS package_capacity

          FROM circles c

          LEFT JOIN teachers t
            ON t.id =
              c.teacher_id

          LEFT JOIN packages p
            ON p.id =
              c.package_id

          WHERE c.id = ?1

          LIMIT 1
        `)
        .bind(circleId)
        .first();

    return json({
      success: true,

      message:
        "Circle capacity updated successfully.",

      data:
        updated,

      previous_capacity:
        Number(
          circle.capacity || 0
        ),

      new_capacity:
        capacity,

      current_students:
        currentCount,

      previous_status:
        circle.status,

      status:
        newStatus,
    });
  } catch (error) {
    console.error(
      "Circles PATCH error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLE_CAPACITY_UPDATE_FAILED",
      500
    );
  }
}
