import {
  json,
  requireAuth,
  hasPermission
} from "./_auth.js";

function getUrl(request) {
  return new URL(request.url);
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
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

async function canManageResources(
  db,
  user,
  sessionId = null
) {
  if (!user) return false;

  if (
    user.role === "admin" ||
    user.role === "supervisor"
  ) {
    return true;
  }

  if (
    sessionId &&
    await canCohostManageQuran(
      db,
      user,
      sessionId
    )
  ) {
    return true;
  }

  return await hasPermission(
    db,
    user,
    "quran.write"
  );
}

const RESOURCE_TYPES = new Set([
  "tafsir",
  "hadith",
  "mutashabihat",
  "asbab_al_nuzul",
  "tajweed",
  "tahajji",
  "noor_al_bayan",
  "gharib",
  "teacher_note"
]);

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = getUrl(request);

  const ayahId = Number(
    url.searchParams.get("ayah_id") || 0
  );

  const type = String(
    url.searchParams.get("resource_type") || ""
  ).trim();

  if (!ayahId) {
    return json({
      success: false,
      error: "AYAH_ID_REQUIRED"
    }, 400);
  }

  let sql = `
    SELECT
      id,
      ayah_id,
      resource_type,
      title,
      content,
      resource_data,
      created_by,
      updated_by,
      status,
      created_at,
      updated_at
    FROM quran_teacher_resources
    WHERE ayah_id = ?
      AND status = 'active'
  `;

  const params = [ayahId];

  if (type) {
    if (!RESOURCE_TYPES.has(type)) {
      return json({
        success: false,
        error: "INVALID_RESOURCE_TYPE"
      }, 400);
    }

    sql += ` AND resource_type = ?`;
    params.push(type);
  }

  sql += ` ORDER BY resource_type, id`;

  const result = await env.DB.prepare(sql)
    .bind(...params)
    .all();

  return json({
    success: true,
    resources: (result.results || []).map((row) => ({
      ...row,
      resource_data: parseJson(row.resource_data)
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

  const sessionId = Number(
    body.session_id || 0
  );

  if (
    !await canManageResources(
      env.DB,
      auth.user,
      sessionId
    )
  ) {
    return json({
      success: false,
      error: "QURAN_RESOURCE_ACCESS_DENIED"
    }, 403);
  }

  const ayahId = Number(body.ayah_id || 0);

  const resourceType = String(
    body.resource_type || ""
  ).trim();

  const title = String(
    body.title || ""
  ).trim();

  const content = String(
    body.content || ""
  ).trim();

  if (!ayahId || !resourceType) {
    return json({
      success: false,
      error: "INVALID_RESOURCE"
    }, 400);
  }

  if (!RESOURCE_TYPES.has(resourceType)) {
    return json({
      success: false,
      error: "INVALID_RESOURCE_TYPE"
    }, 400);
  }

  const resourceData =
    body.resource_data &&
    typeof body.resource_data === "object"
      ? body.resource_data
      : {};

  const result = await env.DB.prepare(`
    INSERT INTO quran_teacher_resources (
      ayah_id,
      resource_type,
      title,
      content,
      resource_data,
      created_by,
      updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ayahId,
    resourceType,
    title || null,
    content,
    JSON.stringify(resourceData),
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

  const sessionId = Number(
    url.searchParams.get("session_id") || 0
  );

  if (
    !await canManageResources(
      env.DB,
      auth.user,
      sessionId
    )
  ) {
    return json({
      success: false,
      error: "QURAN_RESOURCE_ACCESS_DENIED"
    }, 403);
  }

  const id = Number(
    url.searchParams.get("id") || 0
  );

  if (!id) {
    return json({
      success: false,
      error: "RESOURCE_ID_REQUIRED"
    }, 400);
  }

  const result = await env.DB.prepare(`
    UPDATE quran_teacher_resources
    SET
      status = 'archived',
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND status = 'active'
  `).bind(
    auth.user.id,
    id
  ).run();

  if (!result.meta?.changes) {
    return json({
      success: false,
      error: "RESOURCE_NOT_FOUND"
    }, 404);
  }

  return json({
    success: true
  });
}
