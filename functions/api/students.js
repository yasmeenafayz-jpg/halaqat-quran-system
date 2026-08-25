import { requirePermission } from "./_auth.js";

/**
 * الأوَّابين — Students API
 *
 * GET    /api/students
 * GET    /api/students?id=1
 * POST   /api/students
 * PATCH  /api/students
 *
 * مسؤول عن:
 * - عرض الطلاب.
 * - عرض طالب محدد.
 * - البحث في الطلاب.
 * - إضافة طالب.
 * - تعديل بيانات الطالب.
 * - تغيير حالة الطالب.
 * - تسجيل العمليات في audit_logs.
 */

const STUDENT_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "graduated",
  "deleted",
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
  const valueClean =
    clean(value);

  return valueClean
    ? valueClean
    : null;
}

function validStatus(status) {
  return STUDENT_STATUSES.includes(
    status
  );
}

function validId(value) {
  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  );
}

function generateStudentCode() {
  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase();

  return `ST-${timestamp}-${random}`;
}

/* =========================================================
   Student Query
========================================================= */

async function getStudentById(
  db,
  studentId
) {
  return db
    .prepare(`
      SELECT
        id,
        user_id,
        student_code,
        full_name,
        gender,
        birth_date,
        phone,
        email,
        guardian_name,
        guardian_phone,
        guardian_email,
        address,
        country,
        educational_level,
        notes,
        status,
        created_at,
        updated_at
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(studentId)
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
          'student',
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
     * فشل سجل العمليات لا يمنع
     * عملية الطالب الأساسية.
     */
    console.error(
      "STUDENT_AUDIT_FAILED",
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
  const permission = await requirePermission(
    context.request,
    context.env,
    "students.read"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const studentId =
    url.searchParams.get(
      "id"
    );

  const status =
    clean(
      url.searchParams.get(
        "status"
      )
    );

  const search =
    clean(
      url.searchParams.get(
        "search"
      )
    );

  try {
    /* =====================================================
       طالب واحد
    ===================================================== */

    if (studentId) {
      if (
        !validId(studentId)
      ) {
        return error(
          "INVALID_STUDENT_ID",
          400
        );
      }

      const student =
        await getStudentById(
          db,
          Number(studentId)
        );

      if (!student) {
        return error(
          "STUDENT_NOT_FOUND",
          404
        );
      }

      return json({
        ok: true,
        data: student,
      });
    }

    /* =====================================================
       قائمة الطلاب
    ===================================================== */

    let sql = `
      SELECT
        id,
        user_id,
        student_code,
        full_name,
        gender,
        birth_date,
        phone,
        email,
        guardian_name,
        guardian_phone,
        guardian_email,
        address,
        country,
        educational_level,
        notes,
        status,
        created_at,
        updated_at
      FROM students
      WHERE 1 = 1
    `;

    const params = [];

    /* -----------------------------------------------------
       فلترة الحالة
    ----------------------------------------------------- */

    if (status) {
      if (
        !validStatus(status)
      ) {
        return error(
          "INVALID_STUDENT_STATUS",
          400,
          {
            allowed:
              STUDENT_STATUSES,
          }
        );
      }

      params.push(status);

      sql += `
        AND status = ?${params.length}
      `;
    }

    /* -----------------------------------------------------
       البحث
       
       الإصلاح المهم:
       نضع قيمة البحث مرة لكل placeholder
       بدون إضافة parameter زائد.
    ----------------------------------------------------- */

    if (search) {
      const searchValue =
        `%${search}%`;

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue
      );

      const start =
        params.length - 5;

      /*
       * نستخدم أرقام placeholders
       * متوافقة مع ترتيب params.
       */
      sql += `
        AND (
          full_name LIKE ?${start}
          OR student_code LIKE ?${start + 1}
          OR phone LIKE ?${start + 2}
          OR guardian_name LIKE ?${start + 3}
          OR guardian_phone LIKE ?${start + 4}
          OR email LIKE ?${start + 5}
        )
      `;
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
      "STUDENTS_GET_FAILED",
      errorObject
    );

    return error(
      errorObject instanceof Error
        ? errorObject.message
        : "STUDENTS_FETCH_FAILED",
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
    "students.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const suppliedCode =
    clean(
      body.student_code ??
      body.studentCode
    );

  const studentCode =
    suppliedCode ||
    generateStudentCode();

  const status =
    clean(
      body.status
    ) || "active";

  if (
    !validStatus(status)
  ) {
    return error(
      "INVALID_STUDENT_STATUS",
      400,
      {
        allowed:
          STUDENT_STATUSES,
      }
    );
  }

  const userId =
    body.user_id ??
    body.userId ??
    null;

  const gender =
    nullable(
      body.gender
    );

  const birthDate =
    nullable(
      body.birth_date ??
      body.birthDate
    );

  const phone =
    nullable(
      body.phone
    );

  const email =
    nullable(
      body.email
    );

  const guardianName =
    nullable(
      body.guardian_name ??
      body.guardianName
    );

  const guardianPhone =
    nullable(
      body.guardian_phone ??
      body.guardianPhone
    );

  const guardianEmail =
    nullable(
      body.guardian_email ??
      body.guardianEmail
    );

  const address =
    nullable(
      body.address
    );

  const country =
    clean(
      body.country
    ) || "Egypt";

  const educationalLevel =
    nullable(
      body.educational_level ??
      body.educationalLevel
    );

  const notes =
    nullable(
      body.notes
    );

  try {
    /* -----------------------------------------------------
       منع تكرار كود الطالب
    ----------------------------------------------------- */

    const existingCode =
      await db
        .prepare(`
          SELECT id
          FROM students
          WHERE student_code = ?1
          LIMIT 1
        `)
        .bind(studentCode)
        .first();

    if (existingCode) {
      return error(
        "STUDENT_CODE_ALREADY_EXISTS",
        409
      );
    }

    const createdAt =
      new Date().toISOString();

    const result =
      await db
        .prepare(`
          INSERT INTO students (
            user_id,
            student_code,
            full_name,
            gender,
            birth_date,
            phone,
            email,
            guardian_name,
            guardian_phone,
            guardian_email,
            address,
            country,
            educational_level,
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
            ?13,
            ?14,
            ?15,
            ?16,
            ?16
          )
        `)
        .bind(
          userId,
          studentCode,
          fullName,
          gender,
          birthDate,
          phone,
          email,
          guardianName,
          guardianPhone,
          guardianEmail,
          address,
          country,
          educationalLevel,
          notes,
          status,
          createdAt
        )
        .run();

    const studentId =
      result.meta?.last_row_id ||
      null;

    await writeAudit(
      db,
      "student_created",
      studentId,
      {
        student_code:
          studentCode,
        full_name:
          fullName,
        status,
      }
    );

    const createdStudent =
      studentId
        ? await getStudentById(
            db,
            Number(studentId)
          )
        : null;

    return json(
      {
        ok: true,
        id: studentId,
        student_code:
          studentCode,
        data:
          createdStudent,
      },
      201
    );
  } catch (errorObject) {
    console.error(
      "STUDENT_CREATE_FAILED",
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
        "STUDENT_CODE_ALREADY_EXISTS",
        409
      );
    }

    return error(
      message ||
        "STUDENT_CREATE_FAILED",
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
    "students.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

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

  const studentId =
    body.id ??
    body.student_id ??
    body.studentId;

  if (
    !validId(studentId)
  ) {
    return error(
      "STUDENT_ID_REQUIRED",
      400
    );
  }

  try {
    const current =
      await getStudentById(
        db,
        Number(studentId)
      );

    if (!current) {
      return error(
        "STUDENT_NOT_FOUND",
        404
      );
    }

    const fullName =
      body.full_name !==
        undefined ||
      body.fullName !==
        undefined
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

    const studentCode =
      body.student_code !==
        undefined ||
      body.studentCode !==
        undefined
        ? clean(
            body.student_code ??
            body.studentCode
          )
        : current.student_code;

    if (!studentCode) {
      return error(
        "STUDENT_CODE_REQUIRED",
        400
      );
    }

    const status =
      body.status !==
        undefined
        ? clean(
            body.status
          )
        : current.status;

    if (
      !validStatus(status)
    ) {
      return error(
        "INVALID_STUDENT_STATUS",
        400,
        {
          allowed:
            STUDENT_STATUSES,
        }
      );
    }

    /* -----------------------------------------------------
       منع تكرار كود الطالب
    ----------------------------------------------------- */

    if (
      studentCode !==
      current.student_code
    ) {
      const duplicate =
        await db
          .prepare(`
            SELECT id
            FROM students
            WHERE student_code = ?1
              AND id != ?2
            LIMIT 1
          `)
          .bind(
            studentCode,
            Number(studentId)
          )
          .first();

      if (duplicate) {
        return error(
          "STUDENT_CODE_ALREADY_EXISTS",
          409
        );
      }
    }

    const userId =
      body.user_id !==
        undefined ||
      body.userId !==
        undefined
        ? (
            body.user_id ??
            body.userId ??
            null
          )
        : current.user_id;

    const gender =
      body.gender !==
        undefined
        ? nullable(
            body.gender
          )
        : current.gender;

    const birthDate =
      body.birth_date !==
        undefined ||
      body.birthDate !==
        undefined
        ? nullable(
            body.birth_date ??
            body.birthDate
          )
        : current.birth_date;

    const phone =
      body.phone !==
        undefined
        ? nullable(
            body.phone
          )
        : current.phone;

    const email =
      body.email !==
        undefined
        ? nullable(
            body.email
          )
        : current.email;

    const guardianName =
      body.guardian_name !==
        undefined ||
      body.guardianName !==
        undefined
        ? nullable(
            body.guardian_name ??
            body.guardianName
          )
        : current.guardian_name;

    const guardianPhone =
      body.guardian_phone !==
        undefined ||
      body.guardianPhone !==
        undefined
        ? nullable(
            body.guardian_phone ??
            body.guardianPhone
          )
        : current.guardian_phone;

    const guardianEmail =
      body.guardian_email !==
        undefined ||
      body.guardianEmail !==
        undefined
        ? nullable(
            body.guardian_email ??
            body.guardianEmail
          )
        : current.guardian_email;

    const address =
      body.address !==
        undefined
        ? nullable(
            body.address
          )
        : current.address;

    const country =
      body.country !==
        undefined
        ? (
            clean(
              body.country
            ) || "Egypt"
          )
        : current.country;

    const educationalLevel =
      body.educational_level !==
        undefined ||
      body.educationalLevel !==
        undefined
        ? nullable(
            body.educational_level ??
            body.educationalLevel
          )
        : current.educational_level;

    const notes =
      body.notes !==
        undefined
        ? nullable(
            body.notes
          )
        : current.notes;

    const updatedAt =
      new Date().toISOString();

    const updated =
      await db
        .prepare(`
          UPDATE students
          SET
            user_id = ?2,
            student_code = ?3,
            full_name = ?4,
            gender = ?5,
            birth_date = ?6,
            phone = ?7,
            email = ?8,
            guardian_name = ?9,
            guardian_phone = ?10,
            guardian_email = ?11,
            address = ?12,
            country = ?13,
            educational_level = ?14,
            notes = ?15,
            status = ?16,
            updated_at = ?17
          WHERE id = ?1
          RETURNING
            id,
            user_id,
            student_code,
            full_name,
            gender,
            birth_date,
            phone,
            email,
            guardian_name,
            guardian_phone,
            guardian_email,
            address,
            country,
            educational_level,
            notes,
            status,
            created_at,
            updated_at
        `)
        .bind(
          Number(studentId),
          userId,
          studentCode,
          fullName,
          gender,
          birthDate,
          phone,
          email,
          guardianName,
          guardianPhone,
          guardianEmail,
          address,
          country,
          educationalLevel,
          notes,
          status,
          updatedAt
        )
        .first();

    await writeAudit(
      db,
      "student_updated",
      Number(studentId),
      {
        before: {
          student_code:
            current.student_code,
          full_name:
            current.full_name,
          status:
            current.status,
        },
        after: {
          student_code:
            studentCode,
          full_name:
            fullName,
          status,
        },
      }
    );

    return json({
      ok: true,
      data: updated,
    });
  } catch (errorObject) {
    console.error(
      "STUDENT_UPDATE_FAILED",
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
        "STUDENT_CODE_ALREADY_EXISTS",
        409
      );
    }

    return error(
      message ||
        "STUDENT_UPDATE_FAILED",
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
      return error(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
