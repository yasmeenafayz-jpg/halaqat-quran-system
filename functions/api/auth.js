import {
  json,
  getCurrentUser,
  createSession,
  destroySession,
  writeAudit,
} from "./_auth.js";

async function sha256(value) {
  const data = new TextEncoder().encode(value);

  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

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

  const passwordHash = await sha256(password);

  if (
    !user ||
    !user.password_hash ||
    user.password_hash !== passwordHash
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
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        status: user.status,
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
