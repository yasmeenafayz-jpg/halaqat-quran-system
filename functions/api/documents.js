import {
  requireAuth,
  hasPermission,
  json
} from "./_auth.js";

function getId(request) {
  const url = new URL(request.url);
  const value = url.searchParams.get("id");

  if (!value) return null;

  const id = Number(value);

  return Number.isInteger(id) && id > 0
    ? id
    : null;
}

async function canAccessDocument(db, user, documentId, action = "read") {
  /*
   * Admin has full access.
   * Other roles must be explicitly scoped to the document.
   */
  if (user.role === "admin") {
    return true;
  }

  const row = await db
    .prepare(`
      SELECT
        d.owner_user_id,
        d.student_id,
        d.teacher_id,
        dp.can_view,
        dp.can_download,
        dp.can_edit,
        dp.can_delete
      FROM documents d
      LEFT JOIN document_permissions dp
        ON dp.document_id = d.id
       AND (
         dp.user_id = ?
         OR dp.role = ?
       )
      WHERE d.id = ?
      ORDER BY
        CASE
          WHEN dp.user_id = ? THEN 0
          WHEN dp.role = ? THEN 1
          ELSE 2
        END
      LIMIT 1
    `)
    .bind(
      user.id,
      user.role,
      documentId,
      user.id,
      user.role
    )
    .first();

  if (!row) {
    return false;
  }

  /*
   * Explicit document permission.
   * User-specific permission has priority over role permission.
   */
  if (row.can_view !== null) {
    if (action === "write") {
      return Number(row.can_edit) === 1;
    }

    if (action === "delete") {
      return Number(row.can_delete) === 1;
    }

    if (action === "download") {
      return Number(row.can_download) === 1;
    }

    return Number(row.can_view) === 1;
  }

  /*
   * Document owner.
   */
  if (Number(row.owner_user_id) === Number(user.id)) {
    return true;
  }

  /*
   * Student:
   * only documents explicitly assigned to this student.
   */
  if (
    user.role === "student" &&
    user.student_id &&
    Number(row.student_id) === Number(user.student_id)
  ) {
    return action !== "delete";
  }

  /*
   * Teacher:
   * only documents explicitly assigned to this teacher.
   */
  if (
    user.role === "teacher" &&
    user.teacher_id &&
    Number(row.teacher_id) === Number(user.teacher_id)
  ) {
    return action !== "delete";
  }

  /*
   * Guardian:
   * only documents belonging to a student linked
   * to this guardian through student_guardians.
   *
   * Base guardian access is read/download only.
   * Edit/delete requires an explicit document permission,
   * which is handled above.
   */
  if (
    user.role === "guardian" &&
    row.student_id
  ) {
    const linkedStudent = await db
      .prepare(`
        SELECT 1
        FROM student_guardians sg
        INNER JOIN guardians g
          ON g.id = sg.guardian_id
        WHERE g.user_id = ?
          AND sg.student_id = ?
        LIMIT 1
      `)
      .bind(
        user.id,
        row.student_id
      )
      .first();

    if (linkedStudent) {
      return action === "read" || action === "download";
    }
  }

  return false;
}

async function listDocuments(request, env, user) {
  const url = new URL(request.url);

  const studentId = url.searchParams.get("student_id");
  const teacherId = url.searchParams.get("teacher_id");
  const documentType = url.searchParams.get("document_type");
  const status = url.searchParams.get("status") || "active";

  let sql = `
    SELECT
      d.id,
      d.file_name,
      d.storage_key,
      d.mime_type,
      d.file_size,
      d.document_type,
      d.title,
      d.description,
      d.storage_type,
      d.external_url,
      d.checksum,
      d.status,
      d.student_id,
      d.teacher_id,
      d.owner_user_id,
      d.uploaded_by,
      d.created_at,
      d.updated_at
    FROM documents d
    WHERE d.status = ?
  `;

  const params = [status];

  if (studentId) {
    const id = Number(studentId);

    if (!Number.isInteger(id) || id <= 0) {
      return json({
        success: false,
        error: "INVALID_STUDENT_ID"
      }, 400);
    }

    sql += ` AND d.student_id = ?`;
    params.push(id);
  }

  if (teacherId) {
    const id = Number(teacherId);

    if (!Number.isInteger(id) || id <= 0) {
      return json({
        success: false,
        error: "INVALID_TEACHER_ID"
      }, 400);
    }

    sql += ` AND d.teacher_id = ?`;
    params.push(id);
  }

  if (documentType) {
    sql += ` AND d.document_type = ?`;
    params.push(documentType);
  }

  /*
   * Admin:
   * can see the complete document collection.
   */
  if (user.role !== "admin") {
    /*
     * Non-admin users only receive documents that could
     * legitimately belong to them or have an explicit
     * document permission.
     *
     * The final decision is still made by canAccessDocument(),
     * which applies user-specific permissions before role
     * permissions and then the normal ownership/scope rules.
     */
    sql += `
      AND (
        d.owner_user_id = ?
        OR (
          ? = 'student'
          AND ? IS NOT NULL
          AND d.student_id = ?
        )
        OR (
          ? = 'teacher'
          AND ? IS NOT NULL
          AND d.teacher_id = ?
        )
        OR (
          ? = 'guardian'
          AND EXISTS (
            SELECT 1
            FROM student_guardians sg
            INNER JOIN guardians g
              ON g.id = sg.guardian_id
            WHERE g.user_id = ?
              AND sg.student_id = d.student_id
          )
        )
        OR EXISTS (
          SELECT 1
          FROM document_permissions dp
          WHERE dp.document_id = d.id
            AND (
              dp.user_id = ?
              OR dp.role = ?
            )
        )
      )
    `;

    params.push(
      user.id,

      user.role,
      user.student_id ?? null,
      user.student_id ?? null,

      user.role,
      user.teacher_id ?? null,
      user.teacher_id ?? null,

      user.role,
      user.id,

      user.id,
      user.role
    );
  }

  sql += ` ORDER BY d.created_at DESC LIMIT 200`;

  const result = await env.DB
    .prepare(sql)
    .bind(...params)
    .all();

  const candidates = result.results || [];

  /*
   * Apply the same authoritative access-control function
   * used by get/update/delete.
   *
   * This guarantees that an explicit can_view=0 permission
   * is respected and that user-specific permissions have
   * priority over role permissions.
   */
  const documents = [];

  for (const document of candidates) {
    if (
      await canAccessDocument(
        env.DB,
        user,
        document.id,
        "read"
      )
    ) {
      documents.push(document);
    }
  }

  return json({
    success: true,
    documents
  });
}

async function getDocument(request, env, user) {
  const id = getId(request);

  if (!id) {
    return json({
      success: false,
      error: "INVALID_DOCUMENT_ID"
    }, 400);
  }

  const allowed =
    await canAccessDocument(
      env.DB,
      user,
      id,
      "read"
    );

  if (!allowed) {
    return json({
      success: false,
      error: "FORBIDDEN"
    }, 403);
  }

  const document = await env.DB
    .prepare(`
      SELECT
        d.id,
        d.file_name,
        d.storage_key,
        d.mime_type,
        d.file_size,
        d.document_type,
        d.title,
        d.description,
        d.storage_type,
        d.external_url,
        d.checksum,
        d.status,
        d.student_id,
        d.teacher_id,
        d.owner_user_id,
        d.uploaded_by,
        d.created_at,
        d.updated_at
      FROM documents d
      WHERE d.id = ?
      LIMIT 1
    `)
    .bind(id)
    .first();

  if (!document) {
    return json({
      success: false,
      error: "DOCUMENT_NOT_FOUND"
    }, 404);
  }

  return json({
    success: true,
    document
  });
}

async function createDocument(request, env, user) {
  if (
    !(await hasPermission(
      env.DB,
      user,
      "documents.write"
    ))
  ) {
    return json({
      success: false,
      error: "FORBIDDEN"
    }, 403);
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

  const title =
    body.title?.toString().trim() || null;

  const fileName =
    body.file_name?.toString().trim() || null;

  const documentType =
    body.document_type?.toString().trim() || "other";

  const storageType =
    body.storage_type?.toString().trim() || "file";

  const externalUrl =
    body.external_url?.toString().trim() || null;

  /*
   * Scope ownership is server-controlled.
   * Non-admin users may not assign documents to
   * another student, teacher, or owner.
   */
  if (user.role !== "admin") {
    if (
      body.owner_user_id != null &&
      Number(body.owner_user_id) !== Number(user.id)
    ) {
      return json({
        success: false,
        error: "OWNER_SCOPE_FORBIDDEN"
      }, 403);
    }

    if (
      user.role === "student" &&
      body.student_id != null &&
      Number(body.student_id) !== Number(user.student_id)
    ) {
      return json({
        success: false,
        error: "STUDENT_SCOPE_FORBIDDEN"
      }, 403);
    }

    if (
      user.role === "teacher" &&
      body.teacher_id != null &&
      Number(body.teacher_id) !== Number(user.teacher_id)
    ) {
      return json({
        success: false,
        error: "TEACHER_SCOPE_FORBIDDEN"
      }, 403);
    }
  }

  if (!title && !fileName) {
    return json({
      success: false,
      error: "TITLE_OR_FILE_NAME_REQUIRED"
    }, 400);
  }

  if (
    storageType === "external" &&
    !externalUrl
  ) {
    return json({
      success: false,
      error: "EXTERNAL_URL_REQUIRED"
    }, 400);
  }

  const result = await env.DB
    .prepare(`
      INSERT INTO documents (
        file_name,
        storage_key,
        mime_type,
        file_size,
        document_type,
        title,
        description,
        storage_type,
        external_url,
        checksum,
        status,
        student_id,
        teacher_id,
        owner_user_id,
        uploaded_by,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      fileName,
      body.storage_key || body.file_path || null,
      body.mime_type || null,
      body.file_size || null,
      documentType,
      title || fileName,
      body.description || null,
      storageType,
      externalUrl,
      body.checksum || null,
      body.student_id || null,
      body.teacher_id || null,
      body.owner_user_id || user.id,
      user.id
    )
    .run();

  return json({
    success: true,
    id: result.meta?.last_row_id || null
  }, 201);
}

async function updateDocument(request, env, user) {
  const id = getId(request);

  if (!id) {
    return json({
      success: false,
      error: "INVALID_DOCUMENT_ID"
    }, 400);
  }

  const allowed =
    await canAccessDocument(
      env.DB,
      user,
      id,
      "write"
    );

  if (!allowed) {
    return json({
      success: false,
      error: "FORBIDDEN"
    }, 403);
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

  const fields = [];
  const values = [];

  /*
   * Scope/ownership fields are protected from non-admin
   * reassignment. A teacher/student can edit document
   * content but cannot move the document to another user.
   */
  if (user.role !== "admin") {
    if (
      Object.prototype.hasOwnProperty.call(body, "student_id") ||
      Object.prototype.hasOwnProperty.call(body, "teacher_id") ||
      Object.prototype.hasOwnProperty.call(body, "owner_user_id")
    ) {
      return json({
        success: false,
        error: "DOCUMENT_SCOPE_CHANGE_FORBIDDEN"
      }, 403);
    }
  }

  const allowedFields = [
    "title",
    "description",
    "document_type",
    "storage_type",
    "external_url",
    "status"
  ];

  if (user.role === "admin") {
    allowedFields.push(
      "student_id",
      "teacher_id",
      "owner_user_id"
    );
  }

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      fields.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (!fields.length) {
    return json({
      success: false,
      error: "NO_FIELDS_TO_UPDATE"
    }, 400);
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");

  values.push(id);

  await env.DB
    .prepare(`
      UPDATE documents
      SET ${fields.join(", ")}
      WHERE id = ?
    `)
    .bind(...values)
    .run();

  return json({
    success: true,
    message: "DOCUMENT_UPDATED"
  });
}

async function deleteDocument(request, env, user) {
  const id = getId(request);

  if (!id) {
    return json({
      success: false,
      error: "INVALID_DOCUMENT_ID"
    }, 400);
  }

  const allowed =
    await canAccessDocument(
      env.DB,
      user,
      id,
      "delete"
    );

  if (!allowed) {
    return json({
      success: false,
      error: "FORBIDDEN"
    }, 403);
  }

  await env.DB
    .prepare(`
      UPDATE documents
      SET
        status = 'deleted',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(id)
    .run();

  return json({
    success: true,
    message: "DOCUMENT_DELETED"
  });
}


export async function onRequest(context) {
  const { request, env } = context;

  const auth =
    await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;
  const method = request.method.toUpperCase();

  if (method === "GET") {
    const id = getId(request);

    if (id) {
      return getDocument(
        request,
        env,
        user
      );
    }

    return listDocuments(
      request,
      env,
      user
    );
  }

  if (method === "POST") {
    return createDocument(
      request,
      env,
      user
    );
  }

  if (method === "PUT") {
    return updateDocument(
      request,
      env,
      user
    );
  }

  if (method === "DELETE") {
    return deleteDocument(
      request,
      env,
      user
    );
  }

  return json({
    success: false,
    error: "METHOD_NOT_ALLOWED"
  }, 405);
}
