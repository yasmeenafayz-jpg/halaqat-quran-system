// =========================================================
// الأوَّابين — Authentication API
// functions/api/auth.js
// =========================================================

import {
  json,
  getCookie,
  getCurrentUser,
  createSession,
  destroySession,
  writeAudit,
} from "./_auth.js";

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function normalize(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function errorResponse(
  message,
  status = 400
) {
  return json(
    {
      success: false,
      error: "AUTH_ERROR",
      message,
    },
    status
  );
}

async function login(request, env) {
  if (!env?.DB) {
    return errorResponse(
      "قاعدة البيانات غير متصلة.",
      500
    );
  }

  const body = await readBody(request);

  if (!body) {
    return errorResponse(
      "بيانات الطلب غير صحيحة."
    );
  }

  const identifier = normalize(
    body.identifier ||
    body.phone ||
    body.email
  );

  const password = normalize(
    body.password
  );

  if (!identifier || !password) {
    return errorResponse(
      "أدخل رقم الهاتف أو البريد الإلكتروني وكلمة المرور."
    );
  }

  /*
   * كلمة المرور هنا يتم تحويلها إلى SHA-256
   * لمطابقة password_hash المخزن في قاعدة البيانات.
   */
  const data =
    new TextEncoder().encode(password);

  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );

  const passwordHash =
    Array.from(
      new Uint8Array(hashBuffer)
    )
      .map((byte) =>
        byte.toString(16).padStart(2, "0")
      )
      .join("");

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
      WHERE phone = ?
         OR email = ?
      LIMIT 1
    `)
    .bind(
      identifier,
      identifier
    )
    .first();

  if (!user) {
    await writeAudit(env, {
      action: "login_failed",
      entity: "user",
      metadata: {
        reason: "user_not_found",
        identifier,
      },
      request,
    });

    return errorResponse(
      "بيانات تسجيل الدخول غير صحيحة.",
      401
    );
  }

  if (user.status !== "active") {
    await writeAudit(env, {
      userId: user.id,
      action: "login_blocked",
      entity: "user",
      entityId: user.id,
      metadata: {
        reason: "inactive_user",
      },
      request,
    });

    return errorResponse(
      "هذا الحساب غير نشط.",
      403
    );
  }

  if (
    !user.password_hash ||
    user.password_hash !== passwordHash
  ) {
    await writeAudit(env, {
      userId: user.id,
      action: "login_failed",
      entity: "user",
      entityId: user.id,
      metadata: {
        reason: "invalid_password",
      },
      request,
    });

    return errorResponse(
      "بيانات تسجيل الدخول غير صحيحة.",
      401
    );
  }

  const session = await createSession(
    request,
    env,
    user.id
  );

  await writeAudit(env, {
    userId: user.id,
    action: "login_success",
    entity: "user",
    entityId: user.id,
    request,
  });

  return new Response(
    JSON.stringify({
      success: true,
      message: "تم تسجيل الدخول بنجاح.",
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        phone: user.phone,
        email: user.email,
        status: user.status,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": session.cookie,
      },
    }
  );
}

async function logout(request, env) {
  const user =
    await getCurrentUser(
      request,
      env
    );

  const cookie =
    await destroySession(
      request,
      env
    );

  if (user) {
    await writeAudit(env, {
      userId: user.id,
      action: "logout",
      entity: "user",
      entityId: user.id,
      request,
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: "تم تسجيل الخروج.",
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": cookie,
      },
    }
  );
}

async function me(request, env) {
  const user =
    await getCurrentUser(
      request,
      env
    );

  if (!user) {
    return json(
      {
        success: false,
        authenticated: false,
        user: null,
      },
      401
    );
  }

  return json({
    success: true,
    authenticated: true,
    user,
  });
}

export async function onRequest(
  context
) {
  const {
    request,
    env,
  } = context;

  const url =
    new URL(request.url);

  const action =
    url.searchParams.get(
      "action"
    ) || "me";

  try {
    if (
      request.method === "POST" &&
      action === "login"
    ) {
      return await login(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      action === "logout"
    ) {
      return await logout(
        request,
        env
      );
    }

    if (
      request.method === "GET" &&
      action === "me"
    ) {
      return await me(
        request,
        env
      );
    }

    return errorResponse(
      "طلب غير مدعوم.",
      405
    );
  } catch (error) {
    console.error(
      "AUTH API ERROR:",
      error
    );

    return json(
      {
        success: false,
        error: "INTERNAL_ERROR",
        message:
          "حدث خطأ داخلي أثناء معالجة الطلب.",
      },
      500
    );
  }
}
