/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
 *
 * يدعم:
 * - التسجيل الفردي والجماعي.
 * - السعة التي تحددها الإدارة.
 * - منع التسجيل الجماعي عند الامتلاء.
 * - قائمة انتظار مرتبة.
 * - ترقية المنتظرين عند توفر مكان.
 * - إنشاء حلقة جماعية جديدة عند اكتمال قائمة الانتظار.
 * - نقل الطلاب فعليًا للحلقة الجديدة.
 * - تحديث حالة الحلقة إلى full / active.
 * - موافقة الإدارة والمشرفة.
 * - الاشتراكات والتجربة المجانية.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const ACTIVE_ENROLLMENT_STATUSES = [
  "pending",
  "active",
  "paused",
];

/* =========================================================
   Basic
========================================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: HEADERS,
    }
  );
}

function errorResponse(
  error,
  status = 400,
  extra = {}
) {
  return json(
    {
      success: false,
      error,
      ...extra,
    },
    status
  );
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

function text(value) {
  return String(value ?? "").trim();
}

function int(value) {
  const n = Number(value);

  return (
    Number.isInteger(n) &&
    n > 0
  )
    ? n
    : null;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* =========================================================
   Basic Queries
========================================================= */

async function getStudent(db, id) {
  return db.prepare(`
    SELECT *
    FROM students
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getPackage(db, id) {
  return db.prepare(`
    SELECT *
    FROM packages
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getCircle(db, id) {
  return db.prepare(`
    SELECT *
    FROM circles
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getEnrollment(
  db,
  studentId,
  circleId
) {
  return db.prepare(`
    SELECT *
    FROM circle_enrollments
    WHERE student_id = ?1
      AND circle_id = ?2
    LIMIT 1
  `).bind(
    studentId,
    circleId
  ).first();
}

async function enrollmentCount(
  db,
  circleId
) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM circle_enrollments
    WHERE circle_id = ?1
      AND status IN (
        'pending',
        'active',
        'paused'
      )
  `).bind(
    circleId
  ).first();

  return Number(
    row?.count || 0
  );
}

async function waitlistCount(
  db,
  circleId
) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM circle_waitlist
    WHERE circle_id = ?1
      AND status = 'waiting'
  `).bind(
    circleId
  ).first();

  return Number(
    row?.count || 0
  );
}

/* =========================================================
   Policies
========================================================= */

async function getPolicy(
  db,
  circleId,
  packageId
) {
  return db.prepare(`
    SELECT *
    FROM enrollment_policies
    WHERE enabled = 1
      AND (
        (
          circle_id = ?1
          AND package_id = ?2
        )
        OR
        (
          circle_id = ?1
          AND package_id IS NULL
        )
        OR
        (
          circle_id IS NULL
          AND package_id = ?2
        )
        OR
        (
          circle_id IS NULL
          AND package_id IS NULL
        )
      )
    ORDER BY CASE
      WHEN circle_id = ?1
       AND package_id = ?2 THEN 1

      WHEN circle_id = ?1
       AND package_id IS NULL THEN 2

      WHEN circle_id IS NULL
       AND package_id = ?2 THEN 3

      ELSE 4
    END
    LIMIT 1
  `).bind(
    circleId,
    packageId
  ).first();
}

async function getPackageRule(
  db,
  packageId,
  circleType
) {
  return db.prepare(`
    SELECT *
    FROM package_circle_rules
    WHERE package_id = ?1
      AND circle_type = ?2
      AND enabled = 1
    LIMIT 1
  `).bind(
    packageId,
    circleType
  ).first();
}

/* =========================================================
   Requests
========================================================= */

async function getRequest(
  db,
  id
) {
  return db.prepare(`
    SELECT *
    FROM enrollment_requests
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getPendingRequest(
  db,
  studentId,
  circleId
) {
  return db.prepare(`
    SELECT *
    FROM enrollment_requests
    WHERE student_id = ?1
      AND circle_id = ?2
      AND status IN (
        'pending',
        'introductory'
      )
    ORDER BY id DESC
    LIMIT 1
  `).bind(
    studentId,
    circleId
  ).first();
}

/* =========================================================
   Waitlist
========================================================= */

async function getWaitlistEntry(
  db,
  studentId,
  circleId
) {
  return db.prepare(`
    SELECT *
    FROM circle_waitlist
    WHERE student_id = ?1
      AND circle_id = ?2
      AND status = 'waiting'
    LIMIT 1
  `).bind(
    studentId,
    circleId
  ).first();
}

async function normalizeWaitlist(
  db,
  circleId
) {
  const result = await db.prepare(`
    SELECT id
    FROM circle_waitlist
    WHERE circle_id = ?1
      AND status = 'waiting'
    ORDER BY position ASC, id ASC
  `).bind(
    circleId
  ).all();

  const rows =
    result.results || [];

  for (
    let i = 0;
    i < rows.length;
    i++
  ) {
    await db.prepare(`
      UPDATE circle_waitlist
      SET position = ?2
      WHERE id = ?1
    `).bind(
      rows[i].id,
      i + 1
    ).run();
  }
}

async function addWaitlist(
  db,
  studentId,
  circleId
) {
  const existing =
    await getWaitlistEntry(
      db,
      studentId,
      circleId
    );

  if (existing) {
    return existing;
  }

  const row =
    await db.prepare(`
      SELECT
        COALESCE(
          MAX(position),
          0
        ) + 1 AS position
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
    `).bind(
      circleId
    ).first();

  return db.prepare(`
    INSERT INTO circle_waitlist (
      circle_id,
      student_id,
      position,
      status,
      created_at
    )
    VALUES (
      ?1,
      ?2,
      ?3,
      'waiting',
      ?4
    )
    RETURNING *
  `).bind(
    circleId,
    studentId,
    Number(
      row?.position || 1
    ),
    now()
  ).first();
}

/* =========================================================
   Circle Status
========================================================= */

async function setCircleStatus(
  db,
  circleId
) {
  const circle =
    await getCircle(
      db,
      circleId
    );

  if (!circle) {
    return null;
  }

  if (
    circle.status === "archived" ||
    circle.status === "inactive"
  ) {
    return circle;
  }

  const count =
    await enrollmentCount(
      db,
      circleId
    );

  const capacity =
    Number(
      circle.capacity || 1
    );

  const status =
    count >= capacity
      ? "full"
      : "active";

  if (
    circle.status !== status
  ) {
    await db.prepare(`
      UPDATE circles
      SET
        status = ?2,
        updated_at = ?3
      WHERE id = ?1
    `).bind(
      circleId,
      status,
      now()
    ).run();

    circle.status = status;
  }

  return circle;
}

/* =========================================================
   Permissions
========================================================= */

async function canManage(
  db,
  userId
) {
  const id =
    int(userId);

  if (!id) {
    return false;
  }

  const user =
    await db.prepare(`
      SELECT
        role,
        status
      FROM users
      WHERE id = ?1
      LIMIT 1
    `).bind(id).first();

  return Boolean(
    user &&
    user.status === "active" &&
    (
      user.role === "admin" ||
      user.role === "supervisor"
    )
  );
}

/* =========================================================
   Audit
========================================================= */

async function audit(
  db,
  userId,
  action,
  entityType,
  entityId,
  details
) {
  try {
    await db.prepare(`
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        details,
        created_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        ?6
      )
    `).bind(
      userId || null,
      action,
      entityType,
      entityId || null,
      JSON.stringify(
        details || {}
      ),
      now()
    ).run();
  } catch (error) {
    console.error(
      "Audit error:",
      error
    );
  }
}

/* =========================================================
   Admin Notifications
========================================================= */

async function notifyAdmins(
  db,
  title,
  message
) {
  try {
    await db.prepare(`
      INSERT INTO notifications (
        user_id,
        type,
        title,
        message,
        channel,
        status,
        created_at
      )
      SELECT
        id,
        'enrollment',
        ?1,
        ?2,
        'in_app',
        'pending',
        ?3
      FROM users
      WHERE role = 'admin'
        AND status = 'active'
    `).bind(
      title,
      message,
      now()
    ).run();
  } catch (error) {
    console.error(
      "Notification error:",
      error
    );
  }
}

/* =========================================================
   Subscription
========================================================= */

async function createSubscription(
  db,
  studentId,
  packageId,
  circleId,
  trialDays
) {
  if (!packageId) {
    return null;
  }

  const existing =
    await db.prepare(`
      SELECT *
      FROM subscriptions
      WHERE student_id = ?1
        AND package_id = ?2
        AND circle_id = ?3
        AND status IN (
          'trial',
          'active'
        )
      ORDER BY id DESC
      LIMIT 1
    `).bind(
      studentId,
      packageId,
      circleId
    ).first();

  if (existing) {
    return existing;
  }

  const start =
    new Date();

  const days =
    Math.max(
      0,
      Number(
        trialDays || 0
      )
    );

  const end =
    new Date(start);

  end.setDate(
    end.getDate() + days
  );

  return db.prepare(`
    INSERT INTO subscriptions (
      student_id,
      package_id,
      circle_id,
      start_date,
      end_date,
      status,
      trial_ends_at,
      created_at,
      updated_at
    )
    VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7,
      ?8,
      ?8
    )
    RETURNING *
  `).bind(
    studentId,
    packageId,
    circleId,
    start.toISOString()
      .slice(0, 10),
    end.toISOString()
      .slice(0, 10),
    days > 0
      ? "trial"
      : "active",
    days > 0
      ? end.toISOString()
      : null,
    now()
  ).first();
}

/* =========================================================
   Enrollment
========================================================= */

async function createEnrollment(
  db,
  studentId,
  circleId,
  joinedVia = "request"
) {
  const existing =
    await getEnrollment(
      db,
      studentId,
      circleId
    );

  if (
    existing &&
    ACTIVE_ENROLLMENT_STATUSES.includes(
      existing.status
    )
  ) {
    return existing;
  }

  if (existing) {
    return db.prepare(`
      UPDATE circle_enrollments
      SET
        start_date = ?3,
        end_date = NULL,
        status = 'active',
        joined_via = ?4,
        notes = NULL,
        updated_at = ?5
      WHERE id = ?1
        AND student_id = ?2
      RETURNING *
    `).bind(
      existing.id,
      studentId,
      today(),
      joinedVia,
      now()
    ).first();
  }

  return db.prepare(`
    INSERT INTO circle_enrollments (
      circle_id,
      student_id,
      start_date,
      status,
      joined_via,
      created_at,
      updated_at
    )
    VALUES (
      ?1,
      ?2,
      ?3,
      'active',
      ?4,
      ?5,
      ?5
    )
    RETURNING *
  `).bind(
    circleId,
    studentId,
    today(),
    joinedVia,
    now()
  ).first();
}

/* =========================================================
   Decision
========================================================= */

async function createDecision(
  db,
  requestId,
  studentId,
  circleId,
  decision,
  reason,
  decidedBy
) {
  return db.prepare(`
    INSERT INTO enrollment_decisions (
      enrollment_request_id,
      student_id,
      circle_id,
      decision,
      reason,
      decided_by,
      decided_at
    )
    VALUES (
      ?1,
      ?2,
      ?3,
      ?4,
      ?5,
      ?6,
      ?7
    )
    RETURNING *
  `).bind(
    requestId || null,
    studentId,
    circleId,
    decision,
    reason || null,
    decidedBy || null,
    now()
  ).first();
}

/* =========================================================
   Accept Student
========================================================= */

async function acceptStudent(
  db,
  request,
  packageId,
  trialDays,
  decidedBy,
  joinedVia
) {
  const enrollment =
    await createEnrollment(
      db,
      request.student_id,
      request.circle_id,
      joinedVia
    );

  const subscription =
    await createSubscription(
      db,
      request.student_id,
      packageId,
      request.circle_id,
      trialDays
    );

  await db.prepare(`
    UPDATE enrollment_requests
    SET
      status = 'accepted',
      decided_at = ?2,
      decided_by = ?3
    WHERE id = ?1
  `).bind(
    request.id,
    now(),
    decidedBy || null
  ).run();

  await db.prepare(`
    UPDATE circle_waitlist
    SET status = 'accepted'
    WHERE student_id = ?1
      AND circle_id = ?2
      AND status = 'waiting'
  `).bind(
    request.student_id,
    request.circle_id
  ).run();

  await createDecision(
    db,
    request.id,
    request.student_id,
    request.circle_id,
    "accepted",
    null,
    decidedBy
  );

  await normalizeWaitlist(
    db,
    request.circle_id
  );

  await setCircleStatus(
    db,
    request.circle_id
  );

  return {
    enrollment,
    subscription,
  };
}

/* =========================================================
   New Circle Name
========================================================= */

async function generateCircleName(
  db,
  original
) {
  const base =
    text(original.name) ||
    "الحلقة";

  const result =
    await db.prepare(`
      SELECT name
      FROM circles
      WHERE name LIKE ?1
      ORDER BY id
    `).bind(
      `${base}%`
    ).all();

  const names =
    new Set(
      (result.results || [])
        .map(row =>
          text(row.name)
        )
    );

  let number = 2;

  while (
    names.has(
      `${base} ${number}`
    )
  ) {
    number++;
  }

  return `${base} ${number}`;
}

/* =========================================================
   Create New Group Circle
========================================================= */

async function createSiblingCircle(
  db,
  original
) {
  const name =
    await generateCircleName(
      db,
      original
    );

  const result =
    await db.prepare(`
      INSERT INTO circles (
        name,
        circle_type,
        teacher_id,
        package_id,
        capacity,
        status,
        schedule_note,
        level_name,
        path_name,
        created_at,
        updated_at
      )
      VALUES (
        ?1,
        'group',
        ?2,
        ?3,
        ?4,
        'active',
        ?5,
        ?6,
        ?7,
        ?8,
        ?8
      )
    `).bind(
      name,
      original.teacher_id ||
        null,
      original.package_id ||
        null,
      Number(
        original.capacity || 1
      ),
      original.schedule_note ||
        null,
      original.level_name ||
        null,
      original.path_name ||
        null,
      now()
    ).run();

  return getCircle(
    db,
    result.meta?.last_row_id
  );
}

/* =========================================================
   Process Waitlist
========================================================= */

async function processWaitlist(
  db,
  circleId,
  decidedBy = null
) {
  let circle =
    await getCircle(
      db,
      circleId
    );

  if (!circle) {
    throw new Error(
      "CIRCLE_NOT_FOUND"
    );
  }

  if (
    circle.circle_type !==
    "group"
  ) {
    return {
      promoted: [],
      new_circle: null,
    };
  }

  const capacity =
    Number(
      circle.capacity || 1
    );

  let count =
    await enrollmentCount(
      db,
      circle.id
    );

  const promoted = [];

  while (
    count < capacity
  ) {
    const item =
      await db.prepare(`
        SELECT *
        FROM circle_waitlist
        WHERE circle_id = ?1
          AND status = 'waiting'
        ORDER BY position ASC, id ASC
        LIMIT 1
      `).bind(
        circle.id
      ).first();

    if (!item) {
      break;
    }

    const student =
      await getStudent(
        db,
        item.student_id
      );

    if (
      !student ||
      student.status !== "active"
    ) {
      await db.prepare(`
        UPDATE circle_waitlist
        SET status = 'cancelled'
        WHERE id = ?1
      `).bind(
        item.id
      ).run();

      continue;
    }

    let request =
      await getPendingRequest(
        db,
        item.student_id,
        circle.id
      );

    if (!request) {
      await db.prepare(`
        INSERT INTO enrollment_requests (
          student_id,
          circle_id,
          request_type,
          status,
          requested_at,
          notes
        )
        VALUES (
          ?1,
          ?2,
          'new',
          'pending',
          ?3,
          'Created from waitlist'
        )
      `).bind(
        item.student_id,
        circle.id,
        now()
      ).run();

      request =
        await getPendingRequest(
          db,
          item.student_id,
          circle.id
        );
    }

    const result =
      await acceptStudent(
        db,
        request,
        circle.package_id,
        0,
        decidedBy,
        "waitlist"
      );

    promoted.push({
      student_id:
        item.student_id,
      ...result,
    });

    count++;
  }

  await normalizeWaitlist(
    db,
    circle.id
  );

  circle =
    await setCircleStatus(
      db,
      circle.id
    );

  const waiting =
    await waitlistCount(
      db,
      circle.id
    );

  let newCircle = null;

  /*
   * إذا أصبحت قائمة الانتظار بحجم
   * السعة الجماعية كاملة، ننشئ مجموعة جديدة.
   */
  if (
    circle.circle_type === "group" &&
    waiting >= capacity &&
    capacity > 0
  ) {
    newCircle =
      await createSiblingCircle(
        db,
        circle
      );

    if (newCircle) {
      const result =
        await db.prepare(`
          SELECT *
          FROM circle_waitlist
          WHERE circle_id = ?1
            AND status = 'waiting'
          ORDER BY position ASC, id ASC
          LIMIT ?2
        `).bind(
          circle.id,
          capacity
        ).all();

      const moved = [];

      for (
        const item of
          (result.results || [])
      ) {
        const student =
          await getStudent(
            db,
            item.student_id
          );

        if (
          !student ||
          student.status !== "active"
        ) {
          await db.prepare(`
            UPDATE circle_waitlist
            SET status = 'cancelled'
            WHERE id = ?1
          `).bind(
            item.id
          ).run();

          continue;
        }

        const enrollment =
          await createEnrollment(
            db,
            item.student_id,
            newCircle.id,
            "new_circle_waitlist"
          );

        const subscription =
          await createSubscription(
            db,
            item.student_id,
            newCircle.package_id,
            newCircle.id,
            0
          );

        const request =
          await getPendingRequest(
            db,
            item.student_id,
            circle.id
          );

        if (request) {
          await db.prepare(`
            UPDATE enrollment_requests
            SET
              circle_id = ?2,
              status = 'accepted',
              decided_at = ?3,
              decided_by = ?4
            WHERE id = ?1
          `).bind(
            request.id,
            newCircle.id,
            now(),
            decidedBy || null
          ).run();
        }

        await db.prepare(`
          UPDATE circle_waitlist
          SET status = 'accepted'
          WHERE id = ?1
        `).bind(
          item.id
        ).run();

        await createDecision(
          db,
          request?.id || null,
          item.student_id,
          newCircle.id,
          "accepted",
          "Moved to newly created group circle",
          decidedBy
        );

        moved.push({
          student_id:
            item.student_id,
          enrollment,
          subscription,
        });
      }

      await normalizeWaitlist(
        db,
        circle.id
      );

      await notifyAdmins(
        db,
        "تم إنشاء حلقة جماعية جديدة",
        `تم إنشاء ${newCircle.name} بعد اكتمال قائمة انتظار ${circle.name}، وتم نقل الطلاب إليها فعليًا.`
      );

      await audit(
        db,
        decidedBy,
        "new_group_circle_created",
        "circle",
        newCircle.id,
        {
          original_circle_id:
            circle.id,
          moved_students:
            moved.map(
              item =>
                item.student_id
            ),
        }
      );

      newCircle = {
        ...newCircle,
        moved_students:
          moved,
      };
    }
  }

  return {
    promoted,
    new_circle:
      newCircle,
  };
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const db =
    context.env?.DB;

  if (!db) {
    return json({
      success: true,
      database: false,
      data: [],
    });
  }

  const url =
    new URL(
      context.request.url
    );

  const id =
    int(
      url.searchParams.get(
        "id"
      )
    );

  const studentId =
    int(
      url.searchParams.get(
        "student_id"
      )
    );

  const circleId =
    int(
      url.searchParams.get(
        "circle_id"
      )
    );

  const status =
    text(
      url.searchParams.get(
        "status"
      )
    );

  try {
    if (id) {
      const row =
        await db.prepare(`
          SELECT
            er.*,
            s.full_name AS student_name,
            c.name AS circle_name,
            c.circle_type,
            c.capacity,
            p.name AS package_name
          FROM enrollment_requests er

          JOIN students s
            ON s.id = er.student_id

          JOIN circles c
            ON c.id = er.circle_id

          LEFT JOIN packages p
            ON p.id = c.package_id

          WHERE er.id = ?1
          LIMIT 1
        `).bind(id).first();

      if (!row) {
        return errorResponse(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: row,
      });
    }

    let sql = `
      SELECT
        er.*,
        s.full_name AS student_name,
        c.name AS circle_name,
        c.circle_type,
        c.capacity,
        c.status AS circle_status,
        p.name AS package_name,

        (
          SELECT COUNT(*)
          FROM circle_enrollments ce
          WHERE ce.circle_id = c.id
            AND ce.status IN (
              'pending',
              'active',
              'paused'
            )
        ) AS enrolled_count,

        (
          SELECT COUNT(*)
          FROM circle_waitlist cw
          WHERE cw.circle_id = c.id
            AND cw.status = 'waiting'
        ) AS waitlist_count

      FROM enrollment_requests er

      JOIN students s
        ON s.id = er.student_id

      JOIN circles c
        ON c.id = er.circle_id

      LEFT JOIN packages p
        ON p.id = c.package_id

      WHERE 1 = 1
    `;

    const params = [];

    if (studentId) {
      params.push(studentId);
      sql +=
        ` AND er.student_id = ?${params.length}`;
    }

    if (circleId) {
      params.push(circleId);
      sql +=
        ` AND er.circle_id = ?${params.length}`;
    }

    if (status) {
      params.push(status);
      sql +=
        ` AND er.status = ?${params.length}`;
    }

    sql += `
      ORDER BY
        er.requested_at DESC,
        er.id DESC
    `;

    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    const waitSql =
      circleId
        ? `
          SELECT
            cw.*,
            s.full_name AS student_name
          FROM circle_waitlist cw
          JOIN students s
            ON s.id = cw.student_id
          WHERE cw.circle_id = ?1
            AND cw.status = 'waiting'
          ORDER BY
            cw.position,
            cw.id
        `
        : `
          SELECT
            cw.*,
            s.full_name AS student_name,
            c.name AS circle_name
          FROM circle_waitlist cw
          JOIN students s
            ON s.id = cw.student_id
          JOIN circles c
            ON c.id = cw.circle_id
          WHERE cw.status = 'waiting'
          ORDER BY
            cw.circle_id,
            cw.position,
            cw.id
        `;

    const wait =
      circleId
        ? await db
            .prepare(waitSql)
            .bind(circleId)
            .all()
        : await db
            .prepare(waitSql)
            .all();

    return json({
      success: true,
      data:
        result.results || [],
      waitlist:
        wait.results || [],
    });
  } catch (error) {
    console.error(
      "Enrollment GET error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "ENROLLMENTS_FETCH_FAILED",
      500
    );
  }
}

/* =========================================================
   POST
========================================================= */

export async function onRequestPost(
  context
) {
  const db =
    context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const data =
    await body(
      context.request
    );

  if (
    !data ||
    typeof data !== "object"
  ) {
    return errorResponse(
      "INVALID_JSON",
      400
    );
  }

  const studentId =
    int(data.student_id);

  const circleId =
    int(data.circle_id);

  if (
    !studentId ||
    !circleId
  ) {
    return errorResponse(
      "STUDENT_ID_AND_CIRCLE_ID_REQUIRED",
      400
    );
  }

  try {
    const student =
      await getStudent(
        db,
        studentId
      );

    if (!student) {
      return errorResponse(
        "STUDENT_NOT_FOUND",
        404
      );
    }

    if (
      student.status !==
      "active"
    ) {
      return errorResponse(
        "STUDENT_IS_NOT_ACTIVE",
        409
      );
    }

    const circle =
      await getCircle(
        db,
        circleId
      );

    if (!circle) {
      return errorResponse(
        "CIRCLE_NOT_FOUND",
        404
      );
    }

    if (
      ![
        "individual",
        "group",
      ].includes(
        circle.circle_type
      )
    ) {
      return errorResponse(
        "INVALID_CIRCLE_TYPE",
        409
      );
    }

    if (
      [
        "inactive",
        "archived",
      ].includes(
        circle.status
      )
    ) {
      return errorResponse(
        "CIRCLE_NOT_OPEN",
        409
      );
    }

    const packageId =
      int(data.package_id) ||
      int(circle.package_id);

    if (!packageId) {
      return errorResponse(
        "PACKAGE_REQUIRED",
        400
      );
    }

    const pkg =
      await getPackage(
        db,
        packageId
      );

    if (!pkg) {
      return errorResponse(
        "PACKAGE_NOT_FOUND",
        404
      );
    }

    if (
      pkg.status !==
      "active"
    ) {
      return errorResponse(
        "PACKAGE_IS_INACTIVE",
        409
      );
    }

    if (
      pkg.package_type !==
      circle.circle_type
    ) {
      return errorResponse(
        "PACKAGE_TYPE_DOES_NOT_MATCH_CIRCLE_TYPE",
        409
      );
    }

    const rule =
      await getPackageRule(
        db,
        packageId,
        circle.circle_type
      );

    if (!rule) {
      return errorResponse(
        "PACKAGE_CIRCLE_RULE_NOT_ALLOWED",
        409
      );
    }

    const policy =
      await getPolicy(
        db,
        circle.id,
        packageId
      );

    if (
      policy &&
      Number(
        policy.allow_new_students
      ) !== 1
    ) {
      return errorResponse(
        "NEW_ENROLLMENT_DISABLED",
        409
      );
    }

    const existing =
      await getEnrollment(
        db,
        studentId,
        circle.id
      );

    if (
      existing &&
      ACTIVE_ENROLLMENT_STATUSES.includes(
        existing.status
      )
    ) {
      return json({
        success: true,
        already_enrolled: true,
        data: existing,
      });
    }

    const duplicate =
      await getPendingRequest(
        db,
        studentId,
        circle.id
      );

    if (duplicate) {
      return json({
        success: true,
        already_requested: true,
        data: duplicate,
      });
    }

    const count =
      await enrollmentCount(
        db,
        circle.id
      );

    const capacity =
      Number(
        circle.capacity ||
        pkg.capacity ||
        1
      );

    const full =
      count >= capacity;

    const allowWaitlist =
      !policy ||
      Number(
        policy.allow_waitlist
      ) === 1;

    const requireIntro =
      policy &&
      Number(
        policy.require_introductory_meeting
      ) === 1;

    const requireApproval =
      !policy ||
      Number(
        policy.require_admin_approval
      ) === 1;

    /* =====================================================
       Group Full
    ===================================================== */

    if (
      full &&
      circle.circle_type ===
        "group"
    ) {
      if (!allowWaitlist) {
        return errorResponse(
          "CIRCLE_IS_FULL_AND_WAITLIST_DISABLED",
          409
        );
      }

      const wait =
        await addWaitlist(
          db,
          studentId,
          circle.id
        );

      const request =
        await db.prepare(`
          INSERT INTO enrollment_requests (
            student_id,
            circle_id,
            request_type,
            status,
            requested_at,
            notes
          )
          VALUES (
            ?1,
            ?2,
            'new',
            'pending',
            ?3,
            'Added to group waitlist'
          )
          RETURNING *
        `).bind(
          studentId,
          circle.id,
          now()
        ).first();

      await createDecision(
        db,
        request.id,
        studentId,
        circle.id,
        "waitlisted",
        "Circle is full",
        null
      );

      await setCircleStatus(
        db,
        circle.id
      );

      const waiting =
        await waitlistCount(
          db,
          circle.id
        );

      let newCircle = null;

      if (
        waiting >= capacity
      ) {
        const processed =
          await processWaitlist(
            db,
            circle.id,
            null
          );

        newCircle =
          processed.new_circle;
      }

      return json(
        {
          success: true,
          decision:
            "waitlisted",
          data: request,
          waitlist: wait,
          new_circle:
            newCircle,
        },
        202
      );
    }

    /* =====================================================
       Create Request
    ===================================================== */

    const requestStatus =
      requireIntro
        ? "introductory"
        : "pending";

    const request =
      await db.prepare(`
        INSERT INTO enrollment_requests (
          student_id,
          circle_id,
          request_type,
          status,
          requested_at,
          notes
        )
        VALUES (
          ?1,
          ?2,
          ?3,
          ?4,
          ?5,
          ?6
        )
        RETURNING *
      `).bind(
        studentId,
        circle.id,
        text(
          data.request_type
        ) || "new",
        requestStatus,
        now(),
        requireIntro
          ? "Introductory meeting required"
          : "Enrollment request"
      ).first();

    /*
     * إذا كانت الإدارة لا تحتاج موافقة
     * ولا يوجد لقاء تعريفي، يتم القبول مباشرة.
     */
    if (
      !requireApproval &&
      !requireIntro
    ) {
      const accepted =
        await acceptStudent(
          db,
          request,
          packageId,
          Number(
            policy?.trial_days ||
            pkg.trial_days ||
            0
          ),
          null,
          "direct"
        );

      return json(
        {
          success: true,
          decision:
            "accepted",
          request,
          ...accepted,
        },
        201
      );
    }

    await setCircleStatus(
      db,
      circle.id
    );

    return json(
      {
        success: true,
        decision:
          requestStatus,
        data: request,
      },
      201
    );
  } catch (error) {
    console.error(
      "Enrollment POST error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "ENROLLMENT_CREATE_FAILED",
      500
    );
  }
}

/* =========================================================
   PATCH
========================================================= */

export async function onRequestPatch(
  context
) {
  const db =
    context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const data =
    await body(
      context.request
    );

  if (
    !data ||
    typeof data !== "object"
  ) {
    return errorResponse(
      "INVALID_JSON",
      400
    );
  }

  const actorId =
    int(data.user_id) ||
    int(
      context.request
        .headers
        .get("x-user-id")
    );

  const action =
    text(
      data.action
    ).toLowerCase();

  if (
    !(await canManage(
      db,
      actorId
    ))
  ) {
    return errorResponse(
      "ADMIN_OR_SUPERVISOR_PERMISSION_REQUIRED",
      403
    );
  }

  try {
    /* =====================================================
       Approve / Reject
    ===================================================== */

    if (
      action === "approve" ||
      action === "reject"
    ) {
      const requestId =
        int(data.request_id);

      if (!requestId) {
        return errorResponse(
          "REQUEST_ID_REQUIRED",
          400
        );
      }

      const request =
        await getRequest(
          db,
          requestId
        );

      if (!request) {
        return errorResponse(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      if (
        ![
          "pending",
          "introductory",
        ].includes(
          request.status
        )
      ) {
        return errorResponse(
          "REQUEST_ALREADY_DECIDED",
          409
        );
      }

      const circle =
        await getCircle(
          db,
          request.circle_id
        );

      if (!circle) {
        return errorResponse(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      /* ===================================================
         Reject
      =================================================== */

      if (
        action === "reject"
      ) {
        await db.prepare(`
          UPDATE enrollment_requests
          SET
            status = 'rejected',
            decided_at = ?2,
            decided_by = ?3
          WHERE id = ?1
        `).bind(
          requestId,
          now(),
          actorId
        ).run();

        await db.prepare(`
          UPDATE circle_waitlist
          SET status = 'rejected'
          WHERE student_id = ?1
            AND circle_id = ?2
            AND status = 'waiting'
        `).bind(
          request.student_id,
          request.circle_id
        ).run();

        await createDecision(
          db,
          requestId,
          request.student_id,
          request.circle_id,
          "rejected",
          text(
            data.reason
          ) ||
            "Rejected by administration",
          actorId
        );

        await normalizeWaitlist(
          db,
          request.circle_id
        );

        return json({
          success: true,
          decision:
            "rejected",
          data:
            await getRequest(
              db,
              requestId
            ),
        });
      }

      /* ===================================================
         Approve
      =================================================== */

      const packageId =
        int(data.package_id) ||
        int(circle.package_id);

      const pkg =
        await getPackage(
          db,
          packageId
        );

      if (!pkg) {
        return errorResponse(
          "PACKAGE_NOT_FOUND",
          404
        );
      }

      const count =
        await enrollmentCount(
          db,
          circle.id
        );

      const capacity =
        Number(
          circle.capacity ||
          pkg.capacity ||
          1
        );

      /*
       * لو امتلأت الحلقة قبل أن توافق الإدارة،
       * ننقل الطالب لقائمة الانتظار بدل كسر السعة.
       */

      if (
        count >= capacity
      ) {
        const wait =
          await addWaitlist(
            db,
            request.student_id,
            circle.id
          );

        await db.prepare(`
          UPDATE enrollment_requests
          SET
            status = 'pending',
            notes = ?2
          WHERE id = ?1
        `).bind(
          requestId,
          "Moved to waitlist after approval because circle became full"
        ).run();

        await createDecision(
          db,
          requestId,
          request.student_id,
          circle.id,
          "waitlisted",
          "Circle became full",
          actorId
        );

        await normalizeWaitlist(
          db,
          circle.id
        );

        const waiting =
          await waitlistCount(
            db,
            circle.id
          );

        let newCircle = null;

        if (
          circle.circle_type ===
            "group" &&
          waiting >= capacity
        ) {
          newCircle =
            (
              await processWaitlist(
                db,
                circle.id,
                actorId
              )
            ).new_circle;
        }

        return json(
          {
            success: true,
            decision:
              "waitlisted",
            waitlist: wait,
            new_circle:
              newCircle,
          },
          202
        );
      }

      const result =
        await acceptStudent(
          db,
          request,
          packageId,
          Number(
            pkg.trial_days || 0
          ),
          actorId,
          "approved"
        );

      await audit(
        db,
        actorId,
        "enrollment_approved",
        "enrollment_request",
        requestId,
        {
          student_id:
            request.student_id,
          circle_id:
            circle.id,
        }
      );

      return json({
        success: true,
        decision:
          "accepted",
        request:
          await getRequest(
            db,
            requestId
          ),
        ...result,
      });
    }

    /* =====================================================
       Process Waitlist
    ===================================================== */

    if (
      action ===
        "process_waitlist" ||
      action ===
        "promote_waitlist"
    ) {
      const circleId =
        int(data.circle_id);

      if (!circleId) {
        return errorResponse(
          "CIRCLE_ID_REQUIRED",
          400
        );
      }

      const result =
        await processWaitlist(
          db,
          circleId,
          actorId
        );

      await audit(
        db,
        actorId,
        "waitlist_processed",
        "circle",
        circleId,
        result
      );

      return json({
        success: true,
        ...result,
      });
    }

    /* =====================================================
       Cancel Request
    ===================================================== */

    if (
      action === "cancel"
    ) {
      const requestId =
        int(data.request_id);

      if (!requestId) {
        return errorResponse(
          "REQUEST_ID_REQUIRED",
          400
        );
      }

      const request =
        await getRequest(
          db,
          requestId
        );

      if (!request) {
        return errorResponse(
          "REQUEST_NOT_FOUND",
          404
        );
      }

      await db.prepare(`
        UPDATE enrollment_requests
        SET
          status = 'cancelled',
          decided_at = ?2,
          decided_by = ?3
        WHERE id = ?1
      `).bind(
        requestId,
        now(),
        actorId
      ).run();

      await db.prepare(`
        UPDATE circle_waitlist
        SET status = 'cancelled'
        WHERE student_id = ?1
          AND circle_id = ?2
          AND status = 'waiting'
      `).bind(
        request.student_id,
        request.circle_id
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "cancelled",
        text(
          data.reason
        ) || "Cancelled",
        actorId
      );

      await normalizeWaitlist(
        db,
        request.circle_id
      );

      await processWaitlist(
        db,
        request.circle_id,
        actorId
      );

      return json({
        success: true,
        data:
          await getRequest(
            db,
            requestId
          ),
      });
    }

    return errorResponse(
      "INVALID_ACTION",
      400,
      {
        allowed_actions: [
          "approve",
          "reject",
          "cancel",
          "process_waitlist",
          "promote_waitlist",
        ],
      }
    );
  } catch (error) {
    console.error(
      "Enrollment PATCH error:",
      error
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "ENROLLMENT_UPDATE_FAILED",
      500
    );
  }
}
