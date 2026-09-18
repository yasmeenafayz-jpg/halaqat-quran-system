import {
  json,
  requireAuth
} from "./_auth.js";

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function safeJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object"
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

async function getSession(db, sessionId) {
  return db.prepare(`
    SELECT
      s.id,
      s.teacher_id,
      s.circle_id,
      s.session_type,
      s.status
    FROM sessions s
    WHERE s.id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function getRoom(db, sessionId) {
  return db.prepare(`
    SELECT
      id,
      session_id,
      status
    FROM live_rooms
    WHERE session_id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function getBoard(db, sessionId) {
  return db.prepare(`
    SELECT
      b.id,
      b.room_id,
      b.session_id,
      b.state_json,
      b.status,
      b.version,
      b.updated_by,
      b.created_at,
      b.updated_at
    FROM live_room_boards b
    WHERE b.session_id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function getHostAccess(db, roomId, userId) {
  return db.prepare(`
    SELECT
      host_role,
      permissions_json
    FROM live_room_hosts
    WHERE room_id = ?
      AND user_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(roomId, userId).first();
}

async function canManageBoard(db, user, session, roomId) {
  if (!user || !session || !roomId) {
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
    session.teacher_id &&
    user.teacher_id &&
    Number(session.teacher_id) === Number(user.teacher_id)
  ) {
    return true;
  }

  const host = await getHostAccess(
    db,
    roomId,
    user.id
  );

  if (!host) {
    return false;
  }

  if (host.host_role === "host") {
    return true;
  }

  try {
    const permissions = JSON.parse(
      host.permissions_json || "[]"
    );

    return Array.isArray(permissions) &&
      permissions.includes("board_manage");
  } catch {
    return false;
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(request.url);
  const sessionId = normalizeId(
    url.searchParams.get("session_id")
  );

  if (!sessionId) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED"
    }, 400);
  }

  const session = await getSession(
    env.DB,
    sessionId
  );

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND"
    }, 404);
  }

  const room = await getRoom(
    env.DB,
    sessionId
  );

  if (!room) {
    return json({
      success: false,
      error: "LIVE_ROOM_NOT_FOUND"
    }, 404);
  }

  /*
   * Board reads are session-scoped.
   * A logged-in user alone is not enough.
   *
   * Allowed:
   * 1) Admin / Supervisor
   * 2) Assigned session teacher
   * 3) Active Host / Co-host with board_manage
   * 4) Student who is actively enrolled in the circle
   *    and registered for this group session
   */
  const user = auth.user;

  const isAdmin =
    user.role === "admin" ||
    user.role === "supervisor";

  const isSessionTeacher =
    user.role === "teacher" &&
    user.teacher_id &&
    session.teacher_id &&
    Number(user.teacher_id) === Number(session.teacher_id);

  let boardAccess = isAdmin || isSessionTeacher;

  if (!boardAccess && room?.id) {
    const host = await getHostAccess(
      env.DB,
      room.id,
      user.id
    );

    if (host) {
      if (host.host_role === "host") {
        boardAccess = true;
      } else {
        try {
          const permissions = JSON.parse(
            host.permissions_json || "[]"
          );

          boardAccess =
            Array.isArray(permissions) &&
            permissions.includes("board_manage");
        } catch {
          boardAccess = false;
        }
      }
    }
  }

  if (!boardAccess && user.role === "student") {
    if (!user.student_id) {
      return json({
        success: false,
        error: "BOARD_ACCESS_DENIED"
      }, 403);
    }

    if (
      session.circle_type !== "group" ||
      !session.circle_id
    ) {
      return json({
        success: false,
        error: "BOARD_GROUP_SESSION_REQUIRED"
      }, 403);
    }

    const membership = await env.DB.prepare(`
      SELECT id
      FROM circle_enrollments
      WHERE circle_id = ?
        AND student_id = ?
        AND status = 'active'
      LIMIT 1
    `).bind(
      session.circle_id,
      user.student_id
    ).first();

    if (!membership) {
      return json({
        success: false,
        error: "STUDENT_NOT_IN_CIRCLE"
      }, 403);
    }

    const registration = await env.DB.prepare(`
      SELECT id
      FROM session_registrations
      WHERE session_id = ?
        AND student_id = ?
        AND status IN (
          'registered',
          'called',
          'reciting',
          'completed'
        )
      LIMIT 1
    `).bind(
      sessionId,
      user.student_id
    ).first();

    if (!registration) {
      return json({
        success: false,
        error: "SESSION_REGISTRATION_REQUIRED"
      }, 403);
    }

    boardAccess = true;
  }

  if (!boardAccess) {
    return json({
      success: false,
      error: "BOARD_ACCESS_DENIED"
    }, 403);
  }

  const board = await getBoard(
    env.DB,
    sessionId
  );

  return json({
    success: true,
    board: board
      ? {
          ...board,
          state: safeJson(board.state_json)
        }
      : null
  });
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env);

  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => ({}));

  const sessionId = normalizeId(
    body.session_id
  );

  if (!sessionId) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED"
    }, 400);
  }

  const session = await getSession(
    env.DB,
    sessionId
  );

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND"
    }, 404);
  }

  const room = await getRoom(
    env.DB,
    sessionId
  );

  if (!room) {
    return json({
      success: false,
      error: "LIVE_ROOM_NOT_FOUND"
    }, 404);
  }

  const allowed = await canManageBoard(
    env.DB,
    auth.user,
    session,
    room.id
  );

  if (!allowed) {
    return json({
      success: false,
      error: "BOARD_PERMISSION_DENIED"
    }, 403);
  }

  const action = String(
    body.action || "update"
  ).trim();

  const current = await getBoard(
    env.DB,
    sessionId
  );

  if (action === "clear") {
    if (!current) {
      return json({
        success: true,
        board: null
      });
    }

    const nextVersion =
      Number(current.version || 0) + 1;

    await env.DB.prepare(`
      UPDATE live_room_boards
      SET
        state_json = '{}',
        status = 'cleared',
        version = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      nextVersion,
      auth.user.id,
      current.id
    ).run();

  } else if (action === "lock") {
    if (!current) {
      return json({
        success: false,
        error: "BOARD_NOT_INITIALIZED"
      }, 409);
    }

    await env.DB.prepare(`
      UPDATE live_room_boards
      SET
        status = 'locked',
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      auth.user.id,
      current.id
    ).run();

  } else if (action === "unlock") {
    if (!current) {
      return json({
        success: false,
        error: "BOARD_NOT_INITIALIZED"
      }, 409);
    }

    await env.DB.prepare(`
      UPDATE live_room_boards
      SET
        status = 'active',
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      auth.user.id,
      current.id
    ).run();

  } else {
    const state =
      body.state &&
      typeof body.state === "object"
        ? body.state
        : {};

    const stateJson =
      JSON.stringify(state);

    if (!current) {
      await env.DB.prepare(`
        INSERT INTO live_room_boards (
          room_id,
          session_id,
          state_json,
          status,
          version,
          updated_by
        )
        VALUES (?, ?, ?, 'active', 1, ?)
      `).bind(
        room.id,
        sessionId,
        stateJson,
        auth.user.id
      ).run();
    } else {
      const nextVersion =
        Number(current.version || 0) + 1;

      await env.DB.prepare(`
        UPDATE live_room_boards
        SET
          state_json = ?,
          status = 'active',
          version = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        stateJson,
        nextVersion,
        auth.user.id,
        current.id
      ).run();
    }
  }

  const board = await getBoard(
    env.DB,
    sessionId
  );

  return json({
    success: true,
    board: board
      ? {
          ...board,
          state: safeJson(board.state_json)
        }
      : null
  });
}
