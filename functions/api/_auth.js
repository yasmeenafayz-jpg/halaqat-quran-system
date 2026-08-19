// =========================================================
// functions/api/_auth.js
// الأوَّابين — Authentication & Authorization
// =========================================================

const SESSION_COOKIE = "alawabin_session";
const SESSION_DAYS = 7;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    null
  );
}

function getUserAgent(request) {
  return request.headers.get("User-Agent") || null;
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function addDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function isExpired(expiresAt) {
  return (
    !expiresAt ||
    new Date(expiresAt).getTime() <= Date.now()
  );
}

function sessionCookie(
  token,
  maxAge = SESSION_DAYS * 24 * 60 * 60
) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

async function getCurrentUser(request, env) {
  const db = env?.DB;

  if (!db) {
    throw new Error(
      "Database binding DB is not configured."
    );
  }

  const token = getCookie(
    request,
    SESSION_COOKIE
  );

  if (!token) {
    return null;
  }

  const tokenHash = await sha256(token);

  const result = await db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        s.revoked_at,

        u.id,
        u.role,
        u.full_name,
        u.phone,
        u.email,
        u.status

      FROM auth_sessions s

      INNER JOIN users u
        ON u.id = s.user_id

      WHERE s.session_token_hash = ?

      LIMIT 1
      `
    )
    .bind(tokenHash)
    .first();

  if (!result) {
    return null;
  }

  if (
    result.revoked_at ||
    isExpired(result.expires_at)
  ) {
    return null;
  }

  if (result.status !== "active") {
    return null;
  }

  await db
    .prepare(
      `
      UPDATE auth_sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    )
    .bind(result.session_id)
    .run();

  return {
    id: result.id,
    role: result.role,
    full_name: result.full_name,
    phone: result.phone,
    email: result.email,
    status: result.status,
    session_id: result.session_id,
  };
}

async function requireAuth(request, env) {
  const user = await getCurrentUser(
    request,
    env
  );

  if (!user) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "UNAUTHORIZED",
          message: "يجب تسجيل الدخول أولًا.",
        },
        401
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

async function getPermissionState(db, user) {
  const permissions = new Map();

  const roleRows = await db
    .prepare(
      `
      SELECT
        permission_key,
        allowed
      FROM role_permissions
      WHERE role = ?
      `
    )
    .bind(user.role)
    .all();

  for (const row of roleRows.results || []) {
    permissions.set(
      row.permission_key,
      Number(row.allowed) === 1
    );
  }

  const userRows = await db
    .prepare(
      `
      SELECT
        permission_key,
        allowed
      FROM user_permissions
      WHERE user_id = ?
      `
    )
    .bind(user.id)
    .all();

  for (const row of userRows.results || []) {
    permissions.set(
      row.permission_key,
      Number(row.allowed) === 1
    );
  }

  return permissions;
}

async function hasPermission(
  db,
  user,
  permission
) {
  if (!permission) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  const permissions =
    await getPermissionState(db, user);

  return (
    permissions.get(permission) === true
  );
}

async function requirePermission(
  request,
  env,
  permission
) {
  const auth = await requireAuth(
    request,
    env
  );

  if (!auth.ok) {
    return auth;
  }

  const allowed = await hasPermission(
    env.DB,
    auth.user,
    permission
  );

  if (!allowed) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "FORBIDDEN",
          message:
            "ليس لديك صلاحية لتنفيذ هذه العملية.",
        },
        403
      ),
    };
  }

  return {
    ok: true,
    user: auth.user,
  };
}

async function requireRole(
  request,
  env,
  roles
) {
  const auth = await requireAuth(
    request,
    env
  );

  if (!auth.ok) {
    return auth;
  }

  const allowedRoles = Array.isArray(roles)
    ? roles
    : [roles];

  if (
    !allowedRoles.includes(
      auth.user.role
    )
  ) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: "FORBIDDEN",
          message:
            "هذا الإجراء غير مسموح لدور المستخدم الحالي.",
        },
        403
      ),
    };
  }

  return {
    ok: true,
    user: auth.user,
  };
}

async function createSession(
  request,
  env,
  userId
) {
  const db = env?.DB;

  if (!db) {
    throw new Error(
      "Database binding DB is not configured."
    );
  }

  const token = createToken();
  const tokenHash =
    await sha256(token);

  const expiresAt =
    addDays(SESSION_DAYS);

  await db
    .prepare(
      `
      INSERT INTO auth_sessions (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      VALUES (?, ?, ?, ?, ?)
      `
    )
    .bind(
      userId,
      tokenHash,
      expiresAt,
      getClientIp(request),
      getUserAgent(request)
    )
    .run();

  return {
    token,
    expiresAt,
    cookie: sessionCookie(token),
  };
}

async function destroySession(
  request,
  env
) {
  const db = env?.DB;

  if (!db) {
    throw new Error(
      "Database binding DB is not configured."
    );
  }

  const token = getCookie(
    request,
    SESSION_COOKIE
  );

  if (token) {
    const tokenHash =
      await sha256(token);

    await db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE session_token_hash = ?
        `
      )
      .bind(tokenHash)
      .run();
  }

  return clearSessionCookie();
}

async function writeAudit(
  env,
  {
    userId = null,
    action,
    entity = null,
    entityId = null,
    metadata = null,
    request = null,
  }
) {
  if (!env?.DB || !action) {
    return;
  }

  const metadataJson =
    metadata === null ||
    metadata === undefined
      ? null
      : typeof metadata === "string"
        ? metadata
        : JSON.stringify(metadata);

  await env.DB
    .prepare(
      `
      INSERT INTO audit_logs (
        user_id,
        action,
        entity,
        entity_id,
        ip_address,
        user_agent,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      userId,
      action,
      entity,
      entityId,
      request
        ? getClientIp(request)
        : null,
      request
        ? getUserAgent(request)
        : null,
      metadataJson
    )
    .run();
}

export {
  SESSION_COOKIE,
  json,
  getCookie,
  getCurrentUser,
  requireAuth,
  requirePermission,
  requireRole,
  hasPermission,
  createSession,
  destroySession,
  writeAudit,
};
