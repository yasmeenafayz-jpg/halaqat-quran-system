/**
 * الأوَّابين — Teachers API
 *
 * GET    /api/teachers
 * GET    /api/teachers?id=1
 * POST   /api/teachers
 * PATCH  /api/teachers
 *
 * إدارة بيانات المعلمين:
 * - عرض المعلمين
 * - البحث والفلترة
 * - عرض معلم محدد
 * - إضافة معلم
 * - تعديل بيانات المعلم
 * - تغيير حالة المعلم
 */

const TEACHER_STATUSES = [
  "active",
  "inactive",
  "suspended",
];

const JSON_HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",
};

/* =========================================================
   Helpers
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: JSON_HEADERS,
    }
  );
}

function error(
  message,
  status = 400,
  extra = {}
) {
  return json(
    {
      ok: false,
      error: message,
      ...extra,
    },
    status
  );
}

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}

function nullable(value) {
  const valueClean = clean(value);

  return valueClean
    ? valueClean
    : null;
}

function validStatus(status) {
  return TEACHER_STATUSES.includes(
    status
  );
}

function experienceValue(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  return Math.floor(number);
}

function generateTeacherCode() {
  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase();

  return `TE-${timestamp}-${random}`;
}

/* =========================================================
   Query
========================================================= */

async function getTeacherById(
  db,
  id
) {
  return db
    .prepare(`
      SELECT
        id,
        user_id,
        teacher_code,
        full_name,
        phone,
        email,
        specialization,
        qualifications,
        experience_years,
        bio,
        notes,
        status,
        created_at,
        updated_at
      FROM teachers
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

/* =========================================================
   Audit
========================================================= */

async function writeAudit(
  db,
  action,
  entityId,
  details = {}
) {
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
          NULL,
          ?1,
          'teacher',
          ?2,
          ?3,
          ?4
        )
      `)
      .bind(
        action,
        entityId || null,
        JSON.stringify(details),
        new Date().toISOString()
      )
      .run();
  } catch (auditError) {
    /*
     * سجل التدقيق لا يمنع العملية
     * الأساسية إذا حدث فيه خطأ.
     */
    console.error(
      "TEACHER_AUDIT_FAILED",
      auditError
    );
  }
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const db =
    context.env?.DB;

  if (!db) {
    return error(
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

  const status =
    url.searchParams.get("status");

  const search =
    clean(
      url.searchParams.get(
        "search"
      )
    );

  try {
    /*
     * جلب معلم واحد
     */
    if (id) {
      const teacher =
        await getTeacherById(
          db,
          id
        );

      if (!teacher) {
        return error(
          "TEACHER_NOT_FOUND",
          404
        );
      }

      return json({
        ok: true,
        data: teacher,
      });
    }

    /*
     * قائمة المعلمين
     */
    let sql = `
      SELECT
        id,
        user_id,
        teacher_code,
        full_name,
        phone,
        email,
        specialization,
        qualifications,
        experience_years,
        bio,
        notes,
        status,
        created_at,
        updated_at
      FROM teachers
      WHERE 1 = 1
    `;

    const params = [];

    if (status) {
      if (
        !validStatus(status)
      ) {
        return error(
          "INVALID_TEACHER_STATUS",
          400,
          {
            allowed:
              TEACHER_STATUSES,
          }
        );
      }

      sql += `
        AND status = ?
      `;

      params.push(status);
    }

    if (search) {
      const searchValue =
        `%${search}%`;

      sql += `
        AND (
          full_name LIKE ?
          OR teacher_code LIKE ?
          OR phone LIKE ?
          OR email LIKE ?
          OR specialization LIKE ?
          OR qualifications LIKE ?
        )
      `;

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );
    }

    sql += `
      ORDER BY
        created_at DESC,
        id DESC
    `;

    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    return json({
      ok: true,
      data:
        result.results || [],
      count:
        result.results?.length ||
        0,
    });
  } catch (errorObject) {
    console.error(
      "TEACHERS_GET_FAILED",
      errorObject
    );

    return error(
      errorObject instanceof Error
        ? errorObject.message
        : "TEACHERS_FETCH_FAILED",
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
  const db =
    context.env?.DB;

  if (!db) {
    return error(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let body;

  try {
    body =
      await context.request.json();
  } catch {
    return error(
      "INVALID_JSON",
      400
    );
  }

  if (
    !body ||
    typeof body !== "object"
  ) {
    return error(
      "INVALID_REQUEST_BODY",
      400
    );
  }

  const fullName =
    clean(
      body.full_name ??
      body.fullName
    );

  if (!fullName) {
    return error(
      "FULL_NAME_REQUIRED",
      400
    );
  }

  const teacherCodeInput =
    clean(
      body.teacher_code ??
      body.teacherCode
    );

  const teacherCode =
    teacherCodeInput ||
    generateTeacherCode();

  const status =
    clean(body.status) ||
    "active";

  if (
    !validStatus(status)
  ) {
    return error(
      "INVALID_TEACHER_STATUS",
      400,
      {
        allowed:
          TEACHER_STATUSES,
      }
    );
  }

  const experienceYears =
    experienceValue(
      body.experience_years ??
      body.experienceYears
    );

  if (
    experienceYears === null
  ) {
    return error(
      "INVALID_EXPERIENCE_YEARS",
      400
    );
  }

  const userId =
    body.user_id ??
    body.userId ??
    null;

  const phone =
    nullable(body.phone);

  const email =
    nullable(body.email);

  const specialization =
    nullable(
      body.specialization
    );

  const qualifications =
    nullable(
      body.qualifications
    );

  const bio =
    nullable(body.bio);

  const notes =
    nullable(body.notes);

  try {
    /*
     * منع تكرار كود المعلم.
     */
    const existingCode =
      await db
        .prepare(`
          SELECT id
          FROM teachers
          WHERE teacher_code = ?1
          LIMIT 1
        `)
        .bind(teacherCode)
        .first();

    if (existingCode) {
      return error(
        "TEACHER_CODE_ALREADY_EXISTS",
        409
      );
    }

    const now =
      new Date().toISOString();

    const result =
      await db
        .prepare(`
          INSERT INTO teachers (
            user_id,
            teacher_code,
            full_name,
            phone,
            email,
            specialization,
            qualifications,
            experience_years,
            bio,
            notes,
            status,
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
            ?12
          )
        `)
        .bind(
          userId,
          teacherCode,
          fullName,
          phone,
          email,
          specialization,
          qualifications,
          experienceYears,
          bio,
          notes,
          status,
          now
        )
        .run();

    const teacherId =
      result.meta?.last_row_id ||
      null;

    await writeAudit(
      db,
      "teacher_created",
      teacherId,
      {
        teacher_code:
          teacherCode,
        full_name:
          fullName,
        status,
      }
    );

    const createdTeacher =
      teacherId
        ? await getTeacherById(
            db,
            teacherId
          )
        : null;

    return json(
      {
        ok: true,
        id: teacherId,
        teacher_code:
          teacherCode,
        data:
          createdTeacher,
      },
      201
    );
  } catch (errorObject) {
    console.error(
      "TEACHER_CREATE_FAILED",
      errorObject
    );

    const message =
      errorObject instanceof Error
        ? errorObject.message
        : "";

    if (
      message
        .toLowerCase()
        .includes("unique")
    ) {
      return error(
        "TEACHER_CODE_ALREADY_EXISTS",
        409
      );
    }

    return error(
      message ||
        "TEACHER_CREATE_FAILED",
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
  const db =
    context.env?.DB;

  if (!db) {
    return error(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let body;

  try {
    body =
      await context.request.json();
  } catch {
    return error(
      "INVALID_JSON",
      400
    );
  }

  if (
    !body ||
    typeof body !== "object"
  ) {
    return error(
      "INVALID_REQUEST_BODY",
      400
    );
  }

  const teacherId =
    body.id ??
    body.teacher_id ??
    body.teacherId;

  if (
    teacherId === undefined ||
    teacherId === null ||
    String(teacherId).trim() === ""
  ) {
    return error(
      "TEACHER_ID_REQUIRED",
      400
    );
  }

  try {
    const current =
      await getTeacherById(
        db,
        teacherId
      );

    if (!current) {
      return error(
        "TEACHER_NOT_FOUND",
        404
      );
    }

    const fullName =
      body.full_name !== undefined ||
      body.fullName !== undefined
        ? clean(
            body.full_name ??
            body.fullName
          )
        : current.full_name;

    if (!fullName) {
      return error(
        "FULL_NAME_REQUIRED",
        400
      );
    }

    const teacherCode =
      body.teacher_code !== undefined ||
      body.teacherCode !== undefined
        ? clean(
            body.teacher_code ??
            body.teacherCode
          )
        : current.teacher_code;

    if (!teacherCode) {
      return error(
        "TEACHER_CODE_REQUIRED",
        400
      );
    }

    const status =
      body.status !== undefined
        ? clean(body.status)
        : current.status;

    if (
      !validStatus(status)
    ) {
      return error(
        "INVALID_TEACHER_STATUS",
        400,
        {
          allowed:
            TEACHER_STATUSES,
        }
      );
    }

    const experienceYears =
      body.experience_years !== undefined ||
      body.experienceYears !== undefined
        ? experienceValue(
            body.experience_years ??
            body.experienceYears
          )
        : current.experience_years;

    if (
      experienceYears === null
    ) {
      return error(
        "INVALID_EXPERIENCE_YEARS",
        400
      );
    }

    /*
     * منع استخدام كود معلم آخر.
     */
    if (
      teacherCode !==
      current.teacher_code
    ) {
      const duplicate =
        await db
          .prepare(`
            SELECT id
            FROM teachers
            WHERE teacher_code = ?1
              AND id != ?2
            LIMIT 1
          `)
          .bind(
            teacherCode,
            teacherId
          )
          .first();

      if (duplicate) {
        return error(
          "TEACHER_CODE_ALREADY_EXISTS",
          409
        );
      }
    }

    const userId =
      body.user_id !== undefined ||
      body.userId !== undefined
        ? (
            body.user_id ??
            body.userId
          )
        : current.user_id;

    const phone =
      body.phone !== undefined
        ? nullable(body.phone)
        : current.phone;

    const email =
      body.email !== undefined
        ? nullable(body.email)
        : current.email;

    const specialization =
      body.specialization !== undefined
        ? nullable(
            body.specialization
          )
        : current.specialization;

    const qualifications =
      body.qualifications !== undefined
        ? nullable(
            body.qualifications
          )
        : current.qualifications;

    const bio =
      body.bio !== undefined
        ? nullable(body.bio)
        : current.bio;

    const notes =
      body.notes !== undefined
        ? nullable(body.notes)
        : current.notes;

    const now =
      new Date().toISOString();

    await db
      .prepare(`
        UPDATE teachers
        SET
          user_id = ?1,
          teacher_code = ?2,
          full_name = ?3,
          phone = ?4,
          email = ?5,
          specialization = ?6,
          qualifications = ?7,
          experience_years = ?8,
          bio = ?9,
          notes = ?10,
          status = ?11,
          updated_at = ?12
        WHERE id = ?13
      `)
      .bind(
        userId,
        teacherCode,
        fullName,
        phone,
        email,
        specialization,
        qualifications,
        experienceYears,
        bio,
        notes,
        status,
        now,
        teacherId
      )
      .run();

    const updatedTeacher =
      await getTeacherById(
        db,
        teacherId
      );

    await writeAudit(
      db,
      "teacher_updated",
      teacherId,
      {
        old_status:
          current.status,
        new_status:
          status,
        old_teacher_code:
          current.teacher_code,
        new_teacher_code:
          teacherCode,
      }
    );

    return json({
      ok: true,
      data:
        updatedTeacher,
    });
  } catch (errorObject) {
    console.error(
      "TEACHER_UPDATE_FAILED",
      errorObject
    );

    const message =
      errorObject instanceof Error
        ? errorObject.message
        : "";

    if (
      message
        .toLowerCase()
        .includes("unique")
    ) {
      return error(
        "TEACHER_CODE_ALREADY_EXISTS",
        409
      );
    }

    return error(
      message ||
        "TEACHER_UPDATE_FAILED",
      500
    );
  }
}

/* =========================================================
   Method Router
========================================================= */

export async function onRequest(
  context
) {
  switch (
    context.request.method.toUpperCase()
  ) {
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
      return error(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
