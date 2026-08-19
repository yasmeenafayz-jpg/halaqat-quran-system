/**
 * الأوَّابين — Enrollment API
 *
 * POST   /api/enrollments
 * GET    /api/enrollments
 * PATCH  /api/enrollments
 *
 * مسؤول عن:
 * - التسجيل الفردي والجماعي.
 * - توافق الباقة مع نوع الحلقة.
 * - سعة الحلقة.
 * - قائمة الانتظار.
 * - طلبات التسجيل.
 * - الاجتماع التعريفي.
 * - موافقة الإدارة.
 * - إنشاء حلقة جماعية جديدة عند بلوغ حد الانتظار.
 * - ترقية المنتظرين بقرار إداري.
 * - تعديل السعة.
 * - إلغاء الانتظار.
 *
 * ملاحظة:
 * - الاشتراكات والمدفوعات لها أنظمة مستقلة.
 * - تجربة 3 أيام موجودة كسياسة تسجيل وليست اشتراكًا تلقائيًا هنا.
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const ACTIVE_ENROLLMENT_STATUSES = [
  "pending",
  "active",
  "paused",
];

const REQUEST_PENDING_STATUSES = [
  "pending",
  "introductory",
];

const DECISION_STATUSES = [
  "accepted",
  "rejected",
  "waitlisted",
  "cancelled",
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
    [
      "group",
      "جماعية",
      "جماعي",
    ].includes(type)
  ) {
    return "group";
  }

  if (
    [
      "individual",
      "فردية",
      "فردي",
    ].includes(type)
  ) {
    return "individual";
  }

  return type;
}

function isEnrollmentActive(status) {
  return ACTIVE_ENROLLMENT_STATUSES.includes(
    String(status || "").toLowerCase()
  );
}

function toCapacity(value) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function isBooleanTrue(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  );
}

/* =========================================================
   Basic Queries
========================================================= */

async function getStudent(db, id) {
  if (!id) {
    return null;
  }

  return db.prepare(`
    SELECT *
    FROM students
    WHERE id = ?1
    LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getCircle(db, id) {
  if (!id) {
    return null;
  }

  return db.prepare(`
    SELECT *
    FROM circles
    WHERE id = ?1
    LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getPackage(db, id) {
  if (!id) {
    return null;
  }

  return db.prepare(`
    SELECT *
    FROM packages
    WHERE id = ?1
    LIMIT 1
  `)
    .bind(id)
    .first();
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
  `)
    .bind(
      studentId,
      circleId
    )
    .first();
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
  `)
    .bind(circleId)
    .first();

  return Number(row?.count || 0);
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
  `)
    .bind(circleId)
    .first();

  return Number(row?.count || 0);
}

/* =========================================================
   Enrollment Policy
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
      ORDER BY
        CASE
          WHEN circle_id = ?1
           AND package_id = ?2
            THEN 1

          WHEN circle_id = ?1
           AND package_id IS NULL
            THEN 2

          WHEN circle_id IS NULL
           AND package_id = ?2
            THEN 3

          ELSE 4
        END
      LIMIT 1
    `)
      .bind(
        circleId,
        packageId || null
      )
      .first();
  } catch {
    return null;
  }
}

/* =========================================================
   Package / Circle Compatibility
========================================================= */

async function getPackageCircleRule(
  db,
  packageId,
  circleType
) {
  if (!packageId) {
    return null;
  }

  try {
    /*
     * مهم:
     * لا نضع enabled = 1 هنا.
     * يجب أن نستطيع معرفة أن القاعدة موجودة لكنها معطلة.
     */
    return await db.prepare(`
      SELECT *
      FROM package_circle_rules
      WHERE package_id = ?1
        AND circle_type = ?2
      LIMIT 1
    `)
      .bind(
        packageId,
        circleType
      )
      .first();
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
    `)
      .bind(
        studentId,
        circleId
      )
      .first();
  } catch {
    return null;
  }
}

async function createRequest(
  db,
  studentId,
  circleId,
  requestType = "new",
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

async function updateRequestStatus(
  db,
  requestId,
  status,
  decidedBy = null
) {
  if (!requestId) {
    return null;
  }

  if (
    ![
      "pending",
      "introductory",
      "accepted",
      "rejected",
      "cancelled",
    ].includes(status)
  ) {
    return null;
  }

  return db.prepare(`
    UPDATE enrollment_requests
    SET
      status = ?2,
      decided_at = ?3,
      decided_by = ?4
    WHERE id = ?1
    RETURNING *
  `)
    .bind(
      requestId,
      status,
      status === "pending" ||
      status === "introductory"
        ? null
        : now(),
      decidedBy || null
    )
    .first();
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
  if (!DECISION_STATUSES.includes(decision)) {
    return null;
  }

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
    `)
      .bind(
        requestId || null,
        studentId,
        circleId,
        decision,
        reason,
        decidedBy || null,
        now()
      )
      .first();
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
  `)
    .bind(
      studentId,
      circleId
    )
    .first();
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
    `)
      .bind(circleId)
      .first();

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
  `)
    .bind(
      circleId,
      studentId,
      Number(
        positionRow?.position || 1
      ),
      now()
    )
    .first();
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
    `)
      .bind(circleId)
      .all();

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
    `)
      .bind(
        rows[index].id,
        index + 1
      )
      .run();
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
    `)
      .bind(userId)
      .first();
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
    `)
      .bind(
        title,
        message,
        now()
      )
      .run();
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
    `)
      .bind(
        student.user_id,
        title,
        message,
        now()
      )
      .run();
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
    `)
      .bind(
        userId || null,
        action,
        entityType,
        entityId,
        JSON.stringify(details),
        now()
      )
      .run();
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
    Number(
      circle.capacity || 0
    );

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
  `)
    .bind(
      circleId,
      status,
      now()
    )
    .run();

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
    `)
      .bind(
        `${base}%`
      )
      .all();

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
========================================================= */

async function createNewGroupCircle(
  db,
  originalCircle,
  packageId,
  reason,
  actorId = null
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
    `)
      .bind(
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
      )
      .first();

  if (!newCircle) {
    return null;
  }

  await audit(
    db,
    actorId,
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
    `تم تجهيز الحلقة "${newCircle.name}" بسبب ${reason}. ` +
    `عدد المنتظرين: ${waiting}. ` +
    `السعة: ${capacity}. ` +
    `لم يتم نقل أي طالب تلقائيًا.`
  );

  return newCircle;
}

/* =========================================================
   Promote First Waiting Student
========================================================= */

async function promoteNextWaiting(
  db,
  circle,
  actorId,
  reason = "تم اعتماد الترقية من قائمة الانتظار."
) {
  const capacity =
    Number(
      circle.capacity || 0
    );

  if (capacity <= 0) {
    return null;
  }

  const count =
    await enrollmentCount(
      db,
      circle.id
    );

  if (
    count >= capacity
  ) {
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
    `)
      .bind(circle.id)
      .first();

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
    `)
      .bind(waiting.id)
      .run();

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
  `)
    .bind(waiting.id)
    .run();

  const request =
    await getPendingRequest(
      db,
      waiting.student_id,
      circle.id
    );

  if (request) {
    await updateRequestStatus(
      db,
      request.id,
      "accepted",
      actorId
    );

    await createDecision(
      db,
      request.id,
      waiting.student_id,
      circle.id,
      "accepted",
      reason,
      actorId
    );
  }

  await notifyStudent(
    db,
    waiting.student_id,
    "تم قبول تسجيلك",
    `تمت ترقيتك من قائمة الانتظار إلى الحلقة "${circle.name}".`
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
   Create Enrollment Request
========================================================= */

async function createEnrollmentRequestFlow(
  db,
  studentId,
  circle,
  packageId,
  policy,
  reason = null
) {
  const circleType =
    normalizeCircleType(
      circle.circle_type
    );

  const existingRequest =
    await getPendingRequest(
      db,
      studentId,
      circle.id
    );

  if (existingRequest) {
    return {
      request:
        existingRequest,
      created:
        false,
    };
  }

  const requiresIntro =
    Number(
      policy?.require_introductory_meeting || 0
    ) === 1;

  const status =
    requiresIntro
      ? "introductory"
      : "pending";

  const request =
    await createRequest(
      db,
      studentId,
      circle.id,
      "new",
      status,
      reason ||
        (
          requiresIntro
            ? "التسجيل يتطلب اجتماعًا تعريفيًا."
            : "التسجيل يحتاج موافقة الإدارة."
        )
    );

  if (request) {
    await notifyAdmins(
      db,
      "طلب تسجيل جديد",
      `يوجد طلب تسجيل جديد للطالب ${studentId} في الحلقة "${circle.name}" (${circleType}).`
    );
  }

  return {
    request,
    created:
      true,
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

  if (!db) {
    return json(
      {
        ok: false,
        error: "DB_NOT_CONFIGURED",
      },
      500
    );
  }

  const data =
    await body(request);

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
        error:
          "student_not_found",
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
        error:
          "student_not_active",
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

  /* =======================================================
     Package Validation
  ======================================================= */

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

    /*
     * إذا كانت هناك قاعدة صريحة ومعطلة،
     * فالباقة ممنوعة لهذا النوع.
     */
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

    /*
     * إذا كانت الباقة لها نوع محدد،
     * فلا يسمح باستخدامها مع النوع المخالف.
     */
    const packageType =
      String(
        pkg.package_type || ""
      )
        .trim()
        .toLowerCase();

    if (
      [
        "individual",
        "group",
      ].includes(packageType) &&
      packageType !== circleType
    ) {
      return json(
        {
          ok: false,
          error:
            "package_circle_type_mismatch",
          package_type:
            packageType,
          circle_type:
            circleType,
        },
        403
      );
    }
  }

  /* =======================================================
     Existing Enrollment
  ======================================================= */

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
      enrollment:
        existing,
    });
  }

  /* =======================================================
     Policy
  ======================================================= */

  const policy =
    await getPolicy(
      db,
      circleId,
      packageId
    );

  const allowNewStudents =
    policy
      ? Number(
          policy.allow_new_students
        ) === 1
      : true;

  const requireApproval =
    policy
      ? Number(
          policy.require_admin_approval
        ) === 1
      : true;

  const requireIntro =
    policy
      ? Number(
          policy.require_introductory_meeting
        ) === 1
      : false;

  const allowWaitlist =
    policy
      ? Number(
          policy.allow_waitlist
        ) === 1
      : true;

  if (!allowNewStudents) {
    return json(
      {
        ok: false,
        error:
          "new_student_registration_disabled",
      },
      403
    );
  }

  /* =======================================================
     Capacity
  ======================================================= */

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
     Group Capacity Validation
  ======================================================= */

  if (
    circleType === "group" &&
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
     Full Circle
  ======================================================= */

  if (
    capacity > 0 &&
    count >= capacity
  ) {
    if (!allowWaitlist) {
      return json(
        {
          ok: false,
          error:
            "circle_full_waitlist_disabled",
          circle_status:
            "full",
          capacity,
          enrollment_count:
            count,
        },
        409
      );
    }

    const requestResult =
      await createEnrollmentRequestFlow(
        db,
        studentId,
        circle,
        packageId,
        policy,
        "تم وضع الطالب في قائمة الانتظار بسبب اكتمال السعة."
      );

    const waitlist =
      await addWaitlist(
        db,
        studentId,
        circleId
      );

    await createDecision(
      db,
      requestResult.request?.id ||
        null,
      studentId,
      circleId,
      "waitlisted",
      "الحلقة ممتلئة وتمت إضافة الطالب إلى قائمة الانتظار.",
      null
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

    /*
     * تجهيز حلقة جديدة لا يعني نقل الطلاب.
     * يتم فقط إنشاء الحلقة وإشعار الإدارة.
     */
    if (
      circleType === "group" &&
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
        request:
          requestResult.request,
        circle_status:
          "full",
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
     Introductory Meeting
  ======================================================= */

  if (requireIntro) {
    const requestResult =
      await createEnrollmentRequestFlow(
        db,
        studentId,
        circle,
        packageId,
        policy,
        "التسجيل يتطلب اجتماعًا تعريفيًا قبل القبول."
      );

    return json(
      {
        ok: true,
        pending: true,
        requires_introductory_meeting:
          true,
        requires_admin_approval:
          requireApproval,
        request:
          requestResult.request,
        trial_days:
          Number(
            policy?.trial_days || 0
          ),
      },
      202
    );
  }

  /* =======================================================
     Admin Approval
  ======================================================= */

  if (requireApproval) {
    const requestResult =
      await createEnrollmentRequestFlow(
        db,
        studentId,
        circle,
        packageId,
        policy,
        "التسجيل يحتاج موافقة الإدارة."
      );

    return json(
      {
        ok: true,
        pending: true,
        requires_admin_approval:
          true,
        request:
          requestResult.request,
        trial_days:
          Number(
            policy?.trial_days || 0
          ),
      },
      202
    );
  }

  /* =======================================================
     Direct Enrollment
     يسمح فقط عندما لا توجد موافقة أو اجتماع مطلوب.
  ======================================================= */

  const enrollment =
    await activateEnrollment(
      db,
      studentId,
      circleId,
      "direct"
    );

  const status =
    await refreshCircleStatus(
      db,
      circleId
    );

  await audit(
    db,
    null,
    "student_enrolled",
    "circle_enrollment",
    enrollment?.id || null,
    {
      student_id:
        studentId,

      circle_id:
        circleId,

      circle_type:
        circleType,

      package_id:
        packageId ||
        null,
    }
  );

  return json({
    ok: true,
    type:
      circleType,
    enrollment,
    circle:
      status,
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

  if (!db) {
    return json(
      {
        ok: false,
        error:
          "DB_NOT_CONFIGURED",
      },
      500
    );
  }

  const url =
    new URL(request.url);

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
      await db.prepare(sql)
        .bind(...params)
        .all();

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
      `)
        .bind(circleId)
        .all();

    const requests =
      await db.prepare(`
        SELECT
          er.*,
          s.name AS student_name
        FROM enrollment_requests er
        LEFT JOIN students s
          ON s.id = er.student_id
        WHERE er.circle_id = ?1
        ORDER BY
          er.id DESC
      `)
        .bind(circleId)
        .all();

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
        waitlist?.results?.length ||
        0,

      requests:
        requests?.results ||
        [],
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
      `)
        .bind(studentId)
        .all();

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
      `)
        .bind(studentId)
        .all();

    const requests =
      await db.prepare(`
        SELECT
          er.*,
          c.name AS circle_name,
          c.circle_type
        FROM enrollment_requests er
        LEFT JOIN circles c
          ON c.id = er.circle_id
        WHERE er.student_id = ?1
        ORDER BY
          er.id DESC
      `)
        .bind(studentId)
        .all();

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

      requests:
        requests?.results ||
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
    `)
      .all();

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
   - ترقية منتظر.
   - إنشاء حلقة جديدة.
   - إلغاء انتظار.
========================================================= */

async function handlePatch(
  request,
  env
) {
  const db = env.DB;

  if (!db) {
    return json(
      {
        ok: false,
        error:
          "DB_NOT_CONFIGURED",
      },
      500
    );
  }

  const data =
    await body(request);

  if (!data) {
    return json(
      {
        ok: false,
        error:
          "INVALID_JSON",
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
      data.action || ""
    )
      .trim()
      .toLowerCase();

  /* =======================================================
     Set Capacity
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

    const oldCapacity =
      Number(
        circle.capacity || 0
      );

    await db.prepare(`
      UPDATE circles
      SET
        capacity = ?2,
        updated_at = ?3
      WHERE id = ?1
    `)
      .bind(
        circleId,
        newCapacity,
        now()
      )
      .run();

    const refreshed =
      await refreshCircleStatus(
        db,
        circleId
      );

    const promoted = [];

    /*
     * الترقية لا تحدث إلا إذا أرسلت الإدارة
     * approve_waitlist=true.
     */
    if (
      isBooleanTrue(
        data.approve_waitlist
      )
    ) {
      while (
        (
          await enrollmentCount(
            db,
            circleId
          )
        ) < newCapacity &&
        (
          await waitlistCount(
            db,
            circleId
          )
        ) > 0
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
      isBooleanTrue(
        data.create_new_circle
      )
    ) {
      newCircle =
        await createNewGroupCircle(
          db,
          refreshed,
          refreshed.package_id ||
            null,
          "بلوغ قائمة الانتظار سعة الحلقة بقرار إداري",
          actorId
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
          oldCapacity,

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
     Create New Circle
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
        "طلب إداري لإنشاء حلقة جديدة",
        actorId
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
     Promote Waitlist
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
     Cancel Waitlist
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
    `)
      .bind(item.id)
      .run();

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

  /* =======================================================
     Accept / Reject Request
  ======================================================= */

  if (
    action === "accept_request" ||
    action === "approve_request" ||
    action === "reject_request" ||
    action === "cancel_request"
  ) {
    const requestId =
      data.request_id ||
      data.requestId;

    if (!requestId) {
      return json(
        {
          ok: false,
          error:
            "request_id_required",
        },
        400
      );
    }

    const requestRow =
      await db.prepare(`
        SELECT *
        FROM enrollment_requests
        WHERE id = ?1
        LIMIT 1
      `)
        .bind(requestId)
        .first();

    if (!requestRow) {
      return json(
        {
          ok: false,
          error:
            "enrollment_request_not_found",
        },
        404
      );
    }

    const requestCircle =
      await getCircle(
        db,
        requestRow.circle_id
      );

    if (!requestCircle) {
      return json(
        {
          ok: false,
          error:
            "circle_not_found",
        },
        404
      );
    }

    const student =
      await getStudent(
        db,
        requestRow.student_id
      );

    if (!student) {
      return json(
        {
          ok: false,
          error:
            "student_not_found",
        },
        404
      );
    }

    /* ------------------------------
       Reject
    ------------------------------ */

    if (
      action === "reject_request"
    ) {
      const updated =
        await updateRequestStatus(
          db,
          requestId,
          "rejected",
          actorId
        );

      await createDecision(
        db,
        requestId,
        requestRow.student_id,
        requestRow.circle_id,
        "rejected",
        data.reason ||
          "تم رفض طلب التسجيل.",
        actorId
      );

      await notifyStudent(
        db,
        requestRow.student_id,
        "تم رفض طلب التسجيل",
        data.reason ||
          "تم رفض طلب التسجيل من الإدارة."
      );

      return json({
        ok: true,
        request:
          updated,
      });
    }

    /* ------------------------------
       Cancel
    ------------------------------ */

    if (
      action === "cancel_request"
    ) {
      const updated =
        await updateRequestStatus(
          db,
          requestId,
          "cancelled",
          actorId
        );

      await createDecision(
        db,
        requestId,
        requestRow.student_id,
        requestRow.circle_id,
        "cancelled",
        data.reason ||
          "تم إلغاء طلب التسجيل.",
        actorId
      );

      return json({
        ok: true,
        request:
          updated,
      });
    }

    /* ------------------------------
       Accept
    ------------------------------ */

    const circleType =
      normalizeCircleType(
        requestCircle.circle_type
      );

    const capacity =
      Number(
        requestCircle.capacity || 0
      );

    const count =
      await enrollmentCount(
        db,
        requestCircle.id
      );

    if (
      circleType === "group" &&
      capacity > 0 &&
      count >= capacity
    ) {
      return json(
        {
          ok: false,
          error:
            "circle_full",
          message:
            "لا يمكن قبول الطالب لأن الحلقة اكتملت. استخدمي ترقية قائمة الانتظار أو زيدي السعة.",
        },
        409
      );
    }

    if (
      student.status !== "active"
    ) {
      return json(
        {
          ok: false,
          error:
            "student_not_active",
        },
        400
      );
    }

    const enrollment =
      await activateEnrollment(
        db,
        requestRow.student_id,
        requestRow.circle_id,
        "admin_approval"
      );

    const updated =
      await updateRequestStatus(
        db,
        requestId,
        "accepted",
        actorId
      );

    await createDecision(
      db,
      requestId,
      requestRow.student_id,
      requestRow.circle_id,
      "accepted",
      data.reason ||
        "تم قبول طلب التسجيل.",
      actorId
    );

    await notifyStudent(
      db,
      requestRow.student_id,
      "تم قبول تسجيلك",
      `تم قبول تسجيلك في الحلقة "${requestCircle.name}".`
    );

    await audit(
      db,
      actorId,
      "enrollment_request_accepted",
      "enrollment_request",
      requestId,
      {
        student_id:
          requestRow.student_id,

        circle_id:
          requestRow.circle_id,

        enrollment_id:
          enrollment?.id ||
          null,
      }
    );

    return json({
      ok: true,

      request:
        updated,

      enrollment,

      circle:
        await refreshCircleStatus(
          db,
          requestRow.circle_id
        ),
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
