import {
  json,
  requireAuth,
  hasPermission
} from "./_auth.js";

const MATERIAL_TYPES = new Set([
  "lesson",
  "tafsir",
  "fiqh",
  "hadith",
  "sirah",
  "noorani",
  "quran",
  "document",
  "link",
  "note",
  "other"
]);

async function getSession(db, sessionId) {
  return db.prepare(`
    SELECT
      s.id,
      s.circle_id,
      s.student_id,
      s.session_type,
      s.status,
      c.teacher_id,
      c.status AS circle_status,
      c.circle_type
    FROM sessions s
    LEFT JOIN circles c
      ON c.id = s.circle_id
    WHERE s.id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function canCohostManageMaterials(
  db,
  user,
  sessionId
) {
  if (!user || !user.id || !sessionId) {
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
    const permissions =
      JSON.parse(row.permissions_json || "[]");

    return Array.isArray(permissions) &&
      permissions.includes("materials_manage");
  } catch {
    return false;
  }
}

async function canManageMaterials(
  db,
  user,
  session
) {
  if (!user || !session) {
    return false;
  }

  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (
    user.role === "teacher" &&
    user.teacher_id &&
    session.teacher_id &&
    Number(user.teacher_id) ===
      Number(session.teacher_id)
  ) {
    return true;
  }

  return await canCohostManageMaterials(
    db,
    user,
    session.id
  );
}

async function canReadMaterials(
  db,
  user,
  session
) {
  if (!user || !session) {
    return false;
  }

  /*
   * Administrative access.
   */
  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  /*
   * The assigned teacher can read the materials
   * of their own session.
   */
  if (
    user.role === "teacher" &&
    user.teacher_id &&
    session.teacher_id &&
    Number(user.teacher_id) ===
      Number(session.teacher_id)
  ) {
    return true;
  }

  /*
   * A co-host may read materials only when
   * explicitly granted materials_manage.
   */
  if (
    await canCohostManageMaterials(
      db,
      user,
      session.id
    )
  ) {
    return true;
  }

  /*
   * Student access:
   * - individual session -> the assigned student only
   * - group session -> active circle member
   */
  if (
    user.role === "student" &&
    user.student_id
  ) {
    if (
      session.student_id &&
      Number(session.student_id) ===
        Number(user.student_id)
    ) {
      return true;
    }

    if (
      session.circle_id &&
      session.circle_type === "group"
    ) {
      const membership = await db
        .prepare(`
          SELECT 1
          FROM circle_enrollments
          WHERE circle_id = ?
            AND student_id = ?
            AND status = 'active'
          LIMIT 1
        `)
        .bind(
          session.circle_id,
          user.student_id
        )
        .first();

      if (membership) {
        return true;
      }
    }
  }

  /*
   * Guardian access:
   * - individual session -> linked to the session student
   * - group session -> linked to at least one active
   *   student in the session circle
   */
  if (user.role === "guardian") {
    if (session.student_id) {
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
          session.student_id
        )
        .first();

      if (linkedStudent) {
        return true;
      }
    }

    if (
      session.circle_id &&
      session.circle_type === "group"
    ) {
      const linkedMember = await db
        .prepare(`
          SELECT 1
          FROM student_guardians sg
          INNER JOIN guardians g
            ON g.id = sg.guardian_id
          INNER JOIN circle_enrollments ce
            ON ce.student_id = sg.student_id
          WHERE g.user_id = ?
            AND ce.circle_id = ?
            AND ce.status = 'active'
          LIMIT 1
        `)
        .bind(
          user.id,
          session.circle_id
        )
        .first();

      if (linkedMember) {
        return true;
      }
    }
  }

  return false;
}

async function getAuthorizedSession(
  request,
  env
) {
  const url = new URL(request.url);

  const sessionId = Number(
    url.searchParams.get("session_id") || 0
  );

  if (!Number.isInteger(sessionId) || sessionId < 1) {
    return {
      ok: false,
      response: json({
        success: false,
        error: "SESSION_ID_REQUIRED"
      }, 400)
    };
  }

  const session =
    await getSession(env.DB, sessionId);

  if (!session) {
    return {
      ok: false,
      response: json({
        success: false,
        error: "SESSION_NOT_FOUND"
      }, 404)
    };
  }

  return {
    ok: true,
    session
  };
}

export async function onRequestGet({
  request,
  env
}) {
  const auth =
    await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const checked =
    await getAuthorizedSession(
      request,
      env
    );

  if (!checked.ok) {
    return checked.response;
  }

  if (
    !await canReadMaterials(
      env.DB,
      auth.user,
      checked.session
    )
  ) {
    return json({
      success: false,
      error: "MATERIALS_ACCESS_DENIED"
    }, 403);
  }

  const result = await env.DB.prepare(`
    SELECT
      id,
      session_id,
      title,
      material_type,
      content,
      external_url,
      document_id,
      quran_ayah_id,
      sort_order,
      status,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM session_materials
    WHERE session_id = ?
      AND status = 'active'
    ORDER BY sort_order ASC, id ASC
  `).bind(
    checked.session.id
  ).all();

  return json({
    success: true,
    session: checked.session,
    materials: result.results || []
  });
}

export async function onRequestPost({
  request,
  env
}) {
  const auth =
    await requireAuth(request, env);

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

  const sessionId = Number(
    body?.session_id || 0
  );

  if (!Number.isInteger(sessionId) || sessionId < 1) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED"
    }, 400);
  }

  const session =
    await getSession(env.DB, sessionId);

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND"
    }, 404);
  }

  if (
    !await canManageMaterials(
      env.DB,
      auth.user,
      session
    )
  ) {
    return json({
      success: false,
      error: "MATERIALS_MANAGE_FORBIDDEN"
    }, 403);
  }

  const title =
    String(body?.title || "").trim();

  if (!title) {
    return json({
      success: false,
      error: "TITLE_REQUIRED"
    }, 400);
  }

  const materialType =
    String(
      body?.material_type || "lesson"
    ).trim();

  if (!MATERIAL_TYPES.has(materialType)) {
    return json({
      success: false,
      error: "INVALID_MATERIAL_TYPE"
    }, 400);
  }

  const sortOrder =
    body?.sort_order == null
      ? 0
      : Number(body.sort_order);

  if (
    !Number.isInteger(sortOrder) ||
    sortOrder < 0
  ) {
    return json({
      success: false,
      error: "INVALID_SORT_ORDER"
    }, 400);
  }

  const documentId =
    body?.document_id == null
      ? null
      : Number(body.document_id);

  const quranAyahId =
    body?.quran_ayah_id == null
      ? null
      : Number(body.quran_ayah_id);

  if (
    documentId !== null &&
    (
      !Number.isInteger(documentId) ||
      documentId < 1
    )
  ) {
    return json({
      success: false,
      error: "INVALID_DOCUMENT_ID"
    }, 400);
  }

  if (
    quranAyahId !== null &&
    (
      !Number.isInteger(quranAyahId) ||
      quranAyahId < 1
    )
  ) {
    return json({
      success: false,
      error: "INVALID_QURAN_AYAH_ID"
    }, 400);
  }

  if (documentId !== null) {
    const document =
      await env.DB.prepare(`
        SELECT id
        FROM documents
        WHERE id = ?
          AND status != 'deleted'
        LIMIT 1
      `).bind(documentId).first();

    if (!document) {
      return json({
        success: false,
        error: "DOCUMENT_NOT_FOUND"
      }, 404);
    }
  }

  const result =
    await env.DB.prepare(`
      INSERT INTO session_materials (
        session_id,
        title,
        material_type,
        content,
        external_url,
        document_id,
        quran_ayah_id,
        sort_order,
        created_by,
        updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId,
      title,
      materialType,
      body?.content == null
        ? null
        : String(body.content),
      body?.external_url == null
        ? null
        : String(body.external_url).trim() || null,
      documentId,
      quranAyahId,
      sortOrder,
      auth.user.id,
      auth.user.id
    ).run();

  return json({
    success: true,
    id: result.meta?.last_row_id || null
  }, 201);
}

export async function onRequestPut({
  request,
  env
}) {
  const auth =
    await requireAuth(request, env);

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

  const id =
    Number(body?.id || 0);

  if (!Number.isInteger(id) || id < 1) {
    return json({
      success: false,
      error: "MATERIAL_ID_REQUIRED"
    }, 400);
  }

  const current =
    await env.DB.prepare(`
      SELECT session_id
      FROM session_materials
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

  if (!current) {
    return json({
      success: false,
      error: "MATERIAL_NOT_FOUND"
    }, 404);
  }

  const session =
    await getSession(
      env.DB,
      Number(current.session_id)
    );

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND"
    }, 404);
  }

  if (
    !await canManageMaterials(
      env.DB,
      auth.user,
      session
    )
  ) {
    return json({
      success: false,
      error: "MATERIALS_MANAGE_FORBIDDEN"
    }, 403);
  }

  const fields = [];
  const values = [];

  if ("title" in body) {
    const title =
      String(body.title || "").trim();

    if (!title) {
      return json({
        success: false,
        error: "TITLE_REQUIRED"
      }, 400);
    }

    fields.push("title = ?");
    values.push(title);
  }

  if ("material_type" in body) {
    const type =
      String(body.material_type || "").trim();

    if (!MATERIAL_TYPES.has(type)) {
      return json({
        success: false,
        error: "INVALID_MATERIAL_TYPE"
      }, 400);
    }

    fields.push("material_type = ?");
    values.push(type);
  }

  if ("content" in body) {
    fields.push("content = ?");
    values.push(
      body.content == null
        ? null
        : String(body.content)
    );
  }

  if ("external_url" in body) {
    fields.push("external_url = ?");
    values.push(
      body.external_url == null
        ? null
        : String(body.external_url).trim() || null
    );
  }

  if ("document_id" in body) {
    const value =
      body.document_id == null
        ? null
        : Number(body.document_id);

    if (
      value !== null &&
      (!Number.isInteger(value) || value < 1)
    ) {
      return json({
        success: false,
        error: "INVALID_DOCUMENT_ID"
      }, 400);
    }

    if (value !== null) {
      const document =
        await env.DB.prepare(`
          SELECT id
          FROM documents
          WHERE id = ?
            AND status != 'deleted'
          LIMIT 1
        `).bind(value).first();

      if (!document) {
        return json({
          success: false,
          error: "DOCUMENT_NOT_FOUND"
        }, 404);
      }
    }

    fields.push("document_id = ?");
    values.push(value);
  }

  if ("quran_ayah_id" in body) {
    const value =
      body.quran_ayah_id == null
        ? null
        : Number(body.quran_ayah_id);

    if (
      value !== null &&
      (!Number.isInteger(value) || value < 1)
    ) {
      return json({
        success: false,
        error: "INVALID_QURAN_AYAH_ID"
      }, 400);
    }

    fields.push("quran_ayah_id = ?");
    values.push(value);
  }

  if ("sort_order" in body) {
    const value =
      Number(body.sort_order);

    if (
      !Number.isInteger(value) ||
      value < 0
    ) {
      return json({
        success: false,
        error: "INVALID_SORT_ORDER"
      }, 400);
    }

    fields.push("sort_order = ?");
    values.push(value);
  }

  if ("status" in body) {
    const status =
      String(body.status || "").trim();

    if (
      status !== "active" &&
      status !== "archived"
    ) {
      return json({
        success: false,
        error: "INVALID_STATUS"
      }, 400);
    }

    fields.push("status = ?");
    values.push(status);
  }

  if (!fields.length) {
    return json({
      success: false,
      error: "NO_FIELDS_TO_UPDATE"
    }, 400);
  }

  fields.push(
    "updated_by = ?",
    "updated_at = CURRENT_TIMESTAMP"
  );

  values.push(auth.user.id);
  values.push(id);

  await env.DB.prepare(`
    UPDATE session_materials
    SET ${fields.join(", ")}
    WHERE id = ?
  `).bind(...values).run();

  return json({
    success: true
  });
}

export async function onRequestDelete({
  request,
  env
}) {
  const auth =
    await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);

  const id =
    Number(url.searchParams.get("id") || 0);

  if (!Number.isInteger(id) || id < 1) {
    return json({
      success: false,
      error: "MATERIAL_ID_REQUIRED"
    }, 400);
  }

  const current =
    await env.DB.prepare(`
      SELECT session_id
      FROM session_materials
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

  if (!current) {
    return json({
      success: false,
      error: "MATERIAL_NOT_FOUND"
    }, 404);
  }

  const session =
    await getSession(
      env.DB,
      Number(current.session_id)
    );

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND"
    }, 404);
  }

  if (
    !await canManageMaterials(
      env.DB,
      auth.user,
      session
    )
  ) {
    return json({
      success: false,
      error: "MATERIALS_MANAGE_FORBIDDEN"
    }, 403);
  }

  await env.DB.prepare(`
    UPDATE session_materials
    SET
      status = 'archived',
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    auth.user.id,
    id
  ).run();

  return json({
    success: true
  });
}
