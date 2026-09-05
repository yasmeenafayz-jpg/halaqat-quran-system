// =========================================================
// الأوَّابين — Tests API
// functions/api/tests.js
// =========================================================

import {
  requireAuth,
  requirePermission,
  hasPermission,
  json,
  writeAudit,
} from "./_auth.js";

function errorResponse(error, message, status = 400) {
  return json(
    {
      success: false,
      error,
      message,
    },
    status
  );
}

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function calculatePercentage(score, maxScore) {
  if (
    !Number.isFinite(score) ||
    !Number.isFinite(maxScore) ||
    maxScore <= 0
  ) {
    return 0;
  }

  const percentage = (score / maxScore) * 100;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(percentage * 100) / 100
    )
  );
}

async function getTeacherId(db, user) {
  if (user?.teacher_id) {
    return validId(user.teacher_id);
  }

  const row = await db
    .prepare(`
      SELECT id
      FROM teachers
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first();

  return validId(row?.id);
}

async function getStudentId(db, user) {
  if (user?.student_id) {
    return validId(user.student_id);
  }

  const row = await db
    .prepare(`
      SELECT id
      FROM students
      WHERE user_id = ?
      LIMIT 1
    `)
    .bind(user.id)
    .first();

  return validId(row?.id);
}

async function canTeacherAccessStudent(db, teacherId, studentId) {
  const row = await db
    .prepare(`
      SELECT 1
      FROM circles c
      INNER JOIN circle_enrollments ce
        ON ce.circle_id = c.id
      WHERE c.teacher_id = ?
        AND ce.student_id = ?
        AND ce.status IN ('active', 'paused')
        AND c.status IN ('active', 'full')
      LIMIT 1
    `)
    .bind(teacherId, studentId)
    .first();

  return !!row;
}

async function canReadStudentTests(db, user, studentId) {
  if (user.role === "admin") {
    return true;
  }

  const ownStudentId = await getStudentId(db, user);

  if (
    user.role === "student" &&
    ownStudentId === studentId
  ) {
    return true;
  }

  if (
    user.role === "teacher" ||
    user.role === "supervisor"
  ) {
    if (user.role === "supervisor") {
      return true;
    }

    const teacherId = await getTeacherId(db, user);

    if (!teacherId) {
      return false;
    }

    const row = await db
      .prepare(`
        SELECT 1
        FROM tests t
        WHERE t.student_id = ?
          AND t.teacher_id = ?
        LIMIT 1
      `)
      .bind(studentId, teacherId)
      .first();

    return !!row;
  }

  return false;
}

async function getTests(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "tests.read"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;
  const url = new URL(request.url);

  const requestedStudentId =
    validId(url.searchParams.get("student_id"));

  const requestedTeacherId =
    validId(url.searchParams.get("teacher_id"));

  const requestedSessionId =
    validId(url.searchParams.get("session_id"));

  const limitRaw =
    Number(url.searchParams.get("limit") || 100);

  const limit = Math.max(
    1,
    Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 100)
  );

  const params = [];
  const where = [];

  if (user.role === "student") {
    const studentId = await getStudentId(
      env.DB,
      user
    );

    if (!studentId) {
      return json({
        success: true,
        data: [],
        tests: [],
      });
    }

    where.push("t.student_id = ?");
    params.push(studentId);
  } else if (user.role === "teacher") {
    const teacherId = await getTeacherId(
      env.DB,
      user
    );

    if (!teacherId) {
      return json({
        success: true,
        data: [],
        tests: [],
      });
    }

    where.push("t.teacher_id = ?");
    params.push(teacherId);

    if (requestedStudentId) {
      where.push("t.student_id = ?");
      params.push(requestedStudentId);
    }
  } else if (
    user.role === "supervisor" ||
    user.role === "admin"
  ) {
    if (requestedStudentId) {
      where.push("t.student_id = ?");
      params.push(requestedStudentId);
    }

    if (requestedTeacherId) {
      where.push("t.teacher_id = ?");
      params.push(requestedTeacherId);
    }
  }

  if (requestedSessionId) {
    where.push("t.session_id = ?");
    params.push(requestedSessionId);
  }

  const query = `
    SELECT
      t.*,
      s.name AS student_name,
      te.name AS teacher_name
    FROM tests t
    LEFT JOIN students s
      ON s.id = t.student_id
    LEFT JOIN teachers te
      ON te.id = t.teacher_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY t.tested_at DESC, t.id DESC
    LIMIT ${limit}
  `;

  const result = await env.DB
    .prepare(query)
    .bind(...params)
    .all();

  return json({
    success: true,
    data: result.results || [],
    tests: result.results || [],
  });
}

async function createTest(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "tests.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  if (
    user.role !== "admin" &&
    user.role !== "supervisor" &&
    user.role !== "teacher"
  ) {
    return errorResponse(
      "FORBIDDEN",
      "لا يسمح لهذا الحساب بإنشاء اختبار.",
      403
    );
  }

  const body = await request.json().catch(
    () => null
  );

  if (!body || typeof body !== "object") {
    return errorResponse(
      "INVALID_BODY",
      "بيانات الاختبار غير صالحة."
    );
  }

  let studentId = validId(body.student_id);

  if (!studentId) {
    return errorResponse(
      "INVALID_STUDENT_ID",
      "معرّف الطالب غير صالح."
    );
  }

  const studentExists = await env.DB
    .prepare(`
      SELECT id
      FROM students
      WHERE id = ?
      LIMIT 1
    `)
    .bind(studentId)
    .first();

  if (!studentExists) {
    return errorResponse(
      "STUDENT_NOT_FOUND",
      "الطالب غير موجود.",
      404
    );
  }

  let teacherId = validId(body.teacher_id);

  if (user.role === "teacher") {
    teacherId = await getTeacherId(
      env.DB,
      user
    );

    if (!teacherId) {
      return errorResponse(
        "TEACHER_NOT_FOUND",
        "تعذر تحديد حساب المعلم.",
        403
      );
    }

    const studentAccess = await canTeacherAccessStudent(
      env.DB,
      teacherId,
      studentId
    );

    if (!studentAccess) {
      return errorResponse(
        "STUDENT_NOT_ASSIGNED_TO_TEACHER",
        "لا يمكنك إنشاء اختبار لطالب غير تابع لإحدى حلقاتك.",
        403
      );
    }
  }

  if (teacherId) {
    const teacherExists = await env.DB
      .prepare(`
        SELECT id
        FROM teachers
        WHERE id = ?
        LIMIT 1
      `)
      .bind(teacherId)
      .first();

    if (!teacherExists) {
      return errorResponse(
        "TEACHER_NOT_FOUND",
        "المعلم غير موجود.",
        404
      );
    }
  }

  const sessionId =
    body.session_id === undefined ||
    body.session_id === null ||
    body.session_id === ""
      ? null
      : validId(body.session_id);

  if (
    body.session_id !== undefined &&
    body.session_id !== null &&
    body.session_id !== "" &&
    !sessionId
  ) {
    return errorResponse(
      "INVALID_SESSION_ID",
      "معرّف الجلسة غير صالح."
    );
  }

  if (sessionId) {
    const sessionExists = await env.DB
      .prepare(`
        SELECT id, circle_id, teacher_id, student_id
        FROM sessions
        WHERE id = ?
        LIMIT 1
      `)
      .bind(sessionId)
      .first();

    if (!sessionExists) {
      return errorResponse(
        "SESSION_NOT_FOUND",
        "الجلسة غير موجودة.",
        404
      );
    }

    if (user.role === "teacher") {
      if (
        !teacherId ||
        Number(sessionExists.teacher_id) !== Number(teacherId)
      ) {
        return errorResponse(
          "SESSION_NOT_ASSIGNED_TO_TEACHER",
          "لا يمكنك ربط الاختبار بجلسة ليست تابعة لك.",
          403
        );
      }

      if (sessionExists.circle_id) {
        const enrolledInSessionCircle = await env.DB
          .prepare(`
            SELECT 1
            FROM circle_enrollments
            WHERE circle_id = ?
              AND student_id = ?
              AND status IN ('active', 'paused')
            LIMIT 1
          `)
          .bind(
            sessionExists.circle_id,
            studentId
          )
          .first();

        if (!enrolledInSessionCircle) {
          return errorResponse(
            "STUDENT_NOT_ENROLLED_IN_SESSION_CIRCLE",
            "الطالب غير مسجل في حلقة هذه الجلسة.",
            403
          );
        }
      } else if (
        sessionExists.student_id !== null &&
        sessionExists.student_id !== undefined
      ) {
        if (
          Number(sessionExists.student_id) !== Number(studentId)
        ) {
          return errorResponse(
            "STUDENT_NOT_ASSIGNED_TO_SESSION",
            "الطالب غير مرتبط بهذه الجلسة الفردية.",
            403
          );
        }
      } else {
        return errorResponse(
          "SESSION_HAS_NO_STUDENT_SCOPE",
          "لا يمكن ربط الاختبار بجلسة لا تحتوي على طالب أو حلقة.",
          403
        );
      }
    }
  }

  const title =
    String(body.title ?? "").trim();

  if (!title) {
    return errorResponse(
      "INVALID_TITLE",
      "عنوان الاختبار مطلوب."
    );
  }

  if (title.length > 200) {
    return errorResponse(
      "TITLE_TOO_LONG",
      "عنوان الاختبار طويل جدًا."
    );
  }

  const score =
    normalizeNumber(body.score, 0);

  const maxScore =
    normalizeNumber(body.max_score, 100);

  if (
    score === null ||
    maxScore === null ||
    maxScore <= 0 ||
    score < 0 ||
    score > maxScore
  ) {
    return errorResponse(
      "INVALID_SCORE",
      "درجة الاختبار غير صالحة."
    );
  }

  const percentage =
    calculatePercentage(score, maxScore);

  const resultValue =
    body.result === undefined ||
    body.result === null
      ? null
      : String(body.result).trim();

  const notes =
    body.notes === undefined ||
    body.notes === null
      ? null
      : String(body.notes).trim();

  const testType =
    body.test_type === undefined ||
    body.test_type === null
      ? null
      : String(body.test_type).trim();

  const testedAt =
    body.tested_at === undefined ||
    body.tested_at === null ||
    body.tested_at === ""
      ? null
      : String(body.tested_at).trim();

  const inserted = await env.DB
    .prepare(`
      INSERT INTO tests (
        student_id,
        teacher_id,
        session_id,
        title,
        test_type,
        score,
        max_score,
        percentage,
        result,
        notes,
        tested_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      RETURNING *
    `)
    .bind(
      studentId,
      teacherId,
      sessionId,
      title,
      testType,
      score,
      maxScore,
      percentage,
      resultValue,
      notes,
      testedAt
    )
    .first();

  await writeAudit(env, {
    userId: user.id,
    action: "tests.create",
    entityType: "test",
    entityId: inserted?.id ?? null,
    request,
    details: {
      student_id: studentId,
      teacher_id: teacherId,
      session_id: sessionId,
      percentage,
    },
  });

  return json(
    {
      success: true,
      message: "TEST_CREATED_SUCCESSFULLY",
      data: inserted,
    },
    201
  );
}

async function updateTest(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "tests.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  const body = await request.json().catch(
    () => null
  );

  const id = validId(
    body?.id ??
    new URL(request.url).searchParams.get("id")
  );

  if (!id) {
    return errorResponse(
      "INVALID_TEST_ID",
      "معرّف الاختبار غير صالح."
    );
  }

  const existing = await env.DB
    .prepare(`
      SELECT *
      FROM tests
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(
      "TEST_NOT_FOUND",
      "الاختبار غير موجود.",
      404
    );
  }

  if (user.role === "teacher") {
    const teacherId = await getTeacherId(
      env.DB,
      user
    );

    if (
      !teacherId ||
      Number(existing.teacher_id) !== teacherId
    ) {
      return errorResponse(
        "FORBIDDEN",
        "لا يمكنك تعديل هذا الاختبار.",
        403
      );
    }
  }

  const title =
    body.title === undefined
      ? existing.title
      : String(body.title).trim();

  if (!title) {
    return errorResponse(
      "INVALID_TITLE",
      "عنوان الاختبار مطلوب."
    );
  }

  const score =
    body.score === undefined
      ? Number(existing.score)
      : normalizeNumber(body.score);

  const maxScore =
    body.max_score === undefined
      ? Number(existing.max_score)
      : normalizeNumber(body.max_score);

  if (
    score === null ||
    maxScore === null ||
    maxScore <= 0 ||
    score < 0 ||
    score > maxScore
  ) {
    return errorResponse(
      "INVALID_SCORE",
      "درجة الاختبار غير صالحة."
    );
  }

  const percentage =
    calculatePercentage(score, maxScore);

  const updated = await env.DB
    .prepare(`
      UPDATE tests
      SET
        title = ?2,
        test_type = ?3,
        score = ?4,
        max_score = ?5,
        percentage = ?6,
        result = ?7,
        notes = ?8
      WHERE id = ?1
      RETURNING *
    `)
    .bind(
      id,
      title,
      body.test_type === undefined
        ? existing.test_type
        : String(body.test_type ?? "").trim() || null,
      score,
      maxScore,
      percentage,
      body.result === undefined
        ? existing.result
        : String(body.result ?? "").trim() || null,
      body.notes === undefined
        ? existing.notes
        : String(body.notes ?? "").trim() || null
    )
    .first();

  await writeAudit(env, {
    userId: user.id,
    action: "tests.update",
    entityType: "test",
    entityId: id,
    request,
    details: {
      student_id: existing.student_id,
      percentage,
    },
  });

  return json({
    success: true,
    message: "TEST_UPDATED_SUCCESSFULLY",
    data: updated,
  });
}

async function deleteTest(request, env) {
  const auth = await requirePermission(
    request,
    env,
    "tests.write"
  );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  if (
    user.role !== "admin" &&
    user.role !== "supervisor"
  ) {
    return errorResponse(
      "FORBIDDEN",
      "حذف الاختبارات متاح للإدارة فقط.",
      403
    );
  }

  const url = new URL(request.url);

  const id = validId(
    url.searchParams.get("id")
  );

  if (!id) {
    return errorResponse(
      "INVALID_TEST_ID",
      "معرّف الاختبار غير صالح."
    );
  }

  const existing = await env.DB
    .prepare(`
      SELECT id, student_id
      FROM tests
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!existing) {
    return errorResponse(
      "TEST_NOT_FOUND",
      "الاختبار غير موجود.",
      404
    );
  }

  await env.DB
    .prepare(`
      DELETE FROM tests
      WHERE id = ?
    `)
    .bind(id)
    .run();

  await writeAudit(env, {
    userId: user.id,
    action: "tests.delete",
    entityType: "test",
    entityId: id,
    request,
    details: {
      student_id: existing.student_id,
    },
  });

  return json({
    success: true,
    message: "TEST_DELETED_SUCCESSFULLY",
  });
}

export async function onRequestGet(context) {
  try {
    return await getTests(
      context.request,
      context.env
    );
  } catch (error) {
    console.error("tests GET error", error);

    return errorResponse(
      "SERVER_ERROR",
      "تعذر تحميل الاختبارات.",
      500
    );
  }
}

export async function onRequestPost(context) {
  try {
    return await createTest(
      context.request,
      context.env
    );
  } catch (error) {
    console.error("tests POST error", error);

    return errorResponse(
      "SERVER_ERROR",
      "تعذر إنشاء الاختبار.",
      500
    );
  }
}

export async function onRequestPatch(context) {
  try {
    return await updateTest(
      context.request,
      context.env
    );
  } catch (error) {
    console.error("tests PATCH error", error);

    return errorResponse(
      "SERVER_ERROR",
      "تعذر تعديل الاختبار.",
      500
    );
  }
}

export async function onRequestDelete(context) {
  try {
    return await deleteTest(
      context.request,
      context.env
    );
  } catch (error) {
    console.error("tests DELETE error", error);

    return errorResponse(
      "SERVER_ERROR",
      "تعذر حذف الاختبار.",
      500
    );
  }
}
