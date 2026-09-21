import {
  requireAuth,
  requirePermission,
  writeAudit
} from "./_auth.js";

function clean(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePriority(value) {
  const allowed = ["low", "normal", "high", "urgent"];
  return allowed.includes(value) ? value : "normal";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function getLinkedGuardianStudentIds(db, userId) {
  const result = await db
    .prepare(`
      SELECT sg.student_id
      FROM student_guardians sg
      INNER JOIN guardians g
        ON g.id = sg.guardian_id
      WHERE g.user_id = ?
    `)
    .bind(userId)
    .all();

  return Array.isArray(result?.results)
    ? result.results
        .map(row => Number(row.student_id))
        .filter(Number.isFinite)
    : [];
}

async function getTeacherStudentIds(db, teacherId) {
  const result = await db
    .prepare(`
      SELECT DISTINCT ce.student_id
      FROM circle_enrollments ce
      INNER JOIN circles c
        ON c.id = ce.circle_id
      WHERE c.teacher_id = ?
        AND c.status = 'active'
        AND ce.status = 'active'
    `)
    .bind(teacherId)
    .all();

  return Array.isArray(result?.results)
    ? result.results
        .map(row => Number(row.student_id))
        .filter(Number.isFinite)
    : [];
}

export async function canReadNotification(
  db,
  user,
  notification
) {
  if (!user || !notification) {
    return false;
  }

  const roles = Array.isArray(user.roles)
    ? user.roles
    : user.role
      ? [user.role]
      : [];

  if (
    roles.includes("admin") ||
    roles.includes("supervisor")
  ) {
    return true;
  }

  if (
    Number(notification.user_id) === Number(user.id)
  ) {
    return true;
  }

  if (!notification.student_id) {
    return false;
  }

  if (roles.includes("guardian")) {
    const ids = await getLinkedGuardianStudentIds(
      db,
      user.id
    );

    return ids.includes(
      Number(notification.student_id)
    );
  }

  if (roles.includes("teacher")) {
    if (!user.teacher_id) {
      return false;
    }

    const ids = await getTeacherStudentIds(
      db,
      user.teacher_id
    );

    return ids.includes(
      Number(notification.student_id)
    );
  }

  return false;
}

export async function createNotification(
  db,
  {
    userId = null,
    studentId = null,
    type,
    title,
    message,
    channel = "in_app",
    priority = "normal",
    scheduledAt = null,
    sourceType = null,
    sourceId = null,
    dedupeKey = null
  } = {}
) {
  const cleanType = clean(type, 100);
  const cleanTitle = clean(title, 250);
  const cleanMessage = clean(message, 5000);

  if (!cleanType || !cleanTitle || !cleanMessage) {
    throw new Error("INVALID_NOTIFICATION");
  }

  if (
    !["in_app", "telegram", "whatsapp", "email"].includes(
      channel
    )
  ) {
    throw new Error("INVALID_NOTIFICATION_CHANNEL");
  }

  const result = await db
    .prepare(`
      INSERT OR IGNORE INTO notifications (
        user_id,
        student_id,
        type,
        title,
        message,
        channel,
        scheduled_at,
        status,
        priority,
        source_type,
        source_id,
        dedupe_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `)
    .bind(
      userId == null ? null : Number(userId),
      studentId == null ? null : Number(studentId),
      cleanType,
      cleanTitle,
      cleanMessage,
      channel,
      scheduledAt || null,
      normalizePriority(priority),
      sourceType ? clean(sourceType, 100) : null,
      sourceId == null ? null : Number(sourceId),
      dedupeKey ? clean(dedupeKey, 250) : null
    )
    .run();

  if (
    result?.meta?.changes === 0 &&
    dedupeKey
  ) {
    const existing = await db
      .prepare(`
        SELECT *
        FROM notifications
        WHERE dedupe_key = ?
        LIMIT 1
      `)
      .bind(dedupeKey)
      .first();

    return {
      created: false,
      notification: existing || null
    };
  }

  let notification = null;

  if (result?.meta?.last_row_id) {
    notification = await db
      .prepare(`
        SELECT *
        FROM notifications
        WHERE id = ?
        LIMIT 1
      `)
      .bind(result.meta.last_row_id)
      .first();
  }

  return {
    created: true,
    notification
  };
}

export async function listNotifications(
  db,
  user,
  {
    limit = 50,
    unreadOnly = false
  } = {}
) {
  const safeLimit = Math.min(
    Math.max(Number(limit) || 50, 1),
    100
  );

  const roles = Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : [];

  let rows = [];

  if (
    roles.includes("admin") ||
    roles.includes("supervisor")
  ) {
    const result = await db
      .prepare(`
        SELECT *
        FROM notifications
        WHERE channel = 'in_app'
          ${unreadOnly ? "AND read_at IS NULL" : ""}
        ORDER BY
          CASE priority
            WHEN 'urgent' THEN 1
            WHEN 'high' THEN 2
            WHEN 'normal' THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT ?
      `)
      .bind(safeLimit)
      .all();

    rows = result?.results || [];
  } else if (roles.includes("student")) {
    const result = await db
      .prepare(`
        SELECT *
        FROM notifications
        WHERE channel = 'in_app'
          AND user_id = ?
          ${unreadOnly ? "AND read_at IS NULL" : ""}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .bind(user.id, safeLimit)
      .all();

    rows = result?.results || [];
  } else if (roles.includes("guardian")) {
    const result = await db
      .prepare(`
        SELECT n.*
        FROM notifications n
        WHERE n.channel = 'in_app'
          AND (
            n.user_id = ?
            OR n.student_id IN (
              SELECT sg.student_id
              FROM student_guardians sg
              INNER JOIN guardians g
                ON g.id = sg.guardian_id
              WHERE g.user_id = ?
            )
          )
          ${unreadOnly ? "AND n.read_at IS NULL" : ""}
        ORDER BY n.created_at DESC
        LIMIT ?
      `)
      .bind(user.id, user.id, safeLimit)
      .all();

    rows = result?.results || [];
  } else if (roles.includes("teacher")) {
    const result = await db
      .prepare(`
        SELECT n.*
        FROM notifications n
        WHERE n.channel = 'in_app'
          AND (
            n.user_id = ?
            OR n.student_id IN (
              SELECT DISTINCT ce.student_id
              FROM circle_enrollments ce
              INNER JOIN circles c
                ON c.id = ce.circle_id
              WHERE c.teacher_id = ?
                AND c.status = 'active'
                AND ce.status = 'active'
            )
          )
          ${unreadOnly ? "AND n.read_at IS NULL" : ""}
        ORDER BY n.created_at DESC
        LIMIT ?
      `)
      .bind(user.id, user.teacher_id, safeLimit)
      .all();

    rows = result?.results || [];
  }

  return rows;
}

export async function notificationUnreadCount(
  db,
  user
) {
  const roles = Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : [];

  if (
    roles.includes("admin") ||
    roles.includes("supervisor")
  ) {
    const row = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM notifications
        WHERE channel = 'in_app'
          AND read_at IS NULL
      `)
      .first();

    return Number(row?.count || 0);
  }

  if (
    roles.includes("student") ||
    !roles.length
  ) {
    const row = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM notifications
        WHERE channel = 'in_app'
          AND user_id = ?
          AND read_at IS NULL
      `)
      .bind(user.id)
      .first();

    return Number(row?.count || 0);
  }

  if (roles.includes("guardian")) {
    const row = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM notifications n
        WHERE n.channel = 'in_app'
          AND n.read_at IS NULL
          AND (
            n.user_id = ?
            OR n.student_id IN (
              SELECT sg.student_id
              FROM student_guardians sg
              INNER JOIN guardians g
                ON g.id = sg.guardian_id
              WHERE g.user_id = ?
            )
          )
      `)
      .bind(user.id, user.id)
      .first();

    return Number(row?.count || 0);
  }

  if (roles.includes("teacher")) {
    const row = await db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM notifications n
        WHERE n.channel = 'in_app'
          AND n.read_at IS NULL
          AND (
            n.user_id = ?
            OR n.student_id IN (
              SELECT DISTINCT ce.student_id
              FROM circle_enrollments ce
              INNER JOIN circles c
                ON c.id = ce.circle_id
              WHERE c.teacher_id = ?
                AND c.status = 'active'
                AND ce.status = 'active'
            )
          )
      `)
      .bind(user.id, user.teacher_id)
      .first();

    return Number(row?.count || 0);
  }

  return 0;
}

export async function markNotificationRead(
  db,
  user,
  notificationId
) {
  const notification = await db
    .prepare(`
      SELECT *
      FROM notifications
      WHERE id = ?
      LIMIT 1
    `)
    .bind(Number(notificationId))
    .first();

  if (!notification) {
    return {
      ok: false,
      status: 404,
      error: "NOTIFICATION_NOT_FOUND"
    };
  }

  const allowed = await canReadNotification(
    db,
    user,
    notification
  );

  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: "FORBIDDEN"
    };
  }

  await db
    .prepare(`
      UPDATE notifications
      SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `)
    .bind(Number(notificationId))
    .run();

  return {
    ok: true
  };
}

export async function markAllNotificationsRead(
  db,
  user
) {
  const roles = Array.isArray(user?.roles)
    ? user.roles
    : user?.role
      ? [user.role]
      : [];

  if (
    roles.includes("admin") ||
    roles.includes("supervisor")
  ) {
    await db
      .prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE channel = 'in_app'
          AND read_at IS NULL
      `)
      .run();

    return { ok: true };
  }

  if (
    roles.includes("student") ||
    !roles.length
  ) {
    await db
      .prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE channel = 'in_app'
          AND user_id = ?
          AND read_at IS NULL
      `)
      .bind(user.id)
      .run();

    return { ok: true };
  }

  if (roles.includes("guardian")) {
    await db
      .prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE channel = 'in_app'
          AND read_at IS NULL
          AND (
            user_id = ?
            OR student_id IN (
              SELECT sg.student_id
              FROM student_guardians sg
              INNER JOIN guardians g
                ON g.id = sg.guardian_id
              WHERE g.user_id = ?
            )
          )
      `)
      .bind(user.id, user.id)
      .run();

    return { ok: true };
  }

  if (roles.includes("teacher")) {
    await db
      .prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE channel = 'in_app'
          AND read_at IS NULL
          AND (
            user_id = ?
            OR student_id IN (
              SELECT DISTINCT ce.student_id
              FROM circle_enrollments ce
              INNER JOIN circles c
                ON c.id = ce.circle_id
              WHERE c.teacher_id = ?
                AND c.status = 'active'
                AND ce.status = 'active'
            )
          )
      `)
      .bind(user.id, user.teacher_id)
      .run();

    return { ok: true };
  }

  return { ok: true };
}
