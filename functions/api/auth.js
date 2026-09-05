import {
  json,
  getCurrentUser,
  createSession,
  destroySession,
  writeAudit,
  requireAuth,
  attachRoleContext,
} from "./_auth.js";

import {
  hashPassword,
  verifyPassword,
} from "./_password.js";

async function handleLogin(request, env) {


  if (!env?.DB) {
    return json(
      {
        success: false,
        authenticated: false,
        error: "DB_MISSING",
        message: "قاعدة البيانات غير متاحة.",
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        authenticated: false,
        error: "INVALID_JSON",
        message: "بيانات الطلب غير صحيحة.",
      },
      400
    );
  }

  const identifier =
    typeof body?.identifier === "string"
      ? body.identifier.trim()
      : "";

  const password =
    typeof body?.password === "string"
      ? body.password
      : "";

  if (!identifier || !password) {
    return json(
      {
        success: false,
        authenticated: false,
        error: "MISSING_CREDENTIALS",
        message:
          "يرجى إدخال رقم الهاتف أو البريد الإلكتروني وكلمة المرور.",
      },
      400
    );
  }

  const user = await env.DB
    .prepare(`
      SELECT
        id,
        role,
        full_name,
        phone,
        email,
        password_hash,
        status
      FROM users
      WHERE
        LOWER(COALESCE(email, '')) = LOWER(?)
        OR phone = ?
      LIMIT 1
    `)
    .bind(identifier, identifier)
    .first();

  const passwordCheck =
    await verifyPassword(
      password,
      user?.password_hash
    );

  if (
    !user ||
    !passwordCheck.valid
  ) {
    return json(
      {
        success: false,
        authenticated: false,
        error: "INVALID_CREDENTIALS",
        message: "بيانات تسجيل الدخول غير صحيحة.",
      },
      401
    );
  }

  if (user.status !== "active") {
    return json(
      {
        success: false,
        authenticated: false,
        error: "ACCOUNT_NOT_ACTIVE",
        message: "هذا الحساب غير نشط حاليًا.",
      },
      403
    );
  }

  if (passwordCheck.needsUpgrade) {
    const upgradedHash =
      await hashPassword(password);

    await env.DB
      .prepare(`
        UPDATE users
        SET password_hash = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        upgradedHash,
        user.id
      )
      .run();

    await writeAudit(env, {
      userId: user.id,
      action: "password_hash_upgraded",
      entityType: "user",
      entityId: user.id,
      request,
    });
  }

  const roleAwareUser = await attachRoleContext(
    env.DB,
    user
  );

  const session = await createSession(
    request,
    env,
    user.id
  );

  await writeAudit(env, {
    userId: user.id,
    action: "login",
    entityType: "user",
    entityId: user.id,
    request,
  });

  return json(
    {
      success: true,
      authenticated: true,
      user: {
        id: roleAwareUser.id,
        role: roleAwareUser.role,
        roles:
          roleAwareUser.roles || [roleAwareUser.role],
        active_role:
          roleAwareUser.active_role ||
          roleAwareUser.role,
        full_name: roleAwareUser.full_name,
        phone: roleAwareUser.phone,
        email: roleAwareUser.email,
        status: roleAwareUser.status,
      },
    },
    200,
    {
      "Set-Cookie": session.cookie,
    }
  );
}

async function handleMe(request, env) {
  const user = await getCurrentUser(
    request,
    env
  );

  if (!user) {
    return json({
      success: true,
      authenticated: false,
      user: null,
    });
  }

  return json({
    success: true,
    authenticated: true,
    user,
  });
}

async function handleChangePassword(
  request,
  env
) {
  const auth =
    await requireAuth(
      request,
      env
    );

  if (!auth.ok) {
    return auth.response;
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        success: false,
        error: "INVALID_JSON",
        message:
          "بيانات الطلب غير صحيحة.",
      },
      400
    );
  }

  const currentPassword =
    typeof body?.current_password === "string"
      ? body.current_password
      : "";

  const newPassword =
    typeof body?.new_password === "string"
      ? body.new_password
      : "";

  if (
    !currentPassword ||
    !newPassword
  ) {
    return json(
      {
        success: false,
        error: "MISSING_CREDENTIALS",
        message:
          "يرجى إدخال كلمة المرور الحالية والجديدة.",
      },
      400
    );
  }

  if (newPassword.length < 8) {
    return json(
      {
        success: false,
        error: "PASSWORD_TOO_SHORT",
        message:
          "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.",
      },
      400
    );
  }

  const user =
    await env.DB
      .prepare(`
        SELECT id, password_hash, status
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(auth.user.id)
      .first();

  if (
    !user ||
    user.status !== "active"
  ) {
    return json(
      {
        success: false,
        error: "ACCOUNT_NOT_ACTIVE",
        message:
          "الحساب غير نشط.",
      },
      403
    );
  }

  const currentCheck =
    await verifyPassword(
      currentPassword,
      user.password_hash
    );

  if (!currentCheck.valid) {
    return json(
      {
        success: false,
        error: "INVALID_CURRENT_PASSWORD",
        message:
          "كلمة المرور الحالية غير صحيحة.",
      },
      401
    );
  }

  const passwordHash =
    await hashPassword(
      newPassword
    );

  await env.DB
    .prepare(`
      UPDATE users
      SET password_hash = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(
      passwordHash,
      auth.user.id
    )
    .run();

  await env.DB
    .prepare(`
      UPDATE auth_sessions
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND id <> ?
        AND revoked_at IS NULL
    `)
    .bind(
      auth.user.id,
      auth.user.session_id
    )
    .run();

  await writeAudit(env, {
    userId: auth.user.id,
    action: "password_changed",
    entityType: "user",
    entityId: auth.user.id,
    request,
  });

  return json({
    success: true,
    message:
      "تم تغيير كلمة المرور بنجاح.",
  });
}

async function handleLogout(request, env) {
  const user = await getCurrentUser(
    request,
    env
  );

  const cookie = await destroySession(
    request,
    env
  );

  if (user) {
    await writeAudit(env, {
      userId: user.id,
      action: "logout",
      entityType: "user",
      entityId: user.id,
      request,
    });
  }

  return json(
    {
      success: true,
      authenticated: false,
      user: null,
    },
    200,
    {
      "Set-Cookie": cookie,
    }
  );
}

export async function onRequest(context) {
  
  // Temporary production diagnostic — remove after authentication is fixed.
  if (
    new URL(request.url).searchParams.get("action") ===
    "production-check"
  ) {
    try {
      const row = await env.DB
        .prepare(`
          SELECT
            id,
            role,
            status,
            email,
            phone,
            password_hash
          FROM users
          WHERE
            LOWER(COALESCE(email, '')) = LOWER(?)
            OR phone = ?
          LIMIT 1
        `)
        .bind("admin@alawabin.app", "01000000000")
        .first();

      return json({
        success: true,
        diagnostic: "production-user-check",
        found: Boolean(row),
        id: row?.id ?? null,
        role: row?.role ?? null,
        status: row?.status ?? null,
        email_match: row?.email
          ? row.email.toLowerCase() === "admin@alawabin.app"
          : false,
        phone_match: row?.phone === "01000000000",
        hash_present: Boolean(row?.password_hash),
        hash_scheme:
          typeof row?.password_hash === "string"
            ? row.password_hash.split("$")[0]
            : null,
        hash_length:
          typeof row?.password_hash === "string"
            ? row.password_hash.length
            : 0
      });
    } catch (err) {
      return json({
        success: false,
        diagnostic: "production-user-check",
        error: "DIAGNOSTIC_DB_ERROR",
        message: err?.message || "unknown"
      }, 500);
    }
  }

  const {
    request,
    env,
  } = context;

  const url = new URL(request.url);

  const action =
    url.searchParams.get("action") || "me";

  if (action === "login") {
    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "METHOD_NOT_ALLOWED",
          message: "طريقة الطلب غير مسموحة.",
        },
        405,
        {
          Allow: "POST",
        }
      );
    }

    return handleLogin(
      request,
      env
    );
  }

  if (action === "me") {
    if (request.method !== "GET") {
      return json(
        {
          success: false,
          error: "METHOD_NOT_ALLOWED",
          message: "طريقة الطلب غير مسموحة.",
        },
        405,
        {
          Allow: "GET",
        }
      );
    }

    return handleMe(
      request,
      env
    );
  }

  if (
    action === "change-password"
  ) {
    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "METHOD_NOT_ALLOWED",
          message:
            "طريقة الطلب غير مسموحة.",
        },
        405,
        {
          Allow: "POST",
        }
      );
    }

    return handleChangePassword(
      request,
      env
    );
  }

  if (action === "logout") {
    if (request.method !== "POST") {
      return json(
        {
          success: false,
          error: "METHOD_NOT_ALLOWED",
          message: "طريقة الطلب غير مسموحة.",
        },
        405,
        {
          Allow: "POST",
        }
      );
    }

    return handleLogout(
      request,
      env
    );
  }

  return json(
    {
      success: false,
      error: "UNKNOWN_ACTION",
      message: "إجراء المصادقة غير معروف.",
    },
    400
  );
}
