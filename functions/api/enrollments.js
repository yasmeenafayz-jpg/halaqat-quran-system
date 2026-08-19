enrollments.js

/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
 *
 * القواعد:
 * - التسجيل الفردي والجماعي.
 * - الفردية يمكن أن تضم العدد الذي تحدده الإدارة.
 * - الجماعية لها سعة محددة.
 * - عند اكتمال الجماعية يضاف الطالب إلى قائمة الانتظار.
 * - قائمة الانتظار مرتبة حسب أولوية التسجيل.
 * - عند وجود مكان شاغر يمكن ترقية أول منتظر.
 * - الترقية من قائمة الانتظار تتم بقرار إداري.
 * - عند بلوغ قائمة الانتظار سعة الحلقة يتم إنشاء حلقة جديدة.
 * - لا يتم نقل الطلاب للحلقة الجديدة تلقائيًا.
 * - يتم إشعار الإدارة بإنشاء الحلقة الجديدة.
 * - عند زيادة السعة تتم ترقية المنتظرين حسب الترتيب.
 * - عند امتلاء الحلقة تصبح حالتها full.
 * - عند توفر مكان تصبح active.
 *
 * لا يحتوي هذا الملف على:
 * - إنشاء اشتراكات.
 * - تجربة مجانية 3 أيام.
 * - منطق الدفع.
 *
 * هذه الأمور لها نظام مستقل.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

/* =========================================================
   Basic
========================================================= */

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

function normalizeCircleType(value) {
  const type = String(value || "")
    .trim()
    .toLowerCase();

  if (
    ["group", "جماعية", "جماعي"].includes(type)
  ) {
    return "group";
  }

  if (
    ["individual", "فردية", "فردي"].includes(type)
  ) {
    return "individual";
  }

  return type;
}

function isEnrollmentActive(status) {
  return [
    "pending",
    "active",
    "paused",
  ].includes(
    String(status || "").toLowerCase()
  );
}

function toCapacity(value) {
  const n = Number(value);

  if (
    !Number.isInteger(n) ||
    n < 0
  ) {
    return null;
  }

  return n;
}

/* =========================================================
   Basic Queries
========================================================= */

async function getStudent(db, id) {
  if (!id) return null;

  return db.prepare(`
    SELECT *
    FROM students
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getCircle(db, id) {
  if (!id) return null;

  return db.prepare(`
    SELECT *
    FROM circles
    WHERE id = ?1
    LIMIT 1
  `).bind(id).first();
}

async function getPackage(db, id) {
  if (!id) return null;

  try {
    return await db.prepare(`
      SELECT *
      FROM packages
      WHERE id = ?1
      LIMIT 1
    `).bind(id).first();
  } catch {
    return null;
  }
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
  `).bind(circleId).first();

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
  `).bind(circleId).first();

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
  try {
    return await db.prepare(`
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
    `).bind(
      circleId,
      packageId
    ).first();
  } catch {
    return null;
  }
}

async function getPackageCircleRule(
  db,
  packageId,
  circleType
) {
  if (!packageId) {
    return null;
  }

  try {
    return await db.prepare(`
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
  } catch {
    return null;
  }
}

/* =========================================================
   Enrollment Requests
========================================================= */

async function getPendingRequest(
  db,
  studentId,
  circleId
) {
  try {
    return await db.prepare(`
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
  } catch {
    return null;
  }
}

async function createRequest(
  db,
  studentId,
  circleId,
  requestType,
  status = "pending",
  notes = null
) {
  return db.prepare(`
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
    circleId,
    requestType,
    status,
    now(),
    notes
  ).first();
}

/* =========================================================
   Enrollment Decisions
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
  try {
    return await db.prepare(`
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
      requestId,
      studentId,
      circleId,
      decision,
      reason,
      decidedBy,
      now()
    ).first();
  } catch (error) {
    console.error(
      "Decision error:",
      error
    );

    return null;
  }
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

  const positionRow =
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
      positionRow?.position || 1
    ),
    now()
  ).first();
}

async function normalizeWaitlist(
  db,
  circleId
) {
  const result =
    await db.prepare(`
      SELECT id
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY
        position ASC,
        id ASC
    `).bind(
      circleId
    ).all();

  const rows =
    result?.results || [];

  for (
    let index = 0;
    index < rows.length;
    index++
  ) {
    await db.prepare(`
      UPDATE circle_waitlist
      SET position = ?2
      WHERE id = ?1
    `).bind(
      rows[index].id,
      index + 1
    ).run();
  }
}

/* =========================================================
   Users / Permissions
========================================================= */

async function getUser(
  db,
  userId
) {
  if (!userId) {
    return null;
  }

  try {
    return await db.prepare(`
      SELECT
        id,
        role,
        status
      FROM users
      WHERE id = ?1
      LIMIT 1
    `).bind(
      userId
    ).first();
  } catch {
    return null;
  }
}

async function isAdminOrSupervisor(
  db,
  userId
) {
  const user =
    await getUser(
      db,
      userId
    );

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
   Notifications
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
    `).bind(
      title,
      message,
      now()
    ).run();
  } catch (error) {
    console.error(
      "Admin notification error:",
      error
    );
  }
}

async function notifyStudent(
  db,
  studentId,
  title,
  message
) {
  try {
    const student =
      await getStudent(
        db,
        studentId
      );

    if (!student?.user_id) {
      return;
    }

    await db.prepare(`
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
    `).bind(
      student.user_id,
      title,
      message,
      now()
    ).run();
  } catch (error) {
    console.error(
      "Student notification error:",
      error
    );
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
  details = {}
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
      entityId,
      JSON.stringify(details),
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
   Circle Status
========================================================= */

async function refreshCircleStatus(
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

  const capacity =
    Number(circle.capacity || 0);

  const count =
    await enrollmentCount(
      db,
      circleId
    );

  let status =
    String(
      circle.status || "active"
    );

  if (
    capacity > 0 &&
    count >= capacity
  ) {
    status = "full";
  } else if (
    status === "full"
  ) {
    status = "active";
  }

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

  return {
    ...circle,
    status,
    capacity,
    enrollment_count: count,
  };
}

/* =========================================================
   Enrollment Creation
========================================================= */

async function activateEnrollment(
  db,
  studentId,
  circleId,
  joinedVia = "direct"
) {
  const existing =
    await getEnrollment(
      db,
      studentId,
      circleId
    );

  if (existing) {
    if (
      isEnrollmentActive(
        existing.status
      )
    ) {
      return existing;
    }

    return db.prepare(`
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
    `).bind(
      studentId,
      circleId,
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
  `).bind(
    circleId,
    studentId,
    today(),
    joinedVia,
    now()
  ).first();
}

/* =========================================================
   Generate New Circle Name
========================================================= */

async function generateNewCircleName(
  db,
  originalCircle
) {
  const base =
    String(
      originalCircle.name ||
      "الحلقة"
    ).trim();

  const result =
    await db.prepare(`
      SELECT name
      FROM circles
      WHERE name LIKE ?1
      ORDER BY id DESC
    `).bind(
      `${base}%`
    ).all();

  const names =
    result?.results || [];

  let number = 2;

  while (
    names.some(
      row =>
        String(
          row.name || ""
        ).trim() ===
        `${base} ${number}`
    )
  ) {
    number++;
  }

  return `${base} ${number}`;
}

/* =========================================================
   Create New Group Circle
   IMPORTANT:
   لا يتم نقل الطلاب تلقائيًا.
========================================================= */

async function createNewGroupCircle(
  db,
  originalCircle,
  packageId,
  reason
) {
  if (
    normalizeCircleType(
      originalCircle.circle_type
    ) !== "group"
  ) {
    return null;
  }

  const capacity =
    Number(
      originalCircle.capacity || 0
    );

  if (capacity <= 0) {
    return null;
  }

  const waiting =
    await waitlistCount(
      db,
      originalCircle.id
    );

  if (
    waiting < capacity
  ) {
    return null;
  }

  const name =
    await generateNewCircleName(
      db,
      originalCircle
    );

  const newCircle =
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
      RETURNING *
    `).bind(
      name,
      originalCircle.teacher_id || null,
      packageId ||
        originalCircle.package_id ||
        null,
      capacity,
      originalCircle.schedule_note ||
        null,
      originalCircle.level_name ||
        null,
      originalCircle.path_name ||
        null,
      now()
    ).first();

  if (!newCircle) {
    return null;
  }

  await audit(
    db,
    null,
    "new_group_circle_created",
    "circle",
    newCircle.id,
    {
      original_circle_id:
        originalCircle.id,

      original_circle_name:
        originalCircle.name,

      new_circle_id:
        newCircle.id,

      new_circle_name:
        newCircle.name,

      capacity,
      waiting_count:
        waiting,

      reason,
    }
  );

  await notifyAdmins(
    db,
    "حلقة جماعية جديدة تحتاج اعتمادًا",
    `تم تجهيز الحلقة "${newCircle.name}" `
    + `بسبب ${reason}. `
    + `عدد المنتظرين: ${waiting}. `
    + `السعة: ${capacity}. `
    + `لم يتم نقل أي طالب تلقائيًا.`
  );

  return newCircle;
}

/* =========================================================
   Promote First Waiting Student
   الترقية لا تتم إلا بعد قرار إداري.
========================================================= */

async function promoteNextWaiting(
  db,
  circle,
  actorId,
  reason = "ترقية من قائمة الانتظار"
) {
  const capacity =
    Number(circle.capacity || 0);

  if (capacity <= 0) {
    return null;
  }

  const count =
    await enrollmentCount(
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

  const waiting =
    await db.prepare(`
      SELECT *
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY
        position ASC,
        id ASC
      LIMIT 1
    `).bind(
      circle.id
    ).first();

  if (!waiting) {
    return null;
  }

  const student =
    await getStudent(
      db,
      waiting.student_id
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
      waiting.id
    ).run();

    await normalizeWaitlist(
      db,
      circle.id
    );

    return promoteNextWaiting(
      db,
      circle,
      actorId,
      reason
    );
  }

  const enrollment =
    await activateEnrollment(
      db,
      waiting.student_id,
      circle.id,
      "waitlist"
    );

  await db.prepare(`
    UPDATE circle_waitlist
    SET status = 'accepted'
    WHERE id = ?1
  `).bind(
    waiting.id
  ).run();

  const request =
    await getPendingRequest(
      db,
      waiting.student_id,
      circle.id
    );

  if (request) {
    await db.prepare(`
      UPDATE enrollment_requests
      SET status = 'approved'
      WHERE id = ?1
    `).bind(
      request.id
    ).run();

    await createDecision(
      db,
      request.id,
      waiting.student_id,
      circle.id,
      "approved",
      reason,
      actorId
    );
  }

  await notifyStudent(
    db,
    waiting.student_id,
    "تم قبول تسجيلك",
    `تمت ترقيتك من قائمة الانتظار `
    + `إلى الحلقة "${circle.name}".`
  );

  await audit(
    db,
    actorId,
    "waitlist_student_promoted",
    "circle_enrollment",
    enrollment?.id || null,
    {
      student_id:
        waiting.student_id,

      circle_id:
        circle.id,

      waitlist_id:
        waiting.id,

      reason,
    }
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
    student_id:
      waiting.student_id,

    enrollment,
  };
}

/* =========================================================
   POST
========================================================= */

async function handlePost(
  request,
  env
) {
  const db = env.DB;
  const data = await body(request);

  if (!db) {
    return json(
      {
        ok: false,
        error: "DB_NOT_CONFIGURED",
      },
      500
    );
  }

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

  if (
    !studentId ||
    !circleId
  ) {
    return json(
      {
        ok: false,
        error:
          "student_id_and_circle_id_required",
      },
      400
    );
  }

  const student =
    await getStudent(
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

  if (
    student.status !== "active"
  ) {
    return json(
      {
        ok: false,
        error: "student_not_active",
      },
      400
    );
  }

  const circle =
    await getCircle(
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

  const circleType =
    normalizeCircleType(
      circle.circle_type
    );

  if (
    ![
      "individual",
      "group",
    ].includes(circleType)
  ) {
    return json(
      {
        ok: false,
        error:
          "unsupported_circle_type",
      },
      400
    );
  }

  if (packageId) {
    const pkg =
      await getPackage(
        db,
        packageId
      );

    if (!pkg) {
      return json(
        {
          ok: false,
          error:
            "package_not_found",
        },
        404
      );
    }

    const rule =
      await getPackageCircleRule(
        db,
        packageId,
        circleType
      );

    if (
      rule &&
      Number(rule.enabled) === 0
    ) {
      return json(
        {
          ok: false,
          error:
            "package_not_allowed_for_circle",
        },
        403
      );
    }
  }

  const policy =
    await getPolicy(
      db,
      circleId,
      packageId
    );

  const existing =
    await getEnrollment(
      db,
      studentId,
      circleId
    );

  if (
    existing &&
    isEnrollmentActive(
      existing.status
    )
  ) {
    return json({
      ok: true,
      already_enrolled: true,
      enrollment: existing,
    });
  }

  const capacity =
    Number(
      circle.capacity || 0
    );

  const count =
    await enrollmentCount(
      db,
      circleId
    );

  /* =======================================================
     Individual
  ======================================================= */

  if (
    circleType === "individual"
  ) {
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
          enrollment_count:
            count,
        },
        409
      );
    }

    const enrollment =
      await activateEnrollment(
        db,
        studentId,
        circleId,
        "direct"
      );

    const requestRow =
      await getPendingRequest(
        db,
        studentId,
        circleId
      );

    if (requestRow) {
      await db.prepare(`
        UPDATE enrollment_requests
        SET status = 'approved'
        WHERE id = ?1
      `).bind(
        requestRow.id
      ).run();

      await createDecision(
        db,
        requestRow.id,
        studentId,
        circleId,
        "approved",
        "تم قبول التسجيل الفردي.",
        data.decided_by ||
          data.decidedBy ||
          null
      );
    }

    const status =
      await refreshCircleStatus(
        db,
        circleId
      );

    return json({
      ok: true,
      type: "individual",
      enrollment,
      circle: status,
    });
  }

  /* =======================================================
     Group
  ======================================================= */

  if (
    capacity <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "circle_capacity_not_configured",
      },
      400
    );
  }

  /* =======================================================
     Group Full → Waitlist
  ======================================================= */

  if (
    count >= capacity
  ) {
    const requestRow =
      await getPendingRequest(
        db,
        studentId,
        circleId
      );

    if (!requestRow) {
      await createRequest(
        db,
        studentId,
        circleId,
        "group",
        "pending",
        "تم وضع الطالب في قائمة الانتظار بسبب اكتمال السعة."
      );
    }

    const waitlist =
      await addWaitlist(
        db,
        studentId,
        circleId
      );

    await refreshCircleStatus(
      db,
      circleId
    );

    const waitingCount =
      await waitlistCount(
        db,
        circleId
      );

    let newCircle = null;

    if (
      waitingCount >= capacity
    ) {
      newCircle =
        await createNewGroupCircle(
          db,
          circle,
          packageId ||
            circle.package_id ||
            null,
          "بلوغ قائمة الانتظار سعة الحلقة الأصلية"
        );
    }

    return json(
      {
        ok: true,
        queued: true,
        circle_status: "full",
        waitlist,
        waitlist_count:
          waitingCount,
        new_circle:
          newCircle,
        students_moved:
          0,
      },
      202
    );
  }

  /* =======================================================
     Group Has Space
  ======================================================= */

  const enrollment =
    await activateEnrollment(
      db,
      studentId,
      circleId,
      "direct"
    );

  const requestRow =
    await getPendingRequest(
      db,
      studentId,
      circleId
    );

  if (requestRow) {
    await db.prepare(`
      UPDATE enrollment_requests
      SET status = 'approved'
      WHERE id = ?1
    `).bind(
      requestRow.id
    ).run();

    await createDecision(
      db,
      requestRow.id,
      studentId,
      circleId,
      "approved",
      "تم قبول التسجيل الجماعي لوجود مكان.",
      data.decided_by ||
        data.decidedBy ||
        null
    );
  }

  const status =
    await refreshCircleStatus(
      db,
      circleId
    );

  return json({
    ok: true,
    type: "group",
    enrollment,
    circle: status,
  });
}

/* =========================================================
   GET
========================================================= */

async function handleGet(
  request,
  env
) {
  const db = env.DB;
  const url =
    new URL(request.url);

  if (!db) {
    return json(
      {
        ok: false,
        error: "DB_NOT_CONFIGURED",
      },
      500
    );
  }

  const studentId =
    url.searchParams.get(
      "student_id"
    ) ||
    url.searchParams.get(
      "studentId"
    );

  const circleId =
    url.searchParams.get(
      "circle_id"
    ) ||
    url.searchParams.get(
      "circleId"
    );

  const status =
    url.searchParams.get(
      "status"
    );

  /* =======================================================
     Circle
  ======================================================= */

  if (circleId) {
    const circle =
      await getCircle(
        db,
        circleId
      );

    if (!circle) {
      return json(
        {
          ok: false,
          error:
            "circle_not_found",
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

    const params = [
      circleId,
    ];

    if (status) {
      sql += `
        AND ce.status = ?2
      `;

      params.push(status);
    }

    sql += `
      ORDER BY ce.id ASC
    `;

    const enrollments =
      await db.prepare(
        sql
      ).bind(
        ...params
      ).all();

    const waitlist =
      await db.prepare(`
        SELECT
          cw.*,
          s.name AS student_name,
          s.phone AS student_phone
        FROM circle_waitlist cw
        LEFT JOIN students s
          ON s.id = cw.student_id
        WHERE cw.circle_id = ?1
          AND cw.status = 'waiting'
        ORDER BY
          cw.position ASC,
          cw.id ASC
      `).bind(
        circleId
      ).all();

    return json({
      ok: true,

      circle,

      enrollment_count:
        await enrollmentCount(
          db,
          circleId
        ),

      capacity:
        Number(
          circle.capacity || 0
        ),

      enrollments:
        enrollments?.results ||
        [],

      waitlist:
        waitlist?.results ||
        [],

      waitlist_count:
        Number(
          waitlist?.results?.length ||
          0
        ),
    });
  }

  /* =======================================================
     Student
  ======================================================= */

  if (studentId) {
    const enrollments =
      await db.prepare(`
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
      `).bind(
        studentId
      ).all();

    const waitlist =
      await db.prepare(`
        SELECT
          cw.*,
          c.name AS circle_name,
          c.circle_type,
          c.capacity,
          c.status AS circle_status
        FROM circle_waitlist cw
        LEFT JOIN circles c
          ON c.id = cw.circle_id
        WHERE cw.student_id = ?1
          AND cw.status = 'waiting'
        ORDER BY
          cw.position ASC,
          cw.id ASC
      `).bind(
        studentId
      ).all();

    return json({
      ok: true,

      student_id:
        studentId,

      enrollments:
        enrollments?.results ||
        [],

      waitlist:
        waitlist?.results ||
        [],
    });
  }

  /* =======================================================
     All
  ======================================================= */

  const result =
    await db.prepare(`
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
    `).all();

  return json({
    ok: true,

    enrollments:
      result?.results ||
      [],
  });
}

/* =========================================================
   PATCH
   العمليات الإدارية:
   - تعديل السعة.
   - ترقية أول منتظر.
   - إنشاء الحلقة الجديدة عند بلوغ العتبة.
========================================================= */

async function handlePatch(
  request,
  env
) {
  const db = env.DB;
  const data = await body(request);

  if (!db) {
    return json(
      {
        ok: false,
        error: "DB_NOT_CONFIGURED",
      },
      500
    );
  }

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
    data.decidedBy ||
    null;

  if (
    !(await isAdminOrSupervisor(
      db,
      actorId
    ))
  ) {
    return json(
      {
        ok: false,
        error:
          "ADMIN_OR_SUPERVISOR_REQUIRED",
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
        error:
          "circle_id_required",
      },
      400
    );
  }

  const circle =
    await getCircle(
      db,
      circleId
    );

  if (!circle) {
    return json(
      {
        ok: false,
        error:
          "circle_not_found",
      },
      404
    );
  }

  const action =
    String(
      data.action ||
      ""
    ).trim().toLowerCase();

  /* =======================================================
     تعديل السعة
  ======================================================= */

  if (
    action === "set_capacity" ||
    data.capacity !== undefined
  ) {
    const newCapacity =
      toCapacity(
        data.capacity
      );

    if (
      newCapacity === null
    ) {
      return json(
        {
          ok: false,
          error:
            "invalid_capacity",
        },
        400
      );
    }

    if (
      normalizeCircleType(
        circle.circle_type
      ) === "group" &&
      newCapacity === 0
    ) {
      return json(
        {
          ok: false,
          error:
            "group_capacity_must_be_greater_than_zero",
        },
        400
      );
    }

    await db.prepare(`
      UPDATE circles
      SET
        capacity = ?2,
        updated_at = ?3
      WHERE id = ?1
    `).bind(
      circleId,
      newCapacity,
      now()
    ).run();

    const refreshed =
      await refreshCircleStatus(
        db,
        circleId
      );

    let promoted = [];

    /*
     * عند زيادة السعة:
     * الترقية تتم تلقائيًا فقط
     * بعد قرار الإدارة المرسل
     * approve_waitlist = true.
     */

    if (
      data.approve_waitlist === true
    ) {
      while (
        (await enrollmentCount(
          db,
          circleId
        )) < newCapacity &&
        (await waitlistCount(
          db,
          circleId
        )) > 0
      ) {
        const item =
          await promoteNextWaiting(
            db,
            refreshed,
            actorId,
            "تمت الترقية بعد زيادة السعة بقرار إداري."
          );

        if (!item) {
          break;
        }

        promoted.push(item);
      }
    }

    let newCircle = null;

    const waiting =
      await waitlistCount(
        db,
        circleId
      );

    if (
      normalizeCircleType(
        refreshed.circle_type
      ) === "group" &&
      newCapacity > 0 &&
      waiting >= newCapacity &&
      data.create_new_circle === true
    ) {
      newCircle =
        await createNewGroupCircle(
          db,
          refreshed,
          refreshed.package_id ||
            null,
          "بلوغ قائمة الانتظار سعة الحلقة بقرار إداري"
        );
    }

    await audit(
      db,
      actorId,
      "circle_capacity_updated",
      "circle",
      circleId,
      {
        old_capacity:
          Number(
            circle.capacity || 0
          ),

        new_capacity:
          newCapacity,

        promoted_count:
          promoted.length,

        new_circle_id:
          newCircle?.id ||
          null,
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

      new_circle:
        newCircle,
    });
  }

  /* =======================================================
     إنشاء حلقة جديدة يدويًا
  ======================================================= */

  if (
    action ===
    "create_new_circle"
  ) {
    if (
      normalizeCircleType(
        circle.circle_type
      ) !== "group"
    ) {
      return json(
        {
          ok: false,
          error:
            "new_circle_only_for_group",
        },
        400
      );
    }

    const capacity =
      Number(
        circle.capacity || 0
      );

    const waiting =
      await waitlistCount(
        db,
        circleId
      );

    if (
      capacity <= 0 ||
      waiting < capacity
    ) {
      return json(
        {
          ok: false,
          error:
            "waitlist_threshold_not_reached",

          capacity,

          waitlist_count:
            waiting,
        },
        409
      );
    }

    const newCircle =
      await createNewGroupCircle(
        db,
        circle,
        circle.package_id ||
          null,
        "طلب إداري لإنشاء حلقة جديدة"
      );

    return json({
      ok: true,

      new_circle:
        newCircle,

      students_moved:
        0,
    });
  }

  /* =======================================================
     ترقية أول منتظر
  ======================================================= */

  if (
    action ===
      "approve_waitlist" ||
    action ===
      "promote_waitlist"
  ) {
    const refreshed =
      await refreshCircleStatus(
        db,
        circleId
      );

    const promoted =
      await promoteNextWaiting(
        db,
        refreshed,
        actorId,
        data.reason ||
          "تم اعتماد الترقية من قائمة الانتظار."
      );

    if (!promoted) {
      return json(
        {
          ok: false,
          error:
            "no_waiting_student_or_circle_full",
        },
        409
      );
    }

    return json({
      ok: true,

      promoted,

      circle:
        await refreshCircleStatus(
          db,
          circleId
        ),
    });
  }

  /* =======================================================
     إلغاء انتظار طالب
  ======================================================= */

  if (
    action ===
    "cancel_waitlist"
  ) {
    const studentId =
      data.student_id ||
      data.studentId;

    if (!studentId) {
      return json(
        {
          ok: false,
          error:
            "student_id_required",
        },
        400
      );
    }

    const item =
      await getWaitlistEntry(
        db,
        studentId,
        circleId
      );

    if (!item) {
      return json(
        {
          ok: false,
          error:
            "waitlist_entry_not_found",
        },
        404
      );
    }

    await db.prepare(`
      UPDATE circle_waitlist
      SET status = 'cancelled'
      WHERE id = ?1
    `).bind(
      item.id
    ).run();

    await normalizeWaitlist(
      db,
      circleId
    );

    await audit(
      db,
      actorId,
      "waitlist_cancelled",
      "circle_waitlist",
      item.id,
      {
        student_id:
          studentId,

        circle_id:
          circleId,
      }
    );

    return json({
      ok: true,

      cancelled:
        item,
    });
  }

  return json(
    {
      ok: false,
      error:
        "unsupported_patch_action",
    },
    400
  );
}

/* =========================================================
   Router
========================================================= */

export async function onRequest(
  context
) {
  const request =
    context.request;

  const env =
    context.env;

  try {
    switch (
      request.method.toUpperCase()
    ) {
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
            error:
              "METHOD_NOT_ALLOWED",
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
        error:
          "INTERNAL_SERVER_ERROR",

        message:
          error?.message ||
          "حدث خطأ غير متوقع.",
      },
      500
    );
  }
}
