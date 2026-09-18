import { requireAuth, requirePermission, hasPermission, json } from "./_auth.js";

function nowIso() {
  return new Date().toISOString();
}

function isOpen(window) {
  if (!window || window.status === "cancelled") return false;

  const now = Date.now();
  const opens = new Date(window.opens_at).getTime();
  const closes = new Date(window.closes_at).getTime();

  return Number.isFinite(opens) &&
    Number.isFinite(closes) &&
    now >= opens &&
    now < closes;
}

async function getWindow(db, sessionId) {
  return db.prepare(`
    SELECT
      srw.*,
      s.session_date,
      s.start_time,
      s.end_time,
      s.status AS session_status
    FROM session_registration_windows srw
    INNER JOIN sessions s ON s.id = srw.session_id
    WHERE srw.session_id = ?
    LIMIT 1
  `).bind(sessionId).first();
}

async function syncWindowStatus(db, window) {
  if (!window || window.status === "cancelled") return window;

  const now = Date.now();
  const opens = new Date(window.opens_at).getTime();
  const closes = new Date(window.closes_at).getTime();

  let status = "scheduled";

  if (now >= closes) {
    status = "closed";
  } else if (now >= opens) {
    status = "open";
  }

  if (status !== window.status) {
    await db.prepare(`
      UPDATE session_registration_windows
      SET status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status, window.id).run();

    window.status = status;
  }

  return window;
}

async function canCohostManageTurn(db, user, sessionId) {
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
      permissions.includes("turn_manage");
  } catch {
    return false;
  }
}

async function canCohostManageRegistration(db, user, sessionId) {
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
      permissions.includes("registration_manage");
  } catch {
    return false;
  }
}

async function createTurnsForRegistered(db, sessionId) {
  const rows = await db.prepare(`
    SELECT sr.id, sr.student_id
    FROM session_registrations sr
    LEFT JOIN session_turns st
      ON st.registration_id = sr.id
    WHERE sr.session_id = ?
      AND sr.status = 'registered'
      AND st.id IS NULL
    ORDER BY sr.registered_at ASC, sr.id ASC
  `).bind(sessionId).all();

  if (!rows.results || !rows.results.length) return;

  const maxRow = await db.prepare(`
    SELECT COALESCE(MAX(turn_number), 0) AS max_turn
    FROM session_turns
    WHERE session_id = ?
  `).bind(sessionId).first();

  let next = Number(maxRow?.max_turn || 0) + 1;

  for (const row of rows.results) {
    await db.prepare(`
      INSERT OR IGNORE INTO session_turns
      (
        session_id,
        registration_id,
        student_id,
        turn_number,
        status
      )
      VALUES (?, ?, ?, ?, 'waiting')
    `).bind(
      sessionId,
      row.id,
      row.student_id,
      next
    ).run();

    next++;
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return json({
      success: false,
      error: "SESSION_ID_REQUIRED"
    }, 400);
  }

  let window = await getWindow(env.DB, sessionId);
  window = await syncWindowStatus(env.DB, window);

  if (!window) {
    return json({
      success: false,
      error: "REGISTRATION_WINDOW_NOT_FOUND"
    }, 404);
  }

  let registrationSql = `
    SELECT
      sr.*,
      st.full_name AS student_name
    FROM session_registrations sr
    LEFT JOIN students st ON st.id = sr.student_id
    WHERE sr.session_id = ?
  `;

  const registrationParams = [sessionId];

  if (u.role === "student") {
    registrationSql += ` AND sr.student_id = ?`;
    registrationParams.push(u.student_id);
  }

  registrationSql += `
    ORDER BY sr.registered_at ASC, sr.id ASC
  `;

  const registrations = await env.DB
    .prepare(registrationSql)
    .bind(...registrationParams)
    .all();

  let turns;

  if (u.role === "student") {
    turns = await env.DB.prepare(`
      SELECT
        stn.*,
        st.full_name AS student_name
      FROM session_turns stn
      LEFT JOIN students st ON st.id = stn.student_id
      WHERE stn.session_id = ?
        AND stn.student_id = ?
      ORDER BY stn.turn_number ASC
    `).bind(sessionId, u.student_id).all();
  } else {
    turns = await env.DB.prepare(`
      SELECT
        stn.*,
        st.full_name AS student_name
      FROM session_turns stn
      LEFT JOIN students st ON st.id = stn.student_id
      WHERE stn.session_id = ?
      ORDER BY stn.turn_number ASC
    `).bind(sessionId).all();
  }

  return json({
    success: true,
    window,
    registration_open: isOpen(window),
    registrations: registrations.results || [],
    turns: turns.results || []
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const u = auth.user;
  const b = await request.json().catch(() => ({}));

  if (b.action === "register") {
    if (u.role !== "student") {
      return json({
        success: false,
        error: "FORBIDDEN"
      }, 403);
    }

    if (!u.student_id || !b.session_id) {
      return json({
        success: false,
        error: "SESSION_ID_REQUIRED"
      }, 400);
    }

    const session = await env.DB.prepare(`
      SELECT
        s.id,
        s.circle_id,
        s.session_type,
        s.session_date,
        s.start_time,
        s.end_time,
        s.status,
        c.status AS circle_status,
        c.circle_type
      FROM sessions s
      LEFT JOIN circles c ON c.id = s.circle_id
      WHERE s.id=?
      LIMIT 1
    `).bind(b.session_id).first();

    if (!session) {
      return json({
        success: false,
        error: "SESSION_NOT_FOUND"
      }, 404);
    }

    if (!session.circle_id || session.circle_type !== "group") {
      return json({
        success: false,
        error: "GROUP_SESSION_REQUIRED"
      }, 409);
    }

    if (session.circle_status !== "active") {
      return json({
        success: false,
        error: "CIRCLE_IS_NOT_ACTIVE"
      }, 409);
    }

    const membership = await env.DB.prepare(`
      SELECT id
      FROM circle_enrollments
      WHERE circle_id=?
        AND student_id=?
        AND status='active'
      LIMIT 1
    `).bind(
      session.circle_id,
      u.student_id
    ).first();

    if (!membership) {
      return json({
        success: false,
        error: "STUDENT_NOT_IN_CIRCLE"
      }, 403);
    }

    let window = await getWindow(env.DB, b.session_id);
    window = await syncWindowStatus(env.DB, window);

    if (!window) {
      return json({
        success: false,
        error: "REGISTRATION_WINDOW_NOT_FOUND"
      }, 404);
    }

    if (!isOpen(window) || window.status !== "open") {
      return json({
        success: false,
        error: "REGISTRATION_CLOSED"
      }, 409);
    }

    if (window.max_registrations) {
      const count = await env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM session_registrations
        WHERE session_id = ?
          AND status = 'registered'
      `).bind(b.session_id).first();

      if (Number(count?.count || 0) >= Number(window.max_registrations)) {
        return json({
          success: false,
          error: "REGISTRATION_FULL"
        }, 409);
      }
    }

    const existing = await env.DB.prepare(`
      SELECT *
      FROM session_registrations
      WHERE session_id = ?
        AND student_id = ?
      LIMIT 1
    `).bind(b.session_id, u.student_id).first();

    if (existing && existing.status === "registered") {
      return json({
        success: true,
        registration: existing,
        already_registered: true
      });
    }

    let registration;

    if (existing) {
      await env.DB.prepare(`
        UPDATE session_registrations
        SET
          status = 'registered',
          registered_at = CURRENT_TIMESTAMP,
          cancelled_at = NULL,
          cancelled_by = NULL,
          note = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        b.note || null,
        existing.id
      ).run();

      registration = await env.DB.prepare(`
        SELECT *
        FROM session_registrations
        WHERE id = ?
      `).bind(existing.id).first();
    } else {
      registration = await env.DB.prepare(`
        INSERT INTO session_registrations
        (
          session_id,
          student_id,
          registration_source,
          note
        )
        VALUES (?, ?, 'student', ?)
        RETURNING *
      `).bind(
        b.session_id,
        u.student_id,
        b.note || null
      ).first();
    }

    await createTurnsForRegistered(env.DB, b.session_id);

    return json({
      success: true,
      registration
    }, existing ? 200 : 201);
  }

  if (b.action === "cancel_registration") {
    if (u.role !== "student" || !u.student_id) {
      return json({
        success: false,
        error: "FORBIDDEN"
      }, 403);
    }

    const registration = await env.DB.prepare(`
      SELECT *
      FROM session_registrations
      WHERE id = ?
        AND student_id = ?
      LIMIT 1
    `).bind(
      b.registration_id,
      u.student_id
    ).first();

    if (!registration) {
      return json({
        success: false,
        error: "REGISTRATION_NOT_FOUND"
      }, 404);
    }

    let window = await getWindow(
      env.DB,
      registration.session_id
    );

    window = await syncWindowStatus(env.DB, window);

    if (!window || !isOpen(window)) {
      return json({
        success: false,
        error: "REGISTRATION_CLOSED"
      }, 409);
    }

    await env.DB.prepare(`
      UPDATE session_registrations
      SET
        status = 'cancelled',
        cancelled_at = ?,
        cancelled_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      nowIso(),
      u.id,
      registration.id
    ).run();

    await env.DB.prepare(`
      UPDATE session_turns
      SET
        status = 'cancelled',
        updated_at = CURRENT_TIMESTAMP
      WHERE registration_id = ?
        AND status = 'waiting'
    `).bind(registration.id).run();

    return json({ success: true });
  }

  if (
    b.action === "create_window" ||
    b.action === "open_window" ||
    b.action === "close_window" ||
    b.action === "cancel_window"
  ) {
    /*
     * Registration window management may be granted either
     * through the normal academy permission system or as a
     * session-scoped Co-host permission.
     */
    const baseAuth = await requireAuth(request, env);

    if (!baseAuth.ok) {
      return baseAuth.response;
    }

    const globalRegistrationPermission = await hasPermission(
      env.DB,
      baseAuth.user,
      "session.lifecycle.write"
    );

    let scopedRegistrationPermission = false;

    /*
     * create_window already carries session_id.
     * open/close/cancel carry window_id, so their
     * session scope is resolved below before denial.
     */
    if (
      !globalRegistrationPermission &&
      b.session_id
    ) {
      scopedRegistrationPermission =
        await canCohostManageRegistration(
          env.DB,
          baseAuth.user,
          b.session_id
        );
    }

    if (b.action === "create_window") {
      if (
        !globalRegistrationPermission &&
        !scopedRegistrationPermission
      ) {
        return json({
          success: false,
          error: "REGISTRATION_PERMISSION_DENIED"
        }, 403);
      }
      if (!b.session_id || !b.opens_at || !b.closes_at) {
        return json({
          success: false,
          error: "WINDOW_FIELDS_REQUIRED"
        }, 400);
      }

      const opens = new Date(b.opens_at).getTime();
      const closes = new Date(b.closes_at).getTime();

      if (!Number.isFinite(opens) ||
          !Number.isFinite(closes) ||
          closes <= opens) {
        return json({
          success: false,
          error: "INVALID_WINDOW"
        }, 400);
      }

      const session = await env.DB.prepare(`
        SELECT
          s.id,
          s.circle_id,
          s.session_type,
          c.teacher_id,
          c.status AS circle_status,
          c.circle_type
        FROM sessions s
        LEFT JOIN circles c ON c.id = s.circle_id
        WHERE s.id=?
        LIMIT 1
      `).bind(b.session_id).first();

      if (!session) {
        return json({
          success: false,
          error: "SESSION_NOT_FOUND"
        }, 404);
      }

      if (!session.circle_id || session.circle_type !== "group") {
        return json({
          success: false,
          error: "GROUP_SESSION_REQUIRED"
        }, 409);
      }

      if (session.circle_status !== "active") {
        return json({
          success: false,
          error: "CIRCLE_IS_NOT_ACTIVE"
        }, 409);
      }

      if (
        u.role === "teacher" &&
        (
          !u.teacher_id ||
          Number(session.teacher_id) !== Number(u.teacher_id)
        )
      ) {
        return json({
          success: false,
          error: "CIRCLE_ACCESS_DENIED"
        }, 403);
      }

      const existing = await getWindow(
        env.DB,
        b.session_id
      );

      if (existing) {
        return json({
          success: false,
          error: "WINDOW_ALREADY_EXISTS"
        }, 409);
      }

      const window = await env.DB.prepare(`
        INSERT INTO session_registration_windows
        (
          session_id,
          opens_at,
          closes_at,
          status,
          max_registrations,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
        RETURNING *
      `).bind(
        b.session_id,
        b.opens_at,
        b.closes_at,
        b.max_registrations || null,
        u.id,
        u.id
      ).first();

      return json({
        success: true,
        window
      }, 201);
    }

    if (!b.window_id) {
      return json({
        success: false,
        error: "WINDOW_ID_REQUIRED"
      }, 400);
    }

    if (!globalRegistrationPermission) {
      const scopedWindow = await env.DB.prepare(`
        SELECT session_id
        FROM session_registration_windows
        WHERE id = ?
        LIMIT 1
      `).bind(b.window_id).first();

      if (
        scopedWindow &&
        await canCohostManageRegistration(
          env.DB,
          baseAuth.user,
          scopedWindow.session_id
        )
      ) {
        scopedRegistrationPermission = true;
      }
    }

    if (
      !globalRegistrationPermission &&
      !scopedRegistrationPermission
    ) {
      return json({
        success: false,
        error: "REGISTRATION_PERMISSION_DENIED"
      }, 403);
    }

    const windowRecord = await env.DB.prepare(`
      SELECT
        w.id,
        w.session_id,
        s.circle_id,
        c.teacher_id,
        c.status AS circle_status,
        c.circle_type
      FROM session_registration_windows w
      INNER JOIN sessions s ON s.id=w.session_id
      LEFT JOIN circles c ON c.id=s.circle_id
      WHERE w.id=?
      LIMIT 1
    `).bind(b.window_id).first();

    if (!windowRecord) {
      return json({
        success: false,
        error: "WINDOW_NOT_FOUND"
      }, 404);
    }

    if (!windowRecord.circle_id || windowRecord.circle_type !== "group") {
      return json({
        success: false,
        error: "GROUP_SESSION_REQUIRED"
      }, 409);
    }

    if (windowRecord.circle_status !== "active") {
      return json({
        success: false,
        error: "CIRCLE_IS_NOT_ACTIVE"
      }, 409);
    }

    if (
      u.role === "teacher" &&
      (
        !u.teacher_id ||
        Number(windowRecord.teacher_id) !== Number(u.teacher_id)
      )
    ) {
      return json({
        success: false,
        error: "CIRCLE_ACCESS_DENIED"
      }, 403);
    }

    const statusMap = {
      open_window: "open",
      close_window: "closed",
      cancel_window: "cancelled"
    };

    const status = statusMap[b.action];

    const result = await env.DB.prepare(`
      UPDATE session_registration_windows
      SET
        status = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      status,
      u.id,
      b.window_id
    ).run();

    return json({
      success: true,
      changed: result.meta?.changes || 0,
      status
    });
  }

  if (
    b.action === "call_turn" ||
    b.action === "start_turn" ||
    b.action === "complete_turn" ||
    b.action === "skip_turn" ||
    b.action === "absent_turn"
  ) {
    /*
     * Turn management may be granted either through the
     * normal academy permission system or as a session-scoped
     * Co-host permission.
     */
    const baseAuth = await requireAuth(request, env);

    if (!baseAuth.ok) {
      return baseAuth.response;
    }

    const globalTurnPermission = await hasPermission(
      env.DB,
      baseAuth.user,
      "session.turn.write"
    );

    const sessionForTurn = b.turn_id
      ? await env.DB.prepare(`
          SELECT session_id
          FROM session_turns
          WHERE id = ?
          LIMIT 1
        `).bind(b.turn_id).first()
      : null;

    const scopedCohostTurn = sessionForTurn
      ? await canCohostManageTurn(
          env.DB,
          baseAuth.user,
          sessionForTurn.session_id
        )
      : false;

    if (
      !globalTurnPermission &&
      !scopedCohostTurn
    ) {
      return json({
        success: false,
        error: "TURN_PERMISSION_DENIED"
      }, 403);
    }

    if (!b.turn_id) {
      return json({
        success: false,
        error: "TURN_ID_REQUIRED"
      }, 400);
    }

    const turn = await env.DB.prepare(`
      SELECT
        t.id,
        t.status AS current_status,
        t.session_id,
        t.registration_id,
        s.circle_id,
        c.teacher_id,
        c.status AS circle_status,
        c.circle_type
      FROM session_turns t
      INNER JOIN sessions s ON s.id=t.session_id
      LEFT JOIN circles c ON c.id=s.circle_id
      WHERE t.id=?
      LIMIT 1
    `).bind(b.turn_id).first();

    if (!turn) {
      return json({
        success: false,
        error: "TURN_NOT_FOUND"
      }, 404);
    }

    /*
     * The turn_id is authoritative for locating the turn,
     * but the client-provided session_id must still match it.
     * This prevents contradictory cross-session requests.
     */
    if (
      b.session_id &&
      Number(b.session_id) !== Number(turn.session_id)
    ) {
      return json({
        success: false,
        error: "TURN_SESSION_MISMATCH"
      }, 409);
    }

    if (!turn.circle_id || turn.circle_type !== "group") {
      return json({
        success: false,
        error: "GROUP_SESSION_REQUIRED"
      }, 409);
    }

    if (turn.circle_status !== "active") {
      return json({
        success: false,
        error: "CIRCLE_IS_NOT_ACTIVE"
      }, 409);
    }

    /*
     * A normal Teacher may manage turns only for their own
     * assigned circle. A session-scoped Co-host is allowed
     * to manage turns for the delegated session even when
     * that teacher is not the session's assigned teacher.
     */
    if (
      u.role === "teacher" &&
      !scopedCohostTurn &&
      (
        !u.teacher_id ||
        Number(turn.teacher_id) !== Number(u.teacher_id)
      )
    ) {
      return json({
        success: false,
        error: "CIRCLE_ACCESS_DENIED"
      }, 403);
    }

    /*
     * Co-host turn management is strictly limited to the
     * session for which the active delegation exists.
     */
    if (
      !globalTurnPermission &&
      !scopedCohostTurn
    ) {
      return json({
        success: false,
        error: "TURN_MANAGEMENT_OUT_OF_SCOPE"
      }, 403);
    }

    const allowedTransitions = {
      call_turn: ["waiting"],
      start_turn: ["called"],
      complete_turn: ["reciting"],
      skip_turn: ["waiting", "called"],
      absent_turn: ["waiting", "called"]
    };

    if (!allowedTransitions[b.action].includes(turn.current_status)) {
      return json({
        success: false,
        error: "INVALID_TURN_TRANSITION",
        current_status: turn.current_status,
        requested_action: b.action
      }, 409);
    }

    const statusMap = {
      call_turn: "called",
      start_turn: "reciting",
      complete_turn: "completed",
      skip_turn: "skipped",
      absent_turn: "absent"
    };

    const status = statusMap[b.action];
    const timestamp = nowIso();

    let sql = `
      UPDATE session_turns
      SET
        status = ?,
        updated_at = CURRENT_TIMESTAMP
    `;

    const params = [status];

    if (b.action === "call_turn") {
      sql += `, called_at = ?`;
      params.push(timestamp);
    }

    if (b.action === "start_turn") {
      sql += `, started_at = ?`;
      params.push(timestamp);
    }

    if (b.action === "complete_turn") {
      sql += `, completed_at = ?`;
      params.push(timestamp);
    }

    if (b.teacher_note !== undefined) {
      sql += `, teacher_note = ?`;
      params.push(b.teacher_note || null);
    }

    if (b.quran_progress_id !== undefined) {
      sql += `, quran_progress_id = ?`;
      params.push(b.quran_progress_id || null);
    }

    const transitionStatuses = {
      call_turn: ["waiting"],
      start_turn: ["called"],
      complete_turn: ["reciting"],
      skip_turn: ["waiting", "called"],
      absent_turn: ["waiting", "called"]
    };

    sql += ` WHERE id = ?`;
    params.push(b.turn_id);

    if (transitionStatuses[b.action].length === 1) {
      sql += ` AND status = ?`;
      params.push(transitionStatuses[b.action][0]);
    } else {
      sql += ` AND status IN (?, ?)`;
      params.push(
        transitionStatuses[b.action][0],
        transitionStatuses[b.action][1]
      );
    }

    const result = await env.DB.prepare(sql)
      .bind(...params)
      .run();

    if (result.meta?.changes > 0 && b.action === "complete_turn") {
      await env.DB.prepare(`
        UPDATE session_registrations
        SET
          status = 'completed',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (
          SELECT registration_id
          FROM session_turns
          WHERE id = ?
        )
      `).bind(b.turn_id).run();
    }

    if (result.meta?.changes > 0 && b.action === "absent_turn") {
      await env.DB.prepare(`
        UPDATE session_registrations
        SET
          status = 'no_show',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (
          SELECT registration_id
          FROM session_turns
          WHERE id = ?
        )
      `).bind(b.turn_id).run();
    }

    return json({
      success: true,
      changed: result.meta?.changes || 0,
      status
    });
  }

  return json({
    success: false,
    error: "UNKNOWN_ACTION"
  }, 400);
}
