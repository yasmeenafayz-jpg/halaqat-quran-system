import {
  requireAuth,
  requirePermission,
  hasPermission,
  userHasAnyRole,
  json,
  writeAudit,
} from "./_auth.js";

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function makeRoomKey(sessionId) {
  return `alawabin-session-${sessionId}`;
}

async function getSessionContext(db, sessionId) {
  return db.prepare(`
    SELECT
      s.id,
      s.circle_id,
      s.teacher_id,
      s.student_id,
      s.session_type,
      s.session_date,
      s.start_time,
      s.end_time,
      s.status,
      c.status AS circle_status,
      c.circle_type
    FROM sessions s
    LEFT JOIN circles c
      ON c.id = s.circle_id
    WHERE s.id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function getRoom(db, sessionId) {
  return db.prepare(`
    SELECT
      lr.*,
      s.circle_id,
      s.teacher_id,
      s.student_id,
      s.session_type,
      s.session_date,
      s.start_time,
      s.end_time,
      s.status AS session_status,
      c.status AS circle_status,
      c.circle_type
    FROM live_rooms lr
    INNER JOIN sessions s
      ON s.id = lr.session_id
    LEFT JOIN circles c
      ON c.id = s.circle_id
    WHERE lr.session_id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function isCircleMember(db, circleId, studentId) {
  if (!circleId || !studentId) return false;

  const row = await db.prepare(`
    SELECT id
    FROM circle_enrollments
    WHERE circle_id = ?
      AND student_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(circleId, studentId).first();

  return !!row;
}

async function canAccessSession(db, user, session) {
  if (!session || !user) {
    return {
      allowed: false,
      status: 404,
      error: "SESSION_NOT_FOUND",
    };
  }

  if (userHasAnyRole(user, ["admin", "supervisor"])) {
    return { allowed: true };
  }

  if (userHasAnyRole(user, ["teacher"])) {
    if (
      session.teacher_id &&
      Number(session.teacher_id) === Number(user.teacher_id)
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      status: 403,
      error: "SESSION_OUT_OF_SCOPE",
    };
  }

  if (userHasAnyRole(user, ["student"])) {
    if (!user.student_id) {
      return {
        allowed: false,
        status: 403,
        error: "STUDENT_PROFILE_REQUIRED",
      };
    }

    if (session.circle_id) {
      const member = await isCircleMember(
        db,
        session.circle_id,
        user.student_id
      );

      if (member) {
        return { allowed: true };
      }
    }

    if (
      session.student_id &&
      Number(session.student_id) === Number(user.student_id)
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      status: 403,
      error: "SESSION_OUT_OF_SCOPE",
    };
  }

  return {
    allowed: false,
    status: 403,
    error: "FORBIDDEN",
  };
}

async function ensureRoom(db, session, userId) {
  let room = await getRoom(db, session.id);

  if (room) {
    if (
      room.media_provider !== "livekit" ||
      !room.provider_room_id
    ) {
      await db.prepare(`
        UPDATE live_rooms
        SET
          media_provider = 'livekit',
          provider_room_id = room_key,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        userId,
        room.id
      ).run();

      room = await getRoom(db, session.id);
    }

    return room;
  }

  const roomKey = makeRoomKey(session.id);

  await db.prepare(`
    INSERT OR IGNORE INTO live_rooms
    (
      session_id,
      room_key,
      status,
      media_provider,
      provider_room_id,
      max_viewers,
      max_active_speakers,
      recording_enabled,
      created_by,
      updated_by
    )
    VALUES (?, ?, 'ready', 'livekit', ?, 1000, 8, 0, ?, ?)
  `).bind(
    session.id,
    roomKey,
    roomKey,
    userId,
    userId
  ).run();

  room = await getRoom(db, session.id);

  if (!room) {
    throw new Error("LIVE_ROOM_CREATE_FAILED");
  }

  return room;
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sessionId = normalizeId(
    url.searchParams.get("session_id")
  );

  if (!sessionId) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED",
    }, 400);
  }

  const session = await getSessionContext(
    env.DB,
    sessionId
  );

  const access = await canAccessSession(
    env.DB,
    auth.user,
    session
  );

  if (!access.allowed) {
    return json({
      success: false,
      error: access.error,
    }, access.status);
  }

  const room = await getRoom(
    env.DB,
    sessionId
  );

  const hostAccess = room
    ? await getRoomHostAccess(
        env.DB,
        room.id,
        auth.user.id
      )
    : null;

  return json({
    success: true,
    room: room || null,
    host_access: hostAccess
      ? {
          id: hostAccess.id,
          room_id: hostAccess.room_id,
          user_id: hostAccess.user_id,
          host_role: hostAccess.host_role,
          permissions: hostAccess.permissions,
          status: hostAccess.status,
          assigned_by: hostAccess.assigned_by,
          assigned_at: hostAccess.assigned_at,
        }
      : null,
    session: {
      id: session.id,
      circle_id: session.circle_id,
      teacher_id: session.teacher_id,
      session_type: session.session_type,
      session_date: session.session_date,
      start_time: session.start_time,
      end_time: session.end_time,
      status: session.status,
      circle_status: session.circle_status,
      circle_type: session.circle_type,
    },
  });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const sessionId = normalizeId(body.session_id);

  if (!sessionId) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED",
    }, 400);
  }

  /*
   * =========================================================
   * STUDENT JOIN
   * =========================================================
   */
  if (action === "join") {
    const auth = await requirePermission(
      request,
      env,
      "live_room.join"
    );

    if (!auth.ok) return auth.response;

    const user = auth.user;

    if (!userHasAnyRole(user, ["student"])) {
      return json({
        success: false,
        error: "STUDENT_ONLY",
      }, 403);
    }

    if (!user.student_id) {
      return json({
        success: false,
        error: "STUDENT_PROFILE_REQUIRED",
      }, 403);
    }

    const session = await getSessionContext(
      env.DB,
      sessionId
    );

    if (!session) {
      return json({
        success: false,
        error: "SESSION_NOT_FOUND",
      }, 404);
    }

    if (!session.circle_id || session.circle_type !== "group") {
      return json({
        success: false,
        error: "GROUP_SESSION_REQUIRED",
      }, 409);
    }

    if (session.circle_status !== "active") {
      return json({
        success: false,
        error: "CIRCLE_IS_NOT_ACTIVE",
      }, 409);
    }

    /*
     * الطالب لا يدخل الغرفة الجماعية إلا إذا كان:
     * 1) عضوًا نشطًا في الحلقة
     * 2) مسجلًا في جلسة اليوم
     */
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
        error: "STUDENT_NOT_IN_CIRCLE",
      }, 403);
    }

    const registration = await env.DB.prepare(`
      SELECT
        id,
        session_id,
        student_id,
        status,
        registered_at
      FROM session_registrations
      WHERE session_id = ?
        AND student_id = ?
        AND status = 'registered'
      LIMIT 1
    `).bind(
      sessionId,
      user.student_id
    ).first();

    if (!registration) {
      return json({
        success: false,
        error: "SESSION_REGISTRATION_REQUIRED",
      }, 403);
    }

    const room = await ensureRoom(
      env.DB,
      session,
      user.id
    );

    if (
      room.status === "closed" ||
      room.status === "ended" ||
      room.status === "disabled"
    ) {
      return json({
        success: false,
        error: "LIVE_ROOM_NOT_AVAILABLE",
      }, 409);
    }

    /*
     * منع وجود سجلين نشطين لنفس الطالب في نفس الغرفة.
     */
    let participant = await env.DB.prepare(`
      SELECT *
      FROM live_room_participants
      WHERE room_id = ?
        AND user_id = ?
        AND connection_status IN (
          'connecting',
          'connected',
          'reconnecting'
        )
      ORDER BY id DESC
      LIMIT 1
    `).bind(
      room.id,
      user.id
    ).first();

    if (!participant) {
      const inserted = await env.DB.prepare(`
        INSERT INTO live_room_participants
        (
          room_id,
          user_id,
          participant_role,
          connection_status,
          media_role,
          mic_enabled,
          camera_enabled
        )
        VALUES (?, ?, 'student', 'connecting', 'listener', 0, 0)
        RETURNING *
      `).bind(
        room.id,
        user.id
      ).first();

      participant = inserted;
    }

    await env.DB.prepare(`
      UPDATE live_room_participants
      SET
        connection_status = 'connected',
        last_seen_at = CURRENT_TIMESTAMP,
        left_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(participant.id).run();

    participant = await env.DB.prepare(`
      SELECT *
      FROM live_room_participants
      WHERE id = ?
      LIMIT 1
    `).bind(participant.id).first();

    await env.DB.prepare(`
      INSERT INTO live_room_events
      (
        room_id,
        session_id,
        actor_user_id,
        target_user_id,
        event_type,
        metadata_json
      )
      VALUES (?, ?, ?, ?, 'participant_joined', ?)
    `).bind(
      room.id,
      sessionId,
      user.id,
      user.id,
      JSON.stringify({
        participant_role: "student",
        media_role: "listener",
        registration_id: registration.id,
      })
    ).run();

    await writeAudit(env, {
      userId: user.id,
      action: "live_room.joined",
      entityType: "live_room",
      entityId: room.id,
      request,
      details: {
        session_id: sessionId,
        participant_id: participant.id,
        registration_id: registration.id,
      },
    });

    return json({
      success: true,
      room,
      participant,
      registration,
      permissions: {
        can_moderate: false,
        can_record: false,
        can_manage_participants: false,
        can_publish_audio: false,
        can_publish_video: false,
      },
    });
  }

  /*
   * =========================================================
   * CREATE / GET ROOM
   * للمعلمة والإدارة فقط في هذه المرحلة.
   * =========================================================
   */
  /*
   * =========================================================
   * HOST / CO-HOST MANAGEMENT
   * =========================================================
   */

  if (
    action === "assign_host" ||
    action === "assign_cohost" ||
    action === "update_cohost" ||
    action === "revoke_host" ||
    action === "revoke_cohost" ||
    action === "list_hosts"
  ) {
    /*
     * Host / Co-host management requires the live-room
     * write permission before any scoped delegation check.
     *
     * This auth object is intentionally local to this block.
     * Student join authentication above must not be reused
     * across action scopes.
     */
    const auth = await requirePermission(
      request,
      env,
      "live_room.write"
    );

    if (!auth.ok) {
      return auth.response;
    }

    const sessionId = normalizeId(body.session_id);
    const targetUserId = normalizeId(
      body.user_id || body.target_user_id
    );

    if (!sessionId) {
      return json({
        success: false,
        error: "SESSION_REQUIRED",
      }, 400);
    }

    const session = await getSessionContext(
      env.DB,
      sessionId
    );

    if (!session) {
      return json({
        success: false,
        error: "SESSION_NOT_FOUND",
      }, 404);
    }

    /*
     * Host / Co-host management must never create a room
     * before authorization is established.
     *
     * An existing room is sufficient for management.
     * If no room exists, management is denied.
     */
    const room = await getRoom(
      env.DB,
      session.id
    );

    if (!room) {
      return json({
        success: false,
        error: "LIVE_ROOM_NOT_CREATED",
      }, 404);
    }

    const canManage = await canManageHostDelegation(
      env.DB,
      auth.user,
      session,
      room.id
    );

    if (!canManage) {
      return json({
        success: false,
        error: "HOST_MANAGEMENT_FORBIDDEN",
      }, 403);
    }

    /*
     * -------------------------------------------------------
     * LIST HOSTS / CO-HOSTS
     * -------------------------------------------------------
     */
    if (action === "list_hosts") {
      const hosts = await listRoomHosts(
        env.DB,
        room.id
      );

      return json({
        success: true,
        room,
        hosts,
        allowed_cohost_permissions: COHOST_PERMISSIONS,
      });
    }

    if (!targetUserId) {
      return json({
        success: false,
        error: "TARGET_USER_REQUIRED",
      }, 400);
    }

    const targetUser = await getUserForHostAssignment(
      env.DB,
      targetUserId
    );

    if (!targetUser) {
      return json({
        success: false,
        error: "TARGET_USER_NOT_FOUND",
      }, 404);
    }

    if (targetUser.status !== "active") {
      return json({
        success: false,
        error: "TARGET_USER_NOT_ACTIVE",
      }, 409);
    }

    /*
     * Students and guardians must never receive Host /
     * Co-host access.
     *
     * Host / Co-host are staff-level live-session roles only.
     */
    if (
      targetUser.role !== "admin" &&
      targetUser.role !== "supervisor" &&
      targetUser.role !== "teacher"
    ) {
      return json({
        success: false,
        error: "STAFF_ONLY_HOST_ACCESS",
      }, 403);
    }

    /*
     * The Host of a session must be tied to the session
     * itself or be an administration account.
     *
     * A teacher from another session must not become the
     * Host accidentally. Co-host delegation remains available
     * to approved active staff members.
     */
    if (action === "assign_host") {
      const isAdministration =
        targetUser.role === "admin" ||
        targetUser.role === "supervisor";

      const isSessionTeacher =
        targetUser.role === "teacher" &&
        targetUser.teacher_id &&
        session.teacher_id &&
        Number(targetUser.teacher_id) === Number(session.teacher_id);

      if (!isAdministration && !isSessionTeacher) {
        return json({
          success: false,
          error: "HOST_MUST_BE_SESSION_TEACHER_OR_ADMIN",
        }, 403);
      }
    }

    /*
     * -------------------------------------------------------
     * REVOKE
     * -------------------------------------------------------
     */
    if (
      action === "revoke_host" ||
      action === "revoke_cohost"
    ) {
      const existing = await getRoomHostAccess(
        env.DB,
        room.id,
        targetUser.id
      );

      if (!existing) {
        return json({
          success: false,
          error: "HOST_ASSIGNMENT_NOT_FOUND",
        }, 404);
      }

      /*
       * revoke_cohost is strictly for Co-host assignments.
       * It must never revoke the active Host.
       */
      if (
        action === "revoke_cohost" &&
        existing.host_role !== "cohost"
      ) {
        return json({
          success: false,
          error: "TARGET_IS_HOST",
        }, 409);
      }

      /*
       * revoke_host is strictly for the Host assignment.
       */
      if (
        action === "revoke_host" &&
        existing.host_role !== "host"
      ) {
        return json({
          success: false,
          error: "TARGET_IS_COHOST",
        }, 409);
      }

      await env.DB.prepare(`
        UPDATE live_room_hosts
        SET
          status = 'revoked',
          revoked_by = ?,
          revoked_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'active'
      `).bind(
        auth.user.id,
        existing.id
      ).run();

      const revokeEvent =
        action === "revoke_cohost"
          ? "cohost_revoked"
          : "host_revoked";

      const revokeAuditAction =
        action === "revoke_cohost"
          ? "live_room.cohost_revoked"
          : "live_room.host_revoked";

      await writeHostEvent(
        env.DB,
        room,
        session,
        auth.user.id,
        targetUser.id,
        revokeEvent,
        {
          host_role: existing.host_role,
        }
      );

      await writeAudit(env, {
        userId: auth.user.id,
        action: revokeAuditAction,
        entityType: "live_room_host",
        entityId: existing.id,
        request,
        details: {
          session_id: session.id,
          room_id: room.id,
          target_user_id: targetUser.id,
          host_role: existing.host_role,
        },
      });

      return json({
        success: true,
        revoked: true,
        host_id: existing.id,
        hosts: await listRoomHosts(
          env.DB,
          room.id
        ),
      });
    }

    /*
     * -------------------------------------------------------
     * UPDATE CO-HOST PERMISSIONS
     * -------------------------------------------------------
     */
    if (action === "update_cohost") {
      const existing = await getRoomHostAccess(
        env.DB,
        room.id,
        targetUser.id
      );

      if (!existing) {
        return json({
          success: false,
          error: "COHOST_NOT_FOUND",
        }, 404);
      }

      if (existing.host_role !== "cohost") {
        return json({
          success: false,
          error: "TARGET_IS_HOST",
        }, 409);
      }

      const permissions = normalizeHostPermissions(
        body.permissions
      );

      await env.DB.prepare(`
        UPDATE live_room_hosts
        SET
          permissions_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND status = 'active'
      `).bind(
        JSON.stringify(permissions),
        existing.id
      ).run();

      await writeHostEvent(
        env.DB,
        room,
        session,
        auth.user.id,
        targetUser.id,
        "cohost_permissions_updated",
        {
          permissions,
        }
      );

      await writeAudit(env, {
        userId: auth.user.id,
        action: "live_room.cohost_permissions_updated",
        entityType: "live_room_host",
        entityId: existing.id,
        request,
        details: {
          session_id: session.id,
          room_id: room.id,
          target_user_id: targetUser.id,
          permissions,
        },
      });

      const updated = await getRoomHostAccess(
        env.DB,
        room.id,
        targetUser.id
      );

      return json({
        success: true,
        host: updated
          ? {
              ...updated,
              permissions,
            }
          : null,
      });
    }

    const hostRole =
      action === "assign_host"
        ? "host"
        : "cohost";

    /*
     * A user can have only one active Host/Co-host
     * assignment in the same room.
     */
    const existing = await getRoomHostAccess(
      env.DB,
      room.id,
      targetUser.id
    );

    if (existing) {
      return json({
        success: false,
        error: "USER_ALREADY_HOST_ASSIGNED",
        host: existing,
      }, 409);
    }

    /*
     * Only one active Host is allowed per room.
     */
    if (hostRole === "host") {
      const currentHost = await env.DB.prepare(`
        SELECT
          h.id,
          h.user_id,
          h.host_role,
          u.full_name
        FROM live_room_hosts h
        INNER JOIN users u
          ON u.id = h.user_id
        WHERE h.room_id = ?
          AND h.host_role = 'host'
          AND h.status = 'active'
        LIMIT 1
      `).bind(room.id).first();

      if (currentHost) {
        return json({
          success: false,
          error: "ACTIVE_HOST_ALREADY_EXISTS",
          host: currentHost,
        }, 409);
      }
    }

    const permissions =
      hostRole === "host"
        ? COHOST_PERMISSIONS
        : normalizeHostPermissions(
            body.permissions
          );

    /*
     * Recording remains an independent capability.
     * It is never granted through co-host permissions.
     */
    const safePermissions = permissions.filter(
      (permission) =>
        permission !== "recording_manage"
    );

    const inserted = await env.DB.prepare(`
      INSERT INTO live_room_hosts
      (
        room_id,
        user_id,
        host_role,
        permissions_json,
        status,
        assigned_by
      )
      VALUES (?, ?, ?, ?, 'active', ?)
      RETURNING id
    `).bind(
      room.id,
      targetUser.id,
      hostRole,
      JSON.stringify(safePermissions),
      auth.user.id
    ).first();

    if (!inserted?.id) {
      return json({
        success: false,
        error: "HOST_ASSIGNMENT_FAILED",
      }, 500);
    }

    await writeHostEvent(
      env.DB,
      room,
      session,
      auth.user.id,
      targetUser.id,
      hostRole === "host"
        ? "host_assigned"
        : "cohost_assigned",
      {
        host_role: hostRole,
        permissions: safePermissions,
      }
    );

    await writeAudit(env, {
      userId: auth.user.id,
      action:
        hostRole === "host"
          ? "live_room.host_assigned"
          : "live_room.cohost_assigned",
      entityType: "live_room_host",
      entityId: inserted.id,
      request,
      details: {
        session_id: session.id,
        room_id: room.id,
        target_user_id: targetUser.id,
        host_role: hostRole,
        permissions: safePermissions,
      },
    });

    const hosts = await listRoomHosts(
      env.DB,
      room.id
    );

    return json({
      success: true,
      host: hosts.find(
        (host) =>
          Number(host.id) === Number(inserted.id)
      ) || null,
      hosts,
    });
  }

  if (action === "create" || action === "get") {
    const auth = await requirePermission(
      request,
      env,
      "live_room.write"
    );

    if (!auth.ok) return auth.response;

    const session = await getSessionContext(
      env.DB,
      sessionId
    );

    const access = await canAccessSession(
      env.DB,
      auth.user,
      session
    );

    if (!access.allowed) {
      return json({
        success: false,
        error: access.error,
      }, access.status);
    }

    if (
      session.circle_id &&
      session.circle_type !== "group"
    ) {
      return json({
        success: false,
        error: "LIVE_ROOM_GROUP_SCOPE_MISMATCH",
      }, 409);
    }

    const room = await ensureRoom(
      env.DB,
      session,
      auth.user.id
    );

    await writeAudit(env, {
      userId: auth.user.id,
      action: "live_room.created_or_retrieved",
      entityType: "live_room",
      entityId: room.id,
      request,
      details: {
        session_id: session.id,
        room_key: room.room_key,
      },
    });

    return json({
      success: true,
      room,
    });
  }

  return json({
    success: false,
    error: "UNKNOWN_LIVE_ROOM_ACTION",
  }, 400);
}

/*
 * =========================================================
 * LIVE ROOM — PARTICIPANT MODERATION
 * =========================================================
 */

async function getParticipant(db, roomId, participantId) {
  return db.prepare(`
    SELECT
      p.*,
      u.full_name,
      u.role AS user_role
    FROM live_room_participants p
    INNER JOIN users u
      ON u.id = p.user_id
    WHERE p.id = ?
      AND p.room_id = ?
    LIMIT 1
  `).bind(
    participantId,
    roomId
  ).first();
}

const COHOST_PERMISSIONS = Object.freeze([
  "participant_moderate",
  "turn_manage",
  "room_manage",
  "registration_manage",
  "board_manage",
  "quran_manage",
  "materials_manage",
]);

function normalizeHostPermissions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((permission) => String(permission || "").trim())
        .filter((permission) =>
          COHOST_PERMISSIONS.includes(permission)
        )
    ),
  ];
}

async function getRoomHostAccess(db, roomId, userId) {
  const row = await db.prepare(`
    SELECT
      id,
      room_id,
      user_id,
      host_role,
      permissions_json,
      status,
      assigned_by,
      assigned_at,
      revoked_by,
      revoked_at
    FROM live_room_hosts
    WHERE room_id = ?
      AND user_id = ?
      AND status = 'active'
    LIMIT 1
  `).bind(
    roomId,
    userId
  ).first();

  if (!row) {
    return null;
  }

  let permissions = [];

  try {
    const parsed = JSON.parse(row.permissions_json || "[]");
    permissions = normalizeHostPermissions(parsed);
  } catch {
    permissions = [];
  }

  return {
    ...row,
    permissions,
  };
}

async function canModerateRoom(db, user, session, roomId, requiredPermission = "participant_moderate") {
  if (!user || !session || !roomId) {
    return false;
  }

  if (userHasAnyRole(user, ["admin", "supervisor"])) {
    return true;
  }

  if (
    userHasAnyRole(user, ["teacher"]) &&
    session.teacher_id &&
    Number(session.teacher_id) === Number(user.teacher_id)
  ) {
    return true;
  }

  const hostAccess = await getRoomHostAccess(
    db,
    roomId,
    user.id
  );

  if (!hostAccess) {
    return false;
  }

  if (hostAccess.host_role === "host") {
    return true;
  }

  return hostAccess.permissions.includes(requiredPermission);
}

async function listRoomHosts(db, roomId) {
  const result = await db.prepare(`
    SELECT
      h.id,
      h.room_id,
      h.user_id,
      h.host_role,
      h.permissions_json,
      h.status,
      h.assigned_by,
      h.assigned_at,
      h.revoked_by,
      h.revoked_at,
      u.full_name,
      u.role AS user_role
    FROM live_room_hosts h
    INNER JOIN users u
      ON u.id = h.user_id
    WHERE h.room_id = ?
    ORDER BY
      CASE h.host_role
        WHEN 'host' THEN 0
        ELSE 1
      END,
      h.assigned_at ASC,
      h.id ASC
  `).bind(roomId).all();

  return (result.results || []).map((row) => {
    let permissions = [];

    try {
      permissions = normalizeHostPermissions(
        JSON.parse(row.permissions_json || "[]")
      );
    } catch {
      permissions = [];
    }

    return {
      ...row,
      permissions,
    };
  });
}

async function getUserForHostAssignment(db, userId) {
  return db.prepare(`
    SELECT
      u.id,
      u.full_name,
      u.role,
      u.status,
      t.id AS teacher_id
    FROM users u
    LEFT JOIN teachers t
      ON t.user_id = u.id
    WHERE u.id = ?
    LIMIT 1
  `).bind(userId).first();
}

async function canManageHostDelegation(
  db,
  user,
  session,
  roomId
) {
  if (!user || !session || !roomId) {
    return false;
  }

  if (userHasAnyRole(user, ["admin", "supervisor"])) {
    return true;
  }

  if (
    userHasAnyRole(user, ["teacher"]) &&
    session.teacher_id &&
    Number(session.teacher_id) === Number(user.teacher_id)
  ) {
    return true;
  }

  const hostAccess = await getRoomHostAccess(
    db,
    roomId,
    user.id
  );

  if (!hostAccess) {
    return false;
  }

  if (hostAccess.host_role === "host") {
    return true;
  }

  /*
   * Co-host permissions such as room_manage control the
   * live room itself, but never delegate Host / Co-host.
   * Host delegation remains restricted to administration,
   * the assigned session teacher, or the current Host.
   */
  return false;
}

async function writeHostEvent(
  db,
  room,
  session,
  actorUserId,
  targetUserId,
  eventType,
  metadata = {}
) {
  await db.prepare(`
    INSERT INTO live_room_events
    (
      room_id,
      session_id,
      actor_user_id,
      target_user_id,
      event_type,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    room.id,
    session.id,
    actorUserId,
    targetUserId || null,
    eventType,
    JSON.stringify(metadata)
  ).run();
}

async function countActiveSpeakers(db, roomId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM live_room_participants
    WHERE room_id = ?
      AND connection_status IN (
        'connecting',
        'connected',
        'reconnecting'
      )
      AND media_role = 'speaker'
  `).bind(roomId).first();

  return Number(row?.count || 0);
}

async function updateParticipantMedia(
  db,
  room,
  session,
  actorUserId,
  participant,
  changes,
  eventType,
  metadata = {}
) {
  const fields = [];
  const values = [];

  if (Object.prototype.hasOwnProperty.call(changes, "media_role")) {
    fields.push("media_role = ?");
    values.push(changes.media_role);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "mic_enabled")) {
    fields.push("mic_enabled = ?");
    values.push(changes.mic_enabled ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "camera_enabled")) {
    fields.push("camera_enabled = ?");
    values.push(changes.camera_enabled ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(changes, "connection_status")) {
    fields.push("connection_status = ?");
    values.push(changes.connection_status);
  }

  if (!fields.length) {
    return participant;
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");

  values.push(participant.id);

  await db.prepare(`
    UPDATE live_room_participants
    SET ${fields.join(", ")}
    WHERE id = ?
  `).bind(...values).run();

  await db.prepare(`
    INSERT INTO live_room_events
    (
      room_id,
      session_id,
      actor_user_id,
      target_user_id,
      event_type,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    room.id,
    session.id,
    actorUserId,
    participant.user_id,
    eventType,
    JSON.stringify(metadata)
  ).run();

  return getParticipant(
    db,
    room.id,
    participant.id
  );
}

export async function onRequestPut({ request, env }) {
  /*
   * Moderation may be granted globally to authorized staff,
   * or session-scoped to an active Host / Co-host.
   *
   * Do not require the global live_room.moderate permission
   * before checking the scoped Host / Co-host permission.
   */
  const baseAuth = await requireAuth(request, env);

  if (!baseAuth.ok) {
    return baseAuth.response;
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();

  // التسجيل الصوتي ملغى نهائيًا في أكاديمية الأوَّابين.
  // يمنع الـBackend جميع عمليات التسجيل حتى عند الاستدعاء المباشر للـAPI.

  const sessionId = normalizeId(body.session_id);
  const participantId = normalizeId(body.participant_id);

  if (!sessionId || !participantId) {
    return json({
      success: false,
      error: "SESSION_AND_PARTICIPANT_REQUIRED",
    }, 400);
  }

  const globalModerate = await hasPermission(
    env.DB,
    baseAuth.user,
    "live_room.moderate"
  );

  const session = await getSessionContext(
    env.DB,
    sessionId
  );

  if (!session) {
    return json({
      success: false,
      error: "SESSION_NOT_FOUND",
    }, 404);
  }

  const room = await getRoom(
    env.DB,
    sessionId
  );

  if (!room) {
    return json({
      success: false,
      error: "LIVE_ROOM_NOT_FOUND",
    }, 404);
  }

  const scopedModerate = await canModerateRoom(
    env.DB,
    baseAuth.user,
    session,
    room.id,
    "participant_moderate"
  );

  if (!globalModerate && !scopedModerate) {
    return json({
      success: false,
      error: "SESSION_OUT_OF_SCOPE",
    }, 403);
  }

  const auth = {
    ...baseAuth,
    user: baseAuth.user,
  };

  const participant = await getParticipant(
    env.DB,
    room.id,
    participantId
  );

  if (!participant) {
    return json({
      success: false,
      error: "PARTICIPANT_NOT_FOUND",
    }, 404);
  }

  /*
   * ---------------------------------------------------------
   * GRANT SPEAKER
   * ---------------------------------------------------------
   */
  if (action === "grant_speaker") {
    if (participant.participant_role !== "student") {
      return json({
        success: false,
        error: "STUDENT_PARTICIPANT_REQUIRED",
      }, 409);
    }

    if (
      participant.connection_status === "removed" ||
      participant.connection_status === "disconnected"
    ) {
      return json({
        success: false,
        error: "PARTICIPANT_NOT_CONNECTED",
      }, 409);
    }

    if (participant.media_role === "speaker") {
      return json({
        success: true,
        participant,
        already_speaker: true,
      });
    }

    const activeSpeakers = await countActiveSpeakers(
      env.DB,
      room.id
    );

    if (
      activeSpeakers >= Number(room.max_active_speakers || 8)
    ) {
      return json({
        success: false,
        error: "ACTIVE_SPEAKER_LIMIT_REACHED",
        max_active_speakers: Number(
          room.max_active_speakers || 8
        ),
      }, 409);
    }

    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        media_role: "speaker",
      },
      "speaker_granted",
      {
        max_active_speakers: Number(
          room.max_active_speakers || 8
        ),
      }
    );

    await writeAudit(env, {
      userId: auth.user.id,
      action: "live_room.speaker_granted",
      entityType: "live_room_participant",
      entityId: participant.id,
      request,
      details: {
        session_id: session.id,
        room_id: room.id,
        target_user_id: participant.user_id,
      },
    });

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * REVOKE SPEAKER
   * ---------------------------------------------------------
   */
  if (action === "revoke_speaker") {
    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        media_role: "listener",
        mic_enabled: false,
        camera_enabled: false,
      },
      "speaker_revoked",
      {}
    );

    await writeAudit(env, {
      userId: auth.user.id,
      action: "live_room.speaker_revoked",
      entityType: "live_room_participant",
      entityId: participant.id,
      request,
      details: {
        session_id: session.id,
        room_id: room.id,
        target_user_id: participant.user_id,
      },
    });

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * MUTE MICROPHONE
   * ---------------------------------------------------------
   */
  if (action === "mute") {
    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        mic_enabled: false,
      },
      "mic_muted",
      {}
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * UNMUTE MICROPHONE
   * ---------------------------------------------------------
   */
  if (action === "unmute") {
    if (participant.media_role !== "speaker") {
      return json({
        success: false,
        error: "SPEAKER_REQUIRED",
      }, 409);
    }

    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        mic_enabled: true,
      },
      "mic_unmuted",
      {}
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * DISABLE CAMERA
   * ---------------------------------------------------------
   */
  if (action === "disable_camera") {
    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        camera_enabled: false,
      },
      "camera_disabled",
      {}
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * ENABLE CAMERA
   * ---------------------------------------------------------
   */
  if (action === "enable_camera") {
    if (participant.media_role !== "speaker") {
      return json({
        success: false,
        error: "SPEAKER_REQUIRED",
      }, 409);
    }

    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        camera_enabled: true,
      },
      "camera_enabled",
      {}
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * RECONNECT
   * ---------------------------------------------------------
   */
  if (action === "reconnect") {
    const updated = await updateParticipantMedia(
      env.DB,
      room,
      session,
      auth.user.id,
      participant,
      {
        connection_status: "connected",
      },
      "participant_reconnected",
      {}
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  /*
   * ---------------------------------------------------------
   * REMOVE PARTICIPANT
   * ---------------------------------------------------------
   */
  if (action === "remove") {
    await env.DB.prepare(`
      UPDATE live_room_participants
      SET
        connection_status = 'removed',
        media_role = 'listener',
        mic_enabled = 0,
        camera_enabled = 0,
        removed_by = ?,
        removed_at = CURRENT_TIMESTAMP,
        left_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      auth.user.id,
      participant.id
    ).run();

    await env.DB.prepare(`
      INSERT INTO live_room_events
      (
        room_id,
        session_id,
        actor_user_id,
        target_user_id,
        event_type,
        metadata_json
      )
      VALUES (?, ?, ?, ?, 'participant_removed', ?)
    `).bind(
      room.id,
      session.id,
      auth.user.id,
      participant.user_id,
      JSON.stringify({
        reason: body.reason || null,
      })
    ).run();

    await writeAudit(env, {
      userId: auth.user.id,
      action: "live_room.participant_removed",
      entityType: "live_room_participant",
      entityId: participant.id,
      request,
      details: {
        session_id: session.id,
        room_id: room.id,
        target_user_id: participant.user_id,
        reason: body.reason || null,
      },
    });

    const updated = await getParticipant(
      env.DB,
      room.id,
      participant.id
    );

    return json({
      success: true,
      participant: updated,
    });
  }

  return json({
    success: false,
    error: "UNKNOWN_MODERATION_ACTION",
  }, 400);
}

/*
 * =========================================================
 * LIVE ROOM — RECORDING CONTROL
 * =========================================================
 *
 * Recording is explicit.
 * Students cannot start or stop recordings.
 * Only admin/supervisor/assigned teacher can control recording.
 * Actual media-provider integration will be added separately.
 */
