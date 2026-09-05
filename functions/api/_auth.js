// =========================================================
// الأوَّابين — Authentication & Authorization
// functions/api/_auth.js
// =========================================================

const SESSION_COOKIE = "alawabin_session";
const SESSION_DAYS = 7;

function error(code, status = 400) {
  return json({ success: false, error: code }, status);
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";

  for (const item of header.split(";")) {
    const parts = item.trim().split("=");
    const key = parts.shift();

    if (key === name) {
      return decodeURIComponent(parts.join("="));
    }
  }

  return null;
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers
      .get("X-Forwarded-For")
      ?.split(",")[0]
      ?.trim() ||
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
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getExpiryDate() {
  const date = new Date();

  date.setUTCDate(
    date.getUTCDate() + SESSION_DAYS
  );

  return date.toISOString();
}

function isExpired(value) {
  return (
    !value ||
    new Date(value).getTime() <= Date.now()
  );
}

function sessionCookie(token) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_DAYS * 86400}`,
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
  if (!env?.DB) {
    throw new Error("DB binding is missing.");
  }

  const token = getCookie(
    request,
    SESSION_COOKIE
  );

  if (!token) {
    return null;
  }

  const tokenHash = await sha256(token);

  const row = await env.DB
    .prepare(`
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
        u.status,
        st.id AS student_id,
        t.id AS teacher_id

      FROM auth_sessions s

      INNER JOIN users u
        ON u.id = s.user_id

      LEFT JOIN students st
        ON st.user_id = u.id

      LEFT JOIN teachers t
        ON t.user_id = u.id

      WHERE s.session_token_hash = ?

      LIMIT 1
    `)
    .bind(tokenHash)
    .first();

  if (!row) {
    return null;
  }

  if (
    row.revoked_at ||
    isExpired(row.expires_at) ||
    row.status !== "active"
  ) {
    return null;
  }

  await env.DB
    .prepare(`
      UPDATE auth_sessions
      SET last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(row.session_id)
    .run();

  return {
    id: row.id,
    role: row.role,
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    student_id: row.student_id ?? null,
    teacher_id: row.teacher_id ?? null,
    session_id: row.session_id,
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
          message:
            "يجب تسجيل الدخول أولًا.",
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

  const userPermission = await db
    .prepare(`
      SELECT enabled
      FROM user_permissions
      WHERE user_id = ?
        AND permission = ?
      LIMIT 1
    `)
    .bind(
      user.id,
      permission
    )
    .first();

  if (userPermission) {
    return Number(
      userPermission.enabled
    ) === 1;
  }

  const rolePermission = await db
    .prepare(`
      SELECT enabled
      FROM role_permissions
      WHERE role = ?
        AND permission = ?
      LIMIT 1
    `)
    .bind(
      user.role,
      permission
    )
    .first();

  return (
    !!rolePermission &&
    Number(
      rolePermission.enabled
    ) === 1
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

  const allowed =
    await hasPermission(
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

  const allowedRoles =
    Array.isArray(roles)
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
  if (!env?.DB) {
    throw new Error("DB binding is missing.");
  }

  const token = createToken();
  const tokenHash =
    await sha256(token);

  const expiresAt =
    getExpiryDate();

  await env.DB
    .prepare(`
      INSERT INTO auth_sessions (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      VALUES (?, ?, ?, ?, ?)
    `)
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
  if (!env?.DB) {
    throw new Error("DB binding is missing.");
  }

  const token = getCookie(
    request,
    SESSION_COOKIE
  );

  if (token) {
    const tokenHash =
      await sha256(token);

    await env.DB
      .prepare(`
        UPDATE auth_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE session_token_hash = ?
      `)
      .bind(tokenHash)
      .run();
  }

  return clearSessionCookie();
}

async function writeAudit(
  env,
  options = {}
) {
  if (!env?.DB || !options.action) {
    return;
  }

  const details =
    options.details ??
    options.metadata ??
    null;

  const detailsJson =
    details === null
      ? null
      : typeof details === "string"
        ? details
        : JSON.stringify(details);

  await env.DB
    .prepare(`
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        ip_address,
        user_agent,
        details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      options.userId ?? null,
      options.action,
      options.entityType ??
        options.entity ??
        null,
      options.entityId ?? null,
      options.request
        ? getClientIp(options.request)
        : null,
      options.request
        ? getUserAgent(options.request)
        : null,
      detailsJson
    )
    .run();
}

export {
  SESSION_COOKIE,
  json,
  error,
  getCookie,
  getCurrentUser,
  requireAuth,
  hasPermission,
  requirePermission,
  requireRole,
  createSession,
  destroySession,
  writeAudit,
};
