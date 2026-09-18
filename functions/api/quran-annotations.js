import {
  json,
  requireAuth
} from "./_auth.js";

function getUrl(request) {
  return new URL(request.url);
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function getStudentForUser(db, user) {
  const row = await db.prepare(`
    SELECT id
    FROM students
    WHERE user_id = ?
    LIMIT 1
  `).bind(user.id).first();

  return row || null;
}

async function canCohostManageQuran(
  db,
  user,
  sessionId
) {
  if (!user || !sessionId || !user.id) {
    return false;
  }

  const row = await db.prepare(`
    SELECT
      h.host_role,
      h.permissions_json
    FROM live_rooms r
    INNER JOIN live_room_hosts h
      ON h.room_id = r.id
     AND h.user_id = ?
     AND h.status = 'active'
    WHERE r.session_id = ?
    LIMIT 1
  `).bind(
    user.id,
    sessionId
  ).first();

  if (!row || row.host_role !== "cohost") {
    return false;
  }

  try {
    const permissions = JSON.parse(
      row.permissions_json || "[]"
    );

    return Array.isArray(permissions) &&
      permissions.includes("quran_manage");
  } catch {
    return false;
  }
}

async function canManageStudent(
  db,
  user,
  studentId,
  sessionId = null
) {
  if (!user || !studentId) {
    return false;
  }

  // الإدارة لها صلاحية شاملة.
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  // الطالب يستطيع إدارة ملاحظاته الخاصة.
  const ownStudent = await getStudentForUser(
    db,
    user
  );

  if (
    ownStudent &&
    Number(ownStudent.id) === Number(studentId)
  ) {
    return true;
  }

  // المضيف المشارك لا يصل إلا لطالب مسجل في نفس الجلسة
  // ومع امتلاكه quran_manage.
  if (
    sessionId &&
    await canCohostManageQuran(
      db,
      user,
      sessionId
    )
  ) {
    const registration = await db.prepare(`
      SELECT id
      FROM session_registrations
      WHERE session_id = ?
        AND student_id = ?
        AND status IN (
          'registered',
          'completed',
          'no_show'
        )
      LIMIT 1
    `).bind(
      sessionId,
      studentId
    ).first();

    if (registration) {
      return true;
    }
  }

  // المعلم يصل فقط إلى الطلاب الموجودين فعليًا
  // في حلقة نشطة هو معلمها.
  if (
    user.role === "teacher" &&
    user.teacher_id
  ) {
    const assigned = await db.prepare(`
      SELECT 1
      FROM circle_enrollments ce
      INNER JOIN circles c
        ON c.id = ce.circle_id
      WHERE ce.student_id = ?
        AND ce.status = 'active'
        AND c.teacher_id = ?
        AND c.status = 'active'
      LIMIT 1
    `).bind(
      studentId,
      user.teacher_id
    ).first();

    return Boolean(assigned);
  }

  return false;
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = getUrl(request);

  let studentId = Number(
    url.searchParams.get("student_id") || 0
  );

  const ayahId = Number(
    url.searchParams.get("ayah_id") || 0
  );

  const sessionId = Number(
    url.searchParams.get("session_id") || 0
  );

  if (!studentId) {
    const student = await getStudentForUser(
      env.DB,
      auth.user
    );

    if (!student) {
      return json({
        success: false,
        error: "STUDENT_NOT_FOUND"
      }, 404);
    }

    studentId = Number(student.id);
  }

  if (!await canManageStudent(
    env.DB,
    auth.user,
    studentId,
    sessionId
  )) {
    return json({
      success: false,
      error: "QURAN_ACCESS_DENIED"
    }, 403);
  }

  let sql = `
    SELECT
      id,
      student_id,
      ayah_id,
      annotation_type,
      annotation_data,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM quran_student_annotations
    WHERE student_id = ?
  `;

  const params = [studentId];

  if (ayahId) {
    sql += ` AND ayah_id = ?`;
    params.push(ayahId);
  }

  sql += ` ORDER BY ayah_id, id`;

  const result = await env.DB
    .prepare(sql)
    .bind(...params)
    .all();

  return json({
    success: true,
    annotations: (result.results || []).map((row) => ({
      ...row,
      annotation_data: parseJson(row.annotation_data)
    }))
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      error: "INVALID_JSON"
    }, 400);
  }

  const studentId = Number(body.student_id || 0);
  const ayahId = Number(body.ayah_id || 0);
  const sessionId = Number(body.session_id || 0);

  const annotationType = String(
    body.annotation_type || ""
  ).trim();

  if (!studentId || !ayahId || !annotationType) {
    return json({
      success: false,
      error: "INVALID_ANNOTATION"
    }, 400);
  }

  if (!await canManageStudent(
    env.DB,
    auth.user,
    studentId,
    sessionId
  )) {
    return json({
      success: false,
      error: "QURAN_ACCESS_DENIED"
    }, 403);
  }

  const allowed = new Set([
    "note",
    "highlight",
    "stop",
    "start",
    "memorization",
    "review",
    "tamkeen",
    "error",
    "review_word",
    "favorite",
    "teacher_note"
  ]);

  if (!allowed.has(annotationType)) {
    return json({
      success: false,
      error: "INVALID_ANNOTATION_TYPE"
    }, 400);
  }

  const annotationData =
    body.annotation_data &&
    typeof body.annotation_data === "object"
      ? body.annotation_data
      : {};

  const result = await env.DB.prepare(`
    INSERT INTO quran_student_annotations (
      student_id,
      ayah_id,
      annotation_type,
      annotation_data,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    studentId,
    ayahId,
    annotationType,
    JSON.stringify(annotationData),
    auth.user.id,
    auth.user.id
  ).run();

  return json({
    success: true,
    id: result.meta?.last_row_id || null
  }, 201);
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = getUrl(request);
  const id = Number(url.searchParams.get("id") || 0);

  const sessionId = Number(
    url.searchParams.get("session_id") || 0
  );

  if (!id) {
    return json({
      success: false,
      error: "ANNOTATION_ID_REQUIRED"
    }, 400);
  }

  const row = await env.DB.prepare(`
    SELECT student_id
    FROM quran_student_annotations
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();

  if (!row) {
    return json({
      success: false,
      error: "ANNOTATION_NOT_FOUND"
    }, 404);
  }

  if (!await canManageStudent(
    env.DB,
    auth.user,
    row.student_id,
    sessionId
  )) {
    return json({
      success: false,
      error: "QURAN_ACCESS_DENIED"
    }, 403);
  }

  await env.DB.prepare(`
    DELETE FROM quran_student_annotations
    WHERE id = ?
  `).bind(id).run();

  return json({
    success: true
  });
}
