import {
  json,
  requireAuth,
  requirePermission,
  userHasAnyRole,
} from "./_auth.js";

const TOKEN_TTL_SECONDS = 15 * 60;

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function base64UrlEncode(value) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : new TextEncoder().encode(String(value));

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeJson(value) {
  return base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify(value)
    )
  );
}

async function signHs256(
  signingInput,
  secret
) {
  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signingInput)
    );

  return base64UrlEncode(
    new Uint8Array(signature)
  );
}

async function createLiveKitJwt({
  apiKey,
  apiSecret,
  identity,
  room,
  canPublish,
}) {
  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload = {
    iss: apiKey,
    sub: identity,
    iat: now,
    nbf: now - 1,
    exp: now + TOKEN_TTL_SECONDS,

    video: {
      room,
      roomJoin: true,
      canPublish: Boolean(canPublish),
      canSubscribe: true,
      canPublishData: false,
    },
  };

  const encodedHeader =
    base64UrlEncodeJson(header);

  const encodedPayload =
    base64UrlEncodeJson(payload);

  const signingInput =
    `${encodedHeader}.${encodedPayload}`;

  const signature =
    await signHs256(
      signingInput,
      apiSecret
    );

  return `${signingInput}.${signature}`;
}

async function getSession(
  db,
  sessionId
) {
  return db.prepare(`
    SELECT
      s.id,
      s.teacher_id,
      s.student_id,
      s.circle_id,
      s.session_type,
      s.status,
      c.status AS circle_status,
      c.type AS circle_type
    FROM sessions s
    LEFT JOIN circles c
      ON c.id = s.circle_id
    WHERE s.id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function isCircleMember(
  db,
  circleId,
  studentId
) {
  if (!circleId || !studentId) {
    return false;
  }

  const row = await db.prepare(`
    SELECT id
    FROM circle_enrollments
    WHERE circle_id = ?
      AND student_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(
    circleId,
    studentId
  ).first();

  return Boolean(row);
}

async function isRegisteredStudent(
  db,
  sessionId,
  studentId
) {
  if (!sessionId || !studentId) {
    return false;
  }

  const row = await db.prepare(`
    SELECT id
    FROM session_registrations
    WHERE session_id = ?
      AND student_id = ?
      AND status = 'registered'
    LIMIT 1
  `).bind(
    sessionId,
    studentId
  ).first();

  return Boolean(row);
}

async function canAccessSession(
  db,
  user,
  session
) {
  if (!user || !session) {
    return {
      allowed: false,
      status: 404,
      error: "SESSION_NOT_FOUND",
    };
  }

  if (
    userHasAnyRole(
      user,
      ["admin", "supervisor"]
    )
  ) {
    return {
      allowed: true,
      privileged: true,
    };
  }

  if (
    userHasAnyRole(
      user,
      ["teacher"]
    )
  ) {
    if (
      session.teacher_id &&
      user.teacher_id &&
      Number(session.teacher_id) ===
        Number(user.teacher_id)
    ) {
      return {
        allowed: true,
        privileged: true,
      };
    }

    return {
      allowed: false,
      status: 403,
      error: "SESSION_OUT_OF_SCOPE",
    };
  }

  if (
    userHasAnyRole(
      user,
      ["student"]
    )
  ) {
    if (!user.student_id) {
      return {
        allowed: false,
        status: 403,
        error: "STUDENT_PROFILE_REQUIRED",
      };
    }

    if (session.circle_id) {
      const member =
        await isCircleMember(
          db,
          session.circle_id,
          user.student_id
        );

      if (!member) {
        return {
          allowed: false,
          status: 403,
          error: "STUDENT_NOT_IN_CIRCLE",
        };
      }

      const registered =
        await isRegisteredStudent(
          db,
          session.id,
          user.student_id
        );

      if (!registered) {
        return {
          allowed: false,
          status: 403,
          error:
            "SESSION_REGISTRATION_REQUIRED",
        };
      }

      if (
        session.circle_status !==
        "active"
      ) {
        return {
          allowed: false,
          status: 409,
          error:
            "CIRCLE_IS_NOT_ACTIVE",
        };
      }

      return {
        allowed: true,
        privileged: false,
      };
    }

    return {
      allowed: false,
      status: 409,
      error: "GROUP_SESSION_REQUIRED",
    };
  }

  return {
    allowed: false,
    status: 403,
    error: "FORBIDDEN",
  };
}

async function getParticipantState(
  db,
  roomId,
  userId
) {
  if (!roomId || !userId) {
    return null;
  }

  return db.prepare(`
    SELECT
      id,
      participant_role,
      connection_status,
      media_role,
      mic_enabled,
      camera_enabled
    FROM live_room_participants
    WHERE room_id = ?
      AND user_id = ?
      AND connection_status != 'removed'
    ORDER BY id DESC
    LIMIT 1
  `).bind(
    roomId,
    userId
  ).first();
}

function canPublishMedia({
  user,
  session,
  participant,
}) {
  if (
    userHasAnyRole(
      user,
      ["admin", "supervisor"]
    )
  ) {
    return true;
  }

  if (
    userHasAnyRole(
      user,
      ["teacher"]
    ) &&
    session?.teacher_id &&
    user?.teacher_id &&
    Number(session.teacher_id) ===
      Number(user.teacher_id)
  ) {
    return true;
  }

  return (
    participant?.media_role ===
    "speaker"
  );
}

export async function onRequestPost({
  request,
  env,
}) {
  const auth =
    await requireAuth(
      request,
      env
    );

  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.user;

  if (userHasAnyRole(user, ["student"])) {
    const permission =
      await requirePermission(
        request,
        env,
        "live_room.join"
      );

    if (!permission.ok) {
      return permission.response;
    }
  }

  if (
    !env.LIVEKIT_API_KEY ||
    !env.LIVEKIT_API_SECRET ||
    !env.LIVEKIT_URL
  ) {
    return json(
      {
        success: false,
        error: "LIVEKIT_NOT_CONFIGURED",
      },
      503
    );
  }

  const body =
    await request.json()
      .catch(() => ({}));

  const sessionId =
    normalizeId(
      body.session_id
    );

  if (!sessionId) {
    return json(
      {
        success: false,
        error: "SESSION_ID_REQUIRED",
      },
      400
    );
  }

  const session =
    await getSession(
      env.DB,
      sessionId
    );

  if (!session) {
    return json(
      {
        success: false,
        error: "SESSION_NOT_FOUND",
      },
      404
    );
  }

  const access =
    await canAccessSession(
      env.DB,
      auth.user,
      session
    );

  if (!access.allowed) {
    return json(
      {
        success: false,
        error: access.error,
      },
      access.status
    );
  }

  const room =
    await env.DB.prepare(`
      SELECT
        id,
        session_id,
        room_key,
        status,
        media_provider,
        provider_room_id
      FROM live_rooms
      WHERE session_id = ?
      LIMIT 1
    `).bind(sessionId).first();

  if (!room) {
    return json(
      {
        success: false,
        error: "LIVE_ROOM_NOT_FOUND",
      },
      404
    );
  }

  if (
    room.status === "disabled" ||
    room.status === "closed" ||
    room.status === "ended"
  ) {
    return json(
      {
        success: false,
        error:
          "LIVE_ROOM_NOT_AVAILABLE",
      },
      409
    );
  }

  const participant =
    await getParticipantState(
      env.DB,
      room.id,
      auth.user.id
    );

  const canPublish =
    canPublishMedia({
      user: auth.user,
      session,
      participant,
    });

  const identity =
    `user-${Number(auth.user.id)}`;

  const roomName =
    String(
      room.provider_room_id ||
      room.room_key
    );

  const token =
    await createLiveKitJwt({
      apiKey:
        String(env.LIVEKIT_API_KEY),
      apiSecret:
        String(env.LIVEKIT_API_SECRET),
      identity,
      room: roomName,
      canPublish,
    });

  return json({
    success: true,
    server_url:
      String(env.LIVEKIT_URL),
    participant_token:
      token,
    room: roomName,
    permissions: {
      can_publish:
        canPublish,
      can_subscribe: true,
    },
    expires_in:
      TOKEN_TTL_SECONDS,
  });
}
