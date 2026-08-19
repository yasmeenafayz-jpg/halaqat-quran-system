/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
 *
 * يدعم:
 * - التسجيل الفردي والجماعي.
 * - احترام سعة الحلقة المحددة من الإدارة.
 * - قائمة انتظار مرتبة.
 * - ترقية المنتظرين عند وجود مكان.
 * - إنشاء حلقة جماعية جديدة عند امتلاء قائمة الانتظار.
 * - نقل الطلاب فعليًا للحلقة الجديدة.
 * - إنشاء الاشتراك المرتبط بالحلقة الجديدة.
 * - تحديث حالة الحلقة إلى full / active.
 * - تسجيل القرارات المهمة.
 * - حماية عمليات الإدارة.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* =========================================================
   Helpers
========================================================= */

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function normalizeCircleType(value) {
  const type = String(value || "").trim().toLowerCase();

  if (["group", "جماعية", "جماعي"].includes(type)) {
    return "group";
  }

  if (["individual", "فردية", "فردي"].includes(type)) {
    return "individual";
  }

  return type;
}

function isActiveEnrollmentStatus(status) {
  return ["pending", "active", "paused"].includes(
    String(status || "").toLowerCase()
  );
}

/* =========================================================
   Queries
========================================================= */

async function getStudent(db, id) {
  if (!id) return null;

  return db
    .prepare(`
      SELECT *
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

async function getPackage(db, id) {
  if (!id) return null;

  return db
    .prepare(`
      SELECT *
      FROM packages
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

async function getCircle(db, id) {
  if (!id) return null;

  return db
    .prepare(`
      SELECT *
      FROM circles
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

async function getEnrollment(db, studentId, circleId) {
  return db
    .prepare(`
      SELECT *
      FROM circle_enrollments
      WHERE student_id = ?1
        AND circle_id = ?2
      LIMIT 1
    `)
    .bind(studentId, circleId)
    .first();
}

async function enrollmentCount(db, circleId) {
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM circle_enrollments
      WHERE circle_id = ?1
        AND status IN (
          'pending',
          'active',
          'paused'
        )
    `)
    .bind(circleId)
    .first();

  return Number(row?.count || 0);
}

async function waitlistCount(db, circleId) {
  const row = await db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
    `)
    .bind(circleId)
    .first();

  return Number(row?.count || 0);
}

/* =========================================================
   Policies
========================================================= */

async function getPolicy(db, circleId, packageId) {
  return db
    .prepare(`
      SELECT *
      FROM enrollment_policies
      WHERE enabled = 1
        AND (
          (circle_id = ?1 AND package_id = ?2)
          OR
          (circle_id = ?1 AND package_id IS NULL)
          OR
          (circle_id IS NULL AND package_id = ?2)
          OR
          (circle_id IS NULL AND package_id IS NULL)
        )
      ORDER BY
        CASE
          WHEN circle_id = ?1
           AND package_id = ?2 THEN 1
          WHEN circle_id = ?1
           AND package_id IS NULL THEN 2
          WHEN circle_id IS NULL
           AND package_id = ?2 THEN 3
          ELSE 4
        END
      LIMIT 1
    `)
    .bind(circleId, packageId)
    .first();
}

async function getPackageCircleRule(db, packageId, circleType) {
  return db
    .prepare(`
      SELECT *
      FROM package_circle_rules
      WHERE package_id = ?1
        AND circle_type = ?2
        AND enabled = 1
      LIMIT 1
    `)
    .bind(packageId, circleType)
    .first();
}

/* =========================================================
   Requests
========================================================= */

async function getPendingRequest(db, studentId, circleId) {
  return db
    .prepare(`
      SELECT *
      FROM enrollment_requests
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status IN ('pending', 'introductory')
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(studentId, circleId)
    .first();
}

async function createRequest(
  db,
  studentId,
  circleId,
  requestType,
  status,
  notes = null
) {
  return db
    .prepare(`
      INSERT INTO enrollment_requests (
        student_id,
        circle_id,
        request_type,
        status,
        requested_at,
        notes
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      RETURNING *
    `)
    .bind(
      studentId,
      circleId,
      requestType,
      status,
      now(),
      notes
    )
    .first();
}

/* =========================================================
   Decisions
========================================================= */

async function createDecision(
  db,
  requestId,
  studentId,
  circleId,
  decision,
  reason = null,
  decidedBy = null
) {
  return db
    .prepare(`
      INSERT INTO enrollment_decisions (
        enrollment_request_id,
        student_id,
        circle_id,
        decision,
        reason,
        decided_by,
        decided_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      RETURNING *
    `)
    .bind(
      requestId,
      studentId,
      circleId,
      decision,
      reason,
      decidedBy,
      now()
    )
    .first();
}

/* =========================================================
   Waitlist
========================================================= */

async function getWaitlist(db, studentId, circleId) {
  return db
    .prepare(`
      SELECT *
      FROM circle_waitlist
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status = 'waiting'
      LIMIT 1
    `)
    .bind(studentId, circleId)
    .first();
}

async function addWaitlist(db, studentId, circleId) {
  const existing = await getWaitlist(db, studentId, circleId);

  if (existing) {
    return existing;
  }

  const positionRow = await db
    .prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS position
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
    `)
    .bind(circleId)
    .first();

  return db
    .prepare(`
      INSERT INTO circle_waitlist (
        circle_id,
        student_id,
        position,
        status,
        created_at
      )
      VALUES (?1, ?2, ?3, 'waiting', ?4)
      RETURNING *
    `)
    .bind(
      circleId,
      studentId,
      Number(positionRow?.position || 1),
      now()
    )
    .first();
}

async function normalizeWaitlist(db, circleId) {
  const result = await db
    .prepare(`
      SELECT id
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY position ASC, id ASC
    `)
    .bind(circleId)
    .all();

  const rows = result?.results || [];

  for (let i = 0; i < rows.length; i++) {
    await db
      .prepare(`
        UPDATE circle_waitlist
        SET position = ?2
        WHERE id = ?1
      `)
      .bind(rows[i].id, i + 1)
      .run();
  }
}

/* =========================================================
   Subscriptions
========================================================= */

async function getActiveSubscription(
  db,
  studentId,
  packageId,
  circleId
) {
  try {
    return await db
      .prepare(`
        SELECT *
        FROM subscriptions
        WHERE student_id = ?1
          AND package_id = ?2
          AND circle_id = ?3
          AND status IN ('trial', 'active')
        ORDER BY id DESC
        LIMIT 1
      `)
      .bind(studentId, packageId, circleId)
      .first();
  } catch {
    return null;
  }
}

async function createSubscription(
  db,
  studentId,
  packageId,
  circleId,
  trialDays = 3
) {
  const existing = await getActiveSubscription(
    db,
    studentId,
    packageId,
    circleId
  );

  if (existing) {
    return existing;
  }

  const start = new Date();
  const days = Math.max(0, Number(trialDays || 0));
  const end = new Date(start);

  if (days > 0) {
    end.setDate(end.getDate() + days);
  }

  return db
    .prepare(`
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
    `)
    .bind(
      studentId,
      packageId,
      circleId,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
      days > 0 ? "trial" : "active",
      days > 0 ? end.toISOString() : null,
      now()
    )
    .first();
}

/* =========================================================
   Permissions
========================================================= */

async function getUser(db, userId) {
  if (!userId) return null;

  return db
    .prepare(`
      SELECT id, role, status
      FROM users
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(userId)
    .first();
}

async function canDecide(db, userId) {
  const user = await getUser(db, userId);

  return Boolean(
    user &&
    user.status === "active" &&
    ["admin", "supervisor"].includes(user.role)
  );
}

/* =========================================================
   Circle Status
========================================================= */

async function refreshCircleStatus(db, circleId) {
  const circle = await getCircle(db, circleId);

  if (!circle) {
    return null;
  }

  const capacity = Number(circle.capacity || 0);
  const count = await enrollmentCount(db, circleId);

  let status = String(circle.status || "active");

  if (capacity > 0 && count >= capacity) {
    status = "full";
  } else if (status === "full") {
    status = "active";
  }

  await db
    .prepare(`
      UPDATE circles
      SET status = ?2,
          updated_at = ?3
      WHERE id = ?1
    `)
    .bind(circleId, status, now())
    .run();

  return {
    ...circle,
    status,
    enrollment_count: count,
    capacity,
  };
}

/* =========================================================
   Enrollment
========================================================= */

async function activateEnrollment(
  db,
  studentId,
  circleId,
  joinedVia = "direct"
) {
  const existing = await getEnrollment(
    db,
    studentId,
    circleId
  );

  if (existing) {
    if (isActiveEnrollmentStatus(existing.status)) {
      return existing;
    }

    return db
      .prepare(`
        UPDATE circle_enrollments
        SET
          status = 'active',
          start_date = ?3,
          end_date = NULL,
          joined_via = ?4,
          updated_at = ?5
        WHERE student_id = ?1
          AND circle_id = ?2
        RETURNING *
      `)
      .bind(
        studentId,
        circleId,
        today(),
        joinedVia,
        now()
      )
      .first();
  }

  return db
    .prepare(`
      INSERT INTO circle_enrollments (
        circle_id,
        student_id,
        start_date,
        end_date,
        status,
        joined_via,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        NULL,
        'active',
        ?4,
        NULL,
        ?5,
        ?5
      )
      RETURNING *
    `)
    .bind(
      circleId,
      studentId,
      today(),
      joinedVia,
      now()
    )
    .first();
}

/* =========================================================
   Move Request
========================================================= */

async function moveRequestToNewCircle(
  db,
  studentId,
  oldCircleId,
  newCircleId
) {
  const request = await db
    .prepare(`
      SELECT *
      FROM enrollment_requests
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status IN ('pending', 'introductory')
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(studentId, oldCircleId)
    .first();

  if (!request) {
    return null;
  }

  await db
    .prepare(`
      UPDATE enrollment_requests
      SET
        circle_id = ?2,
        notes = ?3
      WHERE id = ?1
    `)
    .bind(
      request.id,
      newCircleId,
      "تم نقل الطالب إلى الحلقة الجديدة بعد اكتمال الحلقة الأصلية."
    )
    .run();

  return request.id;
}

/* =========================================================
   Notifications
========================================================= */

async function notifyAdmins(
  db,
  title,
  message
) {
  try {
    await db
      .prepare(`
        INSERT INTO notifications (
          user_id,
          type,
          title,
          message,
          created_at
        )
        SELECT
          id,
          'enrollment_system',
          ?1,
          ?2,
          ?3
        FROM users
        WHERE role = 'admin'
          AND status = 'active'
      `)
      .bind(title, message, now())
      .run();
  } catch (error) {
    console.error("Admin notification error:", error);
  }
}

async function notifyStudent(
  db,
  studentId,
  title,
  message
) {
  try {
    const student = await getStudent(db, studentId);

    if (!student?.user_id) {
      return;
    }

    await db
      .prepare(`
        INSERT INTO notifications (
          user_id,
          type,
          title,
          message,
          created_at
        )
        VALUES (
          ?1,
          'enrollment',
          ?2,
          ?3,
          ?4
        )
      `)
      .bind(
        student.user_id,
        title,
        message,
        now()
      )
      .run();
  } catch (error) {
    console.error("Student notification error:", error);
  }
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
    await db
      .prepare(`
        INSERT INTO audit_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          details,
          created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `)
      .bind(
        userId || null,
        action,
        entityType,
        entityId,
        JSON.stringify(details || {}),
        now()
      )
      .run();
  } catch (error) {
    console.error("Audit error:", error);
  }
}

/* =========================================================
   Generate Circle Name
========================================================= */

async function generateNewCircleName(db, originalCircle) {
  const baseName =
    String(originalCircle.name || "الحلقة").trim();

  const result = await db
    .prepare(`
      SELECT name
      FROM circles
      WHERE name LIKE ?1
      ORDER BY id DESC
    `)
    .bind(`${baseName}%`)
    .all();

  const names = result?.results || [];

  let number = 2;

  while (
    names.some(
      row =>
        String(row.name || "").trim() ===
        `${baseName} ${number}`
    )
  ) {
    number++;
  }

  return `${baseName} ${number}`;
}

/* =========================================================
   Create New Group Circle
========================================================= */

async function createNewGroupCircle(
  db,
  originalCircle,
  packageId,
  reason = "امتلاء قائمة الانتظار"
) {
  const type = normalizeCircleType(
    originalCircle.circle_type
  );

  if (type !== "group") {
    return null;
  }

  const capacity = Number(
    originalCircle.capacity || 0
  );

  if (capacity <= 0) {
    return null;
  }

  const waiting = await waitlistCount(
    db,
    originalCircle.id
  );

  if (waiting < capacity) {
    return null;
  }

  const name = await generateNewCircleName(
    db,
    originalCircle
  );

  const result = await db
    .prepare(`
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
      RETURNING *
    `)
    .bind(
      name,
      originalCircle.teacher_id || null,
      packageId || originalCircle.package_id || null,
      capacity,
      originalCircle.schedule_note || null,
      originalCircle.level_name || null,
      originalCircle.path_name || null,
      now()
    )
    .first();

  if (!result) {
    return null;
  }

  await audit(
    db,
    null,
    "new_group_circle_created",
    "circle",
    result.id,
    {
      original_circle_id: originalCircle.id,
      original_circle_name: originalCircle.name,
      new_circle_id: result.id,
      new_circle_name: result.name,
      reason,
    }
  );

  await notifyAdmins(
    db,
    "تم إنشاء حلقة جماعية جديدة",
    `تم إنشاء "${result.name}" بسبب ${reason}.`
  );

  return result;
}

/* =========================================================
   Move Waitlist To New Circle
========================================================= */

async function moveWaitlistStudents(
  db,
  originalCircle,
  newCircle,
  packageId,
  trialDays = 3
) {
  const capacity = Number(
    newCircle.capacity || 0
  );

  if (capacity <= 0) {
    return [];
  }

  const result = await db
    .prepare(`
      SELECT *
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY position ASC, id ASC
      LIMIT ?2
    `)
    .bind(
      originalCircle.id,
      capacity
    )
    .all();

  const waiting = result?.results || [];
  const moved = [];

  for (const item of waiting) {
    const student = await getStudent(
      db,
      item.student_id
    );

    if (!student || student.status !== "active") {
      await db
        .prepare(`
          UPDATE circle_waitlist
          SET status = 'cancelled'
          WHERE id = ?1
        `)
        .bind(item.id)
        .run();

      continue;
    }

    const enrollment = await activateEnrollment(
      db,
      item.student_id,
      newCircle.id,
      "waitlist"
    );

    const subscription = packageId
      ? await createSubscription(
          db,
          item.student_id,
          packageId,
          newCircle.id,
          trialDays
        )
      : null;

    await moveRequestToNewCircle(
      db,
      item.student_id,
      originalCircle.id,
      newCircle.id
    );

    await db
      .prepare(`
        UPDATE circle_waitlist
        SET status = 'accepted'
        WHERE id = ?1
      `)
      .bind(item.id)
      .run();

    await notifyStudent(
      db,
      item.student_id,
      "تم قبول تسجيلك",
      `تم نقلك إلى الحلقة الجديدة "${newCircle.name}".`
    );

    await audit(
      db,
      null,
      "waitlist_student_moved",
      "circle_enrollment",
      enrollment?.id || null,
      {
        student_id: item.student_id,
        old_circle_id: originalCircle.id,
        new_circle_id: newCircle.id,
        waitlist_id: item.id,
      }
    );

    moved.push({
      student_id: item.student_id,
      enrollment,
      subscription,
    });
  }

  await normalizeWaitlist(
    db,
    originalCircle.id
  );

  await refreshCircleStatus(
    db,
    originalCircle.id
  );

  await refreshCircleStatus(
    db,
    newCircle.id
  );

  return moved;
}

/* =========================================================
   Promote Waiting Student
========================================================= */

async function promoteNextWaiting(
  db,
  circle,
  packageId,
  trialDays = 3
) {
  const capacity = Number(
    circle.capacity || 0
  );

  if (capacity <= 0) {
    return null;
  }

  const count = await enrollmentCount(
    db,
    circle.id
  );

  if (count >= capacity) {
    await refreshCircleStatus(
      db,
      circle.id
    );

    return null;
  }

  const row = await db
    .prepare(`
      SELECT *
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY position ASC, id ASC
      LIMIT 1
    `)
    .bind(circle.id)
    .first();

  if (!row) {
    return null;
  }

  const student = await getStudent(
    db,
    row.student_id
  );

  if (!student || student.status !== "active") {
    await db
      .prepare(`
        UPDATE circle_waitlist
        SET status = 'cancelled'
        WHERE id = ?1
      `)
      .bind(row.id)
      .run();

    await normalizeWaitlist(
      db,
      circle.id
    );

    return promoteNextWaiting(
      db,
      circle,
      packageId,
      trialDays
    );
  }

  const enrollment = await activateEnrollment(
    db,
    row.student_id,
    circle.id,
    "waitlist"
  );

  const subscription = packageId
    ? await createSubscription(
        db,
        row.student_id,
        packageId,
        circle.id,
        trialDays
      )
    : null;

  await db
    .prepare(`
      UPDATE circle_waitlist
      SET status = 'accepted'
      WHERE id = ?1
    `)
    .bind(row.id)
    .run();

  const request = await getPendingRequest(
    db,
    row.student_id,
    circle.id
  );

  if (request) {
    await db
      .prepare(`
        UPDATE enrollment_requests
        SET status = 'approved'
        WHERE id = ?1
      `)
      .bind(request.id)
      .run();

    await createDecision(
      db,
      request.id,
      row.student_id,
      circle.id,
      "approved",
      "تمت الترقية من قائمة الانتظار.",
      null
    );
  }

  await notifyStudent(
    db,
    row.student_id,
    "تم قبول تسجيلك",
    `تمت ترقيتك من قائمة الانتظار إلى الحلقة "${circle.name}".`
  );

  await normalizeWaitlist(
    db,
    circle.id
  );

  await refreshCircleStatus(
    db,
    circle.id
  );

  return {
    student_id: row.student_id,
    enrollment,
    subscription,
  };
}

/* =========================================================
   POST
========================================================= */

async function handlePost(request, env) {
  const db = env.DB;
  const data = await body(request);

  if (!data) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON",
      },
      400
    );
  }

  const studentId =
    data.student_id ||
    data.studentId;

  const circleId =
    data.circle_id ||
    data.circleId;

  const packageId =
    data.package_id ||
    data.packageId ||
    null;

  if (!studentId || !circleId) {
    return json(
      {
        ok: false,
        error: "student_id_and_circle_id_required",
      },
      400
    );
  }

  const student = await getStudent(
    db,
    studentId
  );

  if (!student) {
    return json(
      {
        ok: false,
        error: "student_not_found",
      },
      404
    );
  }

  if (student.status !== "active") {
    return json(
      {
        ok: false,
        error: "student_not_active",
      },
      400
    );
  }

  const circle = await getCircle(
    db,
    circleId
  );

  if (!circle) {
    return json(
      {
        ok: false,
        error: "circle_not_found",
      },
      404
    );
  }

  const circleType = normalizeCircleType(
    circle.circle_type
  );

  const pkg = packageId
    ? await getPackage(db, packageId)
    : null;

  if (packageId && !pkg) {
    return json(
      {
        ok: false,
        error: "package_not_found",
      },
      404
    );
  }

  const existing = await getEnrollment(
    db,
    studentId,
    circleId
  );

  if (
    existing &&
    isActiveEnrollmentStatus(existing.status)
  ) {
    return json({
      ok: true,
      already_enrolled: true,
      enrollment: existing,
    });
  }

  const policy = await getPolicy(
    db,
    circleId,
    packageId
  );

  if (policy?.enabled === 0) {
    return json(
      {
        ok: false,
        error: "enrollment_disabled",
      },
      403
    );
  }

  if (packageId) {
    const rule = await getPackageCircleRule(
      db,
      packageId,
      circleType
    );

    if (
      rule &&
      rule.enabled === 0
    ) {
      return json(
        {
          ok: false,
          error: "package_not_allowed_for_circle",
        },
        403
      );
    }
  }

  const capacity = Number(
    circle.capacity || 0
  );

  const count = await enrollmentCount(
    db,
    circle.id
  );

  /* ---------------------------------------------------------
     Individual
  --------------------------------------------------------- */

  if (circleType === "individual") {
    if (
      capacity > 0 &&
      count >= capacity
    ) {
      return json(
        {
          ok: false,
          error: "circle_full",
          circle_status: "full",
          capacity,
          enrollment_count: count,
        },
        409
      );
    }

    const enrollment = await activateEnrollment(
      db,
      studentId,
      circleId,
      "direct"
    );

    const trialDays = Number(
      data.trial_days ??
      policy?.trial_days ??
      3
    );

    const subscription = packageId
      ? await createSubscription(
          db,
          studentId,
          packageId,
          circleId,
          trialDays
        )
      : null;

    const requestRow =
      await getPendingRequest(
        db,
        studentId,
        circleId
      );

    if (requestRow) {
      await db
        .prepare(`
          UPDATE enrollment_requests
          SET status = 'approved'
          WHERE id = ?1
        `)
        .bind(requestRow.id)
        .run();

      await createDecision(
        db,
        requestRow.id,
        studentId,
        circleId,
        "approved",
        "تم قبول التسجيل الفردي.",
        data.decided_by || null
      );
    }

    const status = await refreshCircleStatus(
      db,
      circleId
    );

    return json({
      ok: true,
      type: "individual",
      enrollment,
      subscription,
      circle: status,
    });
  }

  /* ---------------------------------------------------------
     Group
  --------------------------------------------------------- */

  if (circleType !== "group") {
    return json(
      {
        ok: false,
        error: "unsupported_circle_type",
      },
      400
    );
  }

  if (
    capacity <= 0
  ) {
    return json(
      {
        ok: false,
        error: "circle_capacity_not_configured",
      },
      400
    );
  }

  /* الحلقة ممتلئة */
  if (count >= capacity) {
    const requestRow = await getPendingRequest(
      db,
      studentId,
      circleId
    );

    const waitlist = await addWaitlist(
      db,
      studentId,
      circleId
    );

    await refreshCircleStatus(
      db,
      circleId
    );

    /* عند بلوغ عدد المنتظرين سعة المجموعة:
       أنشئ مجموعة جديدة وانقل الطلاب */
    const waitingCount = await waitlistCount(
      db,
      circleId
    );

    let newCircle = null;
    let moved = [];

    if (waitingCount >= capacity) {
      newCircle = await createNewGroupCircle(
        db,
        circle,
        packageId || circle.package_id,
        "بلوغ قائمة الانتظار سعة الحلقة الأصلية"
      );

      if (newCircle) {
        moved = await moveWaitlistStudents(
          db,
          circle,
          newCircle,
          packageId || circle.package_id,
          Number(
            data.trial_days ??
            policy?.trial_days ??
            3
          )
        );
      }
    }

    return json(
      {
        ok: true,
        queued: true,
        circle_status: "full",
        waitlist,
        new_circle: newCircle,
        moved_students: moved,
      },
      202
    );
  }

  /* يوجد مكان */
  const enrollment = await activateEnrollment(
    db,
    studentId,
    circleId,
    "direct"
  );

  const trialDays = Number(
    data.trial_days ??
    policy?.trial_days ??
    3
  );

  const subscription = packageId
    ? await createSubscription(
        db,
        studentId,
        packageId,
        circleId,
        trialDays
      )
    : null;

  const requestRow =
    await getPendingRequest(
      db,
      studentId,
      circleId
    );

  if (requestRow) {
    await db
      .prepare(`
        UPDATE enrollment_requests
        SET status = 'approved'
        WHERE id = ?1
      `)
      .bind(requestRow.id)
      .run();

    await createDecision(
      db,
      requestRow.id,
      studentId,
      circleId,
      "approved",
      "تم قبول التسجيل الجماعي لوجود مكان.",
      data.decided_by || null
    );
  }

  const status = await refreshCircleStatus(
    db,
    circleId
  );

  return json({
    ok: true,
    type: "group",
    enrollment,
    subscription,
    circle: status,
  });
}

/* =========================================================
   GET
========================================================= */

async function handleGet(request, env) {
  const db = env.DB;
  const url = new URL(request.url);

  const studentId =
    url.searchParams.get("student_id") ||
    url.searchParams.get("studentId");

  const circleId =
    url.searchParams.get("circle_id") ||
    url.searchParams.get("circleId");

  const status =
    url.searchParams.get("status");

  if (circleId) {
    const circle = await getCircle(
      db,
      circleId
    );

    if (!circle) {
      return json(
        {
          ok: false,
          error: "circle_not_found",
        },
        404
      );
    }

    let sql = `
      SELECT
        ce.*,
        s.name AS student_name,
        s.phone AS student_phone
      FROM circle_enrollments ce
      LEFT JOIN students s
        ON s.id = ce.student_id
      WHERE ce.circle_id = ?1
    `;

    const params = [circleId];

    if (status) {
      sql += ` AND ce.status = ?2`;
      params.push(status);
    }

    sql += ` ORDER BY ce.id ASC`;

    const result = await db
      .prepare(sql)
      .bind(...params)
      .all();

    const waiting = await db
      .prepare(`
        SELECT
          cw.*,
          s.name AS student_name,
          s.phone AS student_phone
        FROM circle_waitlist cw
        LEFT JOIN students s
          ON s.id = cw.student_id
        WHERE cw.circle_id = ?1
          AND cw.status = 'waiting'
        ORDER BY cw.position ASC, cw.id ASC
      `)
      .bind(circleId)
      .all();

    return json({
      ok: true,
      circle,
      enrollment_count: await enrollmentCount(
        db,
        circleId
      ),
      capacity: Number(
        circle.capacity || 0
      ),
      enrollments:
        result?.results || [],
      waitlist:
        waiting?.results || [],
      waitlist_count:
        Number(
          waiting?.results?.length || 0
        ),
    });
  }

  if (studentId) {
    const result = await db
      .prepare(`
        SELECT
          ce.*,
          c.name AS circle_name,
          c.circle_type,
          c.capacity,
          c.status AS circle_status,
          c.teacher_id,
          p.name AS package_name
        FROM circle_enrollments ce
        LEFT JOIN circles c
          ON c.id = ce.circle_id
        LEFT JOIN packages p
          ON p.id = c.package_id
        WHERE ce.student_id = ?1
        ORDER BY ce.id DESC
      `)
      .bind(studentId)
      .all();

    const waitlist = await db
      .prepare(`
        SELECT
          cw.*,
          c.name AS circle_name,
          c.circle_type
        FROM circle_waitlist cw
        LEFT JOIN circles c
          ON c.id = cw.circle_id
        WHERE cw.student_id = ?1
          AND cw.status = 'waiting'
        ORDER BY cw.position ASC
      `)
      .bind(studentId)
      .all();

    return json({
      ok: true,
      student_id: studentId,
      enrollments:
        result?.results || [],
      waitlist:
        waitlist?.results || [],
    });
  }

  const result = await db
    .prepare(`
      SELECT
        ce.*,
        s.name AS student_name,
        c.name AS circle_name,
        c.circle_type,
        c.capacity,
        c.status AS circle_status
      FROM circle_enrollments ce
      LEFT JOIN students s
        ON s.id = ce.student_id
      LEFT JOIN circles c
        ON c.id = ce.circle_id
      ORDER BY ce.id DESC
    `)
    .all();

  return json({
    ok: true,
    enrollments:
      result?.results || [],
  });
}

/* =========================================================
   PATCH
========================================================= */

async function handlePatch(request, env) {
  const db = env.DB;
  const data = await body(request);

  if (!data) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON",
      },
      400
    );
  }

  const actorId =
    data.user_id ||
    data.userId ||
    data.decided_by ||
    null;

  if (!(await canDecide(db, actorId))) {
    return json(
      {
        ok: false,
        error: "ADMIN_OR_SUPERVISOR_REQUIRED",
      },
      403
    );
  }

  const circleId =
    data.circle_id ||
    data.circleId;

  if (!circleId) {
    return json(
      {
        ok: false,
        error: "circle_id_required",
      },
      400
    );
  }

  const circle = await getCircle(
    db,
    circleId
  );

  if (!circle) {
    return json(
      {
        ok: false,
        error: "circle_not_found",
      },
      404
    );
  }

  const capacityProvided =
    data.capacity !== undefined;

  if (capacityProvided) {
    const capacity = positiveInt(
      data.capacity,
      -1
    );

    if (capacity < 0) {
      return json(
        {
          ok: false,
          error: "invalid_capacity",
        },
        400
      );
    }

    await db
      .prepare(`
        UPDATE circles
        SET
          capacity = ?2,
          updated_at = ?3
        WHERE id = ?1
      `)
      .bind(
        circleId,
        capacity,
        now()
      )
      .run();
  }

  const refreshed = await refreshCircleStatus(
    db,
    circleId
  );

  const capacity = Number(
    refreshed?.capacity || 0
  );

  let promoted = [];

  if (capacity > 0) {
    while (
      (await enrollmentCount(db, circleId)) <
        capacity &&
      (await waitlistCount(db, circleId)) > 0
    ) {
      const item = await promoteNextWaiting(
        db,
        refreshed,
        refreshed.package_id || null,
        3
      );

      if (!item) break;

      promoted.push(item);
    }
  }

  let newCircle = null;
  let moved = [];

  if (
    normalizeCircleType(
      refreshed?.circle_type
    ) === "group" &&
    capacity > 0
  ) {
    const waiting = await waitlistCount(
      db,
      circleId
    );

    if (
      waiting >= capacity
    ) {
      newCircle = await createNewGroupCircle(
        db,
        refreshed,
        refreshed.package_id || null,
        "اكتمال قائمة الانتظار بعد تعديل السعة"
      );

      if (newCircle) {
        moved = await moveWaitlistStudents(
          db,
          refreshed,
          newCircle,
          refreshed.package_id || null,
          3
        );
      }
    }
  }

  await audit(
    db,
    actorId,
    "circle_enrollment_capacity_updated",
    "circle",
    circleId,
    {
      old_capacity:
        Number(circle.capacity || 0),
      new_capacity: capacity,
      promoted_count:
        promoted.length,
      moved_count:
        moved.length,
      new_circle_id:
        newCircle?.id || null,
    }
  );

  return json({
    ok: true,
    circle:
      await refreshCircleStatus(
        db,
        circleId
      ),
    promoted,
    new_circle: newCircle,
    moved_students: moved,
  });
}

/* =========================================================
   Router
========================================================= */

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;

  try {
    switch (request.method.toUpperCase()) {
      case "POST":
        return await handlePost(
          request,
          env
        );

      case "GET":
        return await handleGet(
          request,
          env
        );

      case "PATCH":
        return await handlePatch(
          request,
          env
        );

      default:
        return json(
          {
            ok: false,
            error: "METHOD_NOT_ALLOWED",
          },
          405
        );
    }
  } catch (error) {
    console.error(
      "Enrollment API error:",
      error
    );

    return json(
      {
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
        message:
          error?.message ||
          "حدث خطأ غير متوقع.",
      },
      500
    );
  }
}
