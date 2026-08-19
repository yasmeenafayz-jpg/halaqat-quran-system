/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
 *
 * القواعد:
 * - التسجيل الفردي والجماعي.
 * - الفردية يمكن أن تضم 1 أو 2 أو أكثر، مثل الإخوة.
 * - الحلقة الجماعية تمنع التسجيل عند اكتمال السعة.
 * - عند وجود قائمة انتظار كافية لإنشاء مجموعة جديدة:
 *   يتم إنشاء حلقة جماعية جديدة بنفس إعدادات الحلقة الأصلية.
 * - يتم تسجيل تنبيه للإدارة عند إنشاء حلقة جديدة.
 * - عند وجود مكان شاغر، يمكن أخذ أول طالب من قائمة الانتظار.
 * - تعديل السعة يتم من circles API.
 *
 * يعتمد على:
 * - enrollment_requests
 * - enrollment_policies
 * - package_circle_rules
 * - enrollment_decisions
 * - circle_enrollments
 * - circle_waitlist
 * - subscriptions
 * - users
 * - students
 * - teachers
 * - packages
 * - circles
 */

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

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
  `).bind(circleId).first();

  return Number(
    row?.count || 0
  );
}

/* =========================================================
   Waitlist Count
========================================================= */

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
  return db.prepare(`
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
}

async function getPackageCircleRule(
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

async function createRequest(
  db,
  studentId,
  circleId,
  requestType,
  status,
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
    requestId,
    studentId,
    circleId,
    decision,
    reason,
    decidedBy,
    now()
  ).first();
}

/* =========================================================
   Waitlist
========================================================= */

async function getWaitlist(
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
    await getWaitlist(
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
   Reorder Waitlist
========================================================= */

async function normalizeWaitlist(
  db,
  circleId
) {
  try {
    const rows =
      await db.prepare(`
        SELECT id
        FROM circle_waitlist
        WHERE circle_id = ?1
          AND status = 'waiting'
        ORDER BY position ASC, id ASC
      `).bind(
        circleId
      ).all();

    const list =
      rows.results || [];

    for (
      let index = 0;
      index < list.length;
      index++
    ) {
      await db.prepare(`
        UPDATE circle_waitlist
        SET position = ?2
        WHERE id = ?1
      `).bind(
        list[index].id,
        index + 1
      ).run();
    }
  } catch (error) {
    console.error(
      "Waitlist normalize error:",
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
  const start =
    new Date();

  const days =
    Math.max(
      0,
      Number(trialDays || 0)
    );

  const end =
    new Date(start);

  if (days > 0) {
    end.setDate(
      end.getDate() + days
    );
  }

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

    start
      .toISOString()
      .slice(0, 10),

    end
      .toISOString()
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
   Permissions
========================================================= */

async function canDecide(
  db,
  userId
) {
  if (!userId) {
    return false;
  }

  const user =
    await db.prepare(`
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
   Admin Notification
========================================================= */

async function notifyAdminNewCircle(
  db,
  originalCircle,
  newCircle,
  reason
) {
  /*
   * نحاول استخدام notifications إن كان
   * الجدول موجودًا.
   *
   * إذا لم يكن موجودًا، لا نفشل عملية
   * التسجيل أو إنشاء الحلقة.
   */

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
        u.id,
        ?1,
        ?2,
        ?3,
        ?4
      FROM users u
      WHERE u.role = 'admin'
        AND u.status = 'active'
    `).bind(
      "new_circle_required",

      "تم فتح حلقة جماعية جديدة",

      `تم إنشاء الحلقة "${newCircle.name}" `
      + `بسبب امتلاء الحلقة "${originalCircle.name}". `
      + reason,

      now()
    ).run();
  } catch (notificationError) {
    console.error(
      "Admin notification error:",
      notificationError
    );
  }

  /*
   * نسجل أيضًا في audit_logs إن كان موجودًا.
   */

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
        NULL,
        ?1,
        ?2,
        ?3,
        ?4,
        ?5
      )
    `).bind(
      "new_group_circle_created",
      "circle",
      newCircle.id,
      JSON.stringify({
        original_circle_id:
          originalCircle.id,

        original_circle_name:
          originalCircle.name,

        new_circle_id:
          newCircle.id,

        new_circle_name:
          newCircle.name,

        reason,
      }),
      now()
    ).run();
  } catch (auditError) {
    console.error(
      "Circle audit error:",
      auditError
    );
  }
}

/* =========================================================
   Generate New Circle Name
========================================================= */

async function generateNewCircleName(
  db,
  originalCircle
) {
  const baseName =
    String(
      originalCircle.name ||
      "الحلقة"
    ).trim();

  const existing =
    await db.prepare(`
      SELECT name
      FROM circles
      WHERE name LIKE ?1
      ORDER BY id DESC
    `).bind(
      `${baseName}%`
    ).all();

  const names =
    existing.results || [];

  let number = 2;

  while (
    names.some(
      row =>
        String(row.name)
          .trim()
          ===
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
  reason
) {
  if (
    originalCircle.circle_type !==
    "group"
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

  /*
   * لا ننشئ حلقة جديدة بدون
   * عدد كافٍ من الطلاب.
   */

  const waiting =
    await waitlistCount(
      db,
      originalCircle.id
    );

  if (waiting < capacity) {
    return null;
  }

  const newName =
    await generateNewCircleName(
      db,
      originalCircle
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
      newName,
      originalCircle.teacher_id ||
        null,

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
    ).run();

  const newCircleId =
    result.meta?.last_row_id;

  const newCircle =
    await getCircle(
      db,
      newCircleId
    );

  if (!newCircle) {
    throw new Error(
      "Failed to create the new group circle."
    );
  }

  await notifyAdminNewCircle(
    db,
    originalCircle,
    newCircle,
    reason
  );

  return newCircle;
}

/* =========================================================
   Fill Existing Circle From Waitlist
========================================================= */

async function promoteFromWaitlist(
  db,
  circleId,
  packageId,
  trialDays,
  decidedBy = null
) {
  const circle =
    await getCircle(
      db,
      circleId
    );

  if (!circle) {
    return {
      promoted: 0,
      circle: null,
      students: [],
    };
  }

  if (
    circle.circle_type !==
    "group"
  ) {
    return {
      promoted: 0,
      circle,
      students: [],
    };
  }

  const capacity =
    Number(
      circle.capacity || 0
    );

  if (capacity <= 0) {
    return {
      promoted: 0,
      circle,
      students: [],
    };
  }

  let current =
    await enrollmentCount(
      db,
      circleId
    );

  let available =
    Math.max(
      0,
      capacity - current
    );

  if (available <= 0) {
    await db.prepare(`
      UPDATE circles
      SET
        status = 'full',
        updated_at = ?2
      WHERE id = ?1
    `).bind(
      circleId,
      now()
    ).run();

    return {
      promoted: 0,
      circle,
      students: [],
    };
  }

  const waitingRows =
    await db.prepare(`
      SELECT *
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
      ORDER BY position ASC, id ASC
      LIMIT ?2
    `).bind(
      circleId,
      available
    ).all();

  const waiting =
    waitingRows.results || [];

  const promoted = [];

  for (
    const item of waiting
  ) {
    if (
      available <= 0
    ) {
      break;
    }

    const student =
      await getStudent(
        db,
        item.student_id
      );

    if (
      !student ||
      student.status !==
        "active"
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

    const existing =
      await getEnrollment(
        db,
        item.student_id,
        circleId
      );

    if (
      existing &&
      [
        "active",
        "pending",
        "paused",
      ].includes(
        existing.status
      )
    ) {
      await db.prepare(`
        UPDATE circle_waitlist
        SET status = 'accepted'
        WHERE id = ?1
      `).bind(
        item.id
      ).run();

      continue;
    }

    let enrollment;

    if (existing) {
      enrollment =
        await db.prepare(`
          UPDATE circle_enrollments
          SET
            start_date = ?3,
            end_date = NULL,
            status = 'active',
            joined_via = 'waitlist',
            notes = NULL,
            updated_at = ?4
          WHERE circle_id = ?1
            AND student_id = ?2
          RETURNING *
        `).bind(
          circleId,
          item.student_id,
          today(),
          now()
        ).first();
    } else {
      enrollment =
        await db.prepare(`
          INSERT INTO circle_enrollments (
            circle_id,
            student_id,
            start_date,
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
            'active',
            'waitlist',
            NULL,
            ?4,
            ?4
          )
          RETURNING *
        `).bind(
          circleId,
          item.student_id,
          today(),
          now()
        ).first();
    }

    const subscription =
      await createSubscription(
        db,
        item.student_id,
        packageId,
        circleId,
        trialDays
      );

    await db.prepare(`
      UPDATE circle_waitlist
      SET status = 'accepted'
      WHERE id = ?1
    `).bind(
      item.id
    ).run();

    promoted.push({
      student_id:
        item.student_id,

      enrollment,

      subscription,
    });

    available--;
    current++;

    /*
     * إذا أصبحت الحلقة ممتلئة،
     * نغلق التسجيل فيها.
     */

    if (
      current >=
      capacity
    ) {
      await db.prepare(`
        UPDATE circles
        SET
          status = 'full',
          updated_at = ?2
        WHERE id = ?1
      `).bind(
        circleId,
        now()
      ).run();

      break;
    }
  }

  await normalizeWaitlist(
    db,
    circleId
  );

  /*
   * إذا بقي عدد من المنتظرين
   * يكفي لتكوين حلقة جديدة،
   * ننشئ حلقة جديدة.
   */

  const remaining =
    await waitlistCount(
      db,
      circleId
    );

  let newCircle = null;

  if (
    remaining >=
    capacity
  ) {
    newCircle =
      await createNewGroupCircle(
        db,
        circle,
        packageId,
        "عدد المنتظرين يكفي لتكوين حلقة جماعية جديدة."
      );
  }

  return {
    promoted:
      promoted.length,

    students:
      promoted,

    circle:
      await getCircle(
        db,
        circleId
      ),

    new_circle:
      newCircle,
  };
}

/* =========================================================
   Activate Enrollment
========================================================= */

async function activateEnrollment(
  db,
  studentId,
  circleId,
  packageId,
  trialDays
) {
  const circle =
    await getCircle(
      db,
      circleId
    );

  if (!circle) {
    throw new Error(
      "Circle not found."
    );
  }

  const existing =
    await getEnrollment(
      db,
      studentId,
      circleId
    );

  if (existing) {
    if (
      [
        "pending",
        "active",
        "paused",
      ].includes(
        existing.status
      )
    ) {
      throw new Error(
        "Student is already enrolled in this circle."
      );
    }

    const enrollment =
      await db.prepare(`
        UPDATE circle_enrollments
        SET
          start_date = ?3,
          end_date = NULL,
          status = 'active',
          joined_via = 'api',
          notes = NULL,
          updated_at = ?4
        WHERE circle_id = ?1
          AND student_id = ?2
        RETURNING *
      `).bind(
        circleId,
        studentId,
        today(),
        now()
      ).first();

    const subscription =
      await createSubscription(
        db,
        studentId,
        packageId,
        circleId,
        trialDays
      );

    return {
      enrollment,
      subscription,
      new_circle: null,
    };
  }

  const count =
    await enrollmentCount(
      db,
      circleId
    );

  const capacity =
    Number(
      circle.capacity || 0
    );

  /*
   * الفردية:
   * لا يوجد إغلاق تلقائي بسبب
   * كونها فردية.
   *
   * السعة هي الرقم الذي تحدده
   * الإدارة، ويمكن أن تكون 1 أو 2
   * أو أكثر.
   */

  if (
    circle.circle_type ===
      "group" &&
    capacity > 0 &&
    count >= capacity
  ) {
    throw new Error(
      "Circle capacity has been reached."
    );
  }

  const enrollment =
    await db.prepare(`
      INSERT INTO circle_enrollments (
        circle_id,
        student_id,
        start_date,
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
        'active',
        'api',
        NULL,
        ?4,
        ?4
      )
      RETURNING *
    `).bind(
      circleId,
      studentId,
      today(),
      now()
    ).first();

  const subscription =
    await createSubscription(
      db,
      studentId,
      packageId,
      circleId,
      trialDays
    );

  let newCircle = null;

  /*
   * الحلقة الجماعية أصبحت ممتلئة.
   */

  if (
    circle.circle_type ===
      "group" &&
    capacity > 0 &&
    count + 1 >= capacity
  ) {
    await db.prepare(`
      UPDATE circles
      SET
        status = 'full',
        updated_at = ?2
      WHERE id = ?1
    `).bind(
      circleId,
      now()
    ).run();

    /*
     * بعد امتلاء الحلقة،
     * إذا كان الانتظار يحتوي على
     * عدد يكفي لتكوين حلقة كاملة،
     * افتح حلقة جديدة.
     */

    const waiting =
      await waitlistCount(
        db,
        circleId
      );

    if (
      waiting >=
      capacity
    ) {
      newCircle =
        await createNewGroupCircle(
          db,
          circle,
          packageId,
          "الحلقة الأساسية امتلأت وعدد قائمة الانتظار يكفي لتكوين حلقة جديدة."
        );
    }
  }

  return {
    enrollment,
    subscription,
    new_circle:
      newCircle,
  };
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
    return json(
      {
        success: false,
        error:
          "DB binding is not configured.",
      },
      500
    );
  }

  const data =
    await body(
      context.request
    );

  if (!data) {
    return json(
      {
        success: false,
        error:
          "Invalid JSON body.",
      },
      400
    );
  }

  const studentId =
    Number(
      data.student_id
    );

  const packageId =
    Number(
      data.package_id
    );

  const circleId =
    Number(
      data.circle_id
    );

  const requestType =
    data.request_type ||
    "new";

  if (
    !studentId ||
    !packageId ||
    !circleId
  ) {
    return json(
      {
        success: false,
        error:
          "student_id, package_id and circle_id are required.",
      },
      400
    );
  }

  if (
    ![
      "new",
      "transfer",
      "renewal",
    ].includes(
      requestType
    )
  ) {
    return json(
      {
        success: false,
        error:
          "Invalid request_type.",
      },
      400
    );
  }

  try {
    /* =====================================================
       Student
    ===================================================== */

    const student =
      await getStudent(
        db,
        studentId
      );

    if (!student) {
      return json(
        {
          success: false,
          error:
            "Student not found.",
        },
        404
      );
    }

    if (
      student.status !==
      "active"
    ) {
      return json(
        {
          success: false,
          error:
            "Student is not active.",
        },
        409
      );
    }

    /* =====================================================
       Package
    ===================================================== */

    const pkg =
      await getPackage(
        db,
        packageId
      );

    if (!pkg) {
      return json(
        {
          success: false,
          error:
            "Package not found.",
        },
        404
      );
    }

    if (
      pkg.status !==
      "active"
    ) {
      return json(
        {
          success: false,
          error:
            "Package is inactive.",
        },
        409
      );
    }

    /* =====================================================
       Circle
    ===================================================== */

    const circle =
      await getCircle(
        db,
        circleId
      );

    if (!circle) {
      return json(
        {
          success: false,
          error:
            "Circle not found.",
        },
        404
      );
    }

    if (
      ![
        "active",
        "full",
      ].includes(
        circle.status
      )
    ) {
      return json(
        {
          success: false,
          error:
            "Circle is not accepting enrollment.",
        },
        409
      );
    }

    /* =====================================================
       Package / Circle Matching
    ===================================================== */

    if (
      circle.package_id !==
        null &&
      circle.package_id !==
        undefined &&
      Number(
        circle.package_id
      ) !== packageId
    ) {
      return json(
        {
          success: false,
          error:
            "Selected package is not assigned to this circle.",
        },
        409
      );
    }

    if (
      pkg.package_type !==
      circle.circle_type
    ) {
      return json(
        {
          success: false,
          error:
            "Package type does not match circle type.",
        },
        409
      );
    }

    const packageRule =
      await getPackageCircleRule(
        db,
        packageId,
        circle.circle_type
      );

    if (!packageRule) {
      return json(
        {
          success: false,
          error:
            "This package is not enabled for this circle type.",
        },
        409
      );
    }

    /* =====================================================
       Policy
    ===================================================== */

    const policy =
      await getPolicy(
        db,
        circleId,
        packageId
      );

    if (
      policy &&
      Number(
        policy.allow_new_students
      ) !== 1
    ) {
      return json(
        {
          success: false,
          error:
            "New enrollment is disabled.",
        },
        409
      );
    }

    /* =====================================================
       Existing Enrollment
    ===================================================== */

    const existing =
      await getEnrollment(
        db,
        studentId,
        circleId
      );

    if (
      existing &&
      [
        "pending",
        "active",
        "paused",
      ].includes(
        existing.status
      )
    ) {
      return json(
        {
          success: false,
          error:
            "Student is already enrolled in this circle.",
        },
        409
      );
    }

    /* =====================================================
       Existing Request
    ===================================================== */

    const pending =
      await getPendingRequest(
        db,
        studentId,
        circleId
      );

    if (pending) {
      return json(
        {
          success: false,
          error:
            "There is already a pending enrollment request.",
          request:
            pending,
        },
        409
      );
    }

    /* =====================================================
       Capacity
    ===================================================== */

    const count =
      await enrollmentCount(
        db,
        circleId
      );

    const capacity =
      Number(
        circle.capacity || 0
      );

    /*
     * الفردية:
     *
     * لا نمنعها بسبب full بنفس
     * منطق الحلقة الجماعية.
     *
     * يمكن أن تضم:
     * 1
     * 2
     * 3
     * ...
     *
     * حسب السعة التي حددتها الإدارة.
     */

    const full =
      circle.circle_type ===
        "group" &&
      capacity > 0 &&
      count >= capacity;

    /* =====================================================
       Full Group → Waitlist
    ===================================================== */

    if (full) {
      const allowWaitlist =
        policy
          ? Number(
              policy.allow_waitlist
            ) === 1
          : true;

      if (!allowWaitlist) {
        return json(
          {
            success: false,
            status: "full",
            error:
              "Circle is full and waitlist is disabled.",
          },
          409
        );
      }

      const waitlist =
        await addWaitlist(
          db,
          studentId,
          circleId
        );

      const request =
        await createRequest(
          db,
          studentId,
          circleId,
          requestType,
          "pending",
          "Circle is full; student added to waitlist."
        );

      await createDecision(
        db,
        request.id,
        studentId,
        circleId,
        "waitlisted",
        "Circle is full; student added to waitlist.",
        null
      );

      /*
       * بعد إضافة الطالب:
       * إذا أصبحت قائمة الانتظار
       * كافية لتكوين حلقة جديدة،
       * نفتح حلقة جديدة.
       */

      let newCircle = null;

      const waiting =
        await waitlistCount(
          db,
          circleId
        );

      if (
        capacity > 0 &&
        waiting >= capacity
      ) {
        newCircle =
          await createNewGroupCircle(
            db,
            circle,
            packageId,
            "قائمة الانتظار أصبحت كافية لتكوين حلقة جماعية جديدة."
          );
      }

      return json(
        {
          success: true,
          status:
            newCircle
              ? "new_circle_created"
              : "waitlisted",

          request_id:
            request.id,

          waitlist_id:
            waitlist.id,

          position:
            waitlist.position,

          new_circle:
            newCircle,
        },
        202
      );
    }

    /* =====================================================
       Introductory Meeting
    ===================================================== */

    const introRequired =
      policy
        ? Number(
            policy.require_introductory_meeting
          ) === 1
        : false;

    if (introRequired) {
      const request =
        await createRequest(
          db,
          studentId,
          circleId,
          requestType,
          "introductory",
          data.notes ||
            "Introductory meeting required."
        );

      return json(
        {
          success: true,
          status:
            "introductory",
          request_id:
            request.id,
        },
        202
      );
    }

    /* =====================================================
       Approval
    ===================================================== */

    const approvalRequired =
      policy
        ? Number(
            policy.require_admin_approval
          ) === 1
        : true;

    const request =
      await createRequest(
        db,
        studentId,
        circleId,
        requestType,
        approvalRequired
          ? "pending"
          : "accepted",
        data.notes ||
          null
      );

    if (approvalRequired) {
      return json(
        {
          success: true,
          status:
            "pending",
          request_id:
            request.id,
        },
        202
      );
    }

    /* =====================================================
       Automatic Approval
    ===================================================== */

    const trialDays =
      policy &&
      policy.trial_days !==
        null
        ? Number(
            policy.trial_days
          )
        : Number(
            pkg.trial_days || 0
          );

    const result =
      await activateEnrollment(
        db,
        studentId,
        circleId,
        packageId,
        trialDays
      );

    await db.prepare(`
      UPDATE enrollment_requests
      SET
        status = 'accepted',
        decided_at = ?2
      WHERE id = ?1
    `).bind(
      request.id,
      now()
    ).run();

    await createDecision(
      db,
      request.id,
      studentId,
      circleId,
      "accepted",
      data.notes ||
        null,
      null
    );

    return json(
      {
        success: true,
        status:
          "enrolled",

        request_id:
          request.id,

        enrollment:
          result.enrollment,

        subscription:
          result.subscription,

        new_circle:
          result.new_circle ||
          null,
      },
      201
    );
  } catch (error) {
    console.error(
      "Enrollment POST error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Enrollment operation failed.",
      },
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
    return json(
      {
        success: false,
        error:
          "DB binding is not configured.",
      },
      500
    );
  }

  const data =
    await body(
      context.request
    );

  if (!data) {
    return json(
      {
        success: false,
        error:
          "Invalid JSON body.",
      },
      400
    );
  }

  const requestId =
    Number(
      data.request_id
    );

  const action =
    data.action;

  const decidedBy =
    Number(
      data.decided_by
    );

  if (
    !requestId ||
    !action
  ) {
    return json(
      {
        success: false,
        error:
          "request_id and action are required.",
      },
      400
    );
  }

  if (
    ![
      "approve",
      "reject",
      "cancel",
    ].includes(
      action
    )
  ) {
    return json(
      {
        success: false,
        error:
          "Invalid action.",
      },
      400
    );
  }

  if (
    !decidedBy ||
    !(await canDecide(
      db,
      decidedBy
    ))
  ) {
    return json(
      {
        success: false,
        error:
          "Only an active admin or supervisor can decide enrollment requests.",
      },
      403
    );
  }

  try {
    const request =
      await db.prepare(`
        SELECT *
        FROM enrollment_requests
        WHERE id = ?1
        LIMIT 1
      `).bind(
        requestId
      ).first();

    if (!request) {
      return json(
        {
          success: false,
          error:
            "Enrollment request not found.",
        },
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
      return json(
        {
          success: false,
          error:
            "This request can no longer be processed.",
        },
        409
      );
    }

    /* =====================================================
       Reject
    ===================================================== */

    if (
      action ===
      "reject"
    ) {
      await db.prepare(`
        UPDATE enrollment_requests
        SET
          status = 'rejected',
          decided_at = ?2,
          decided_by = ?3,
          notes = ?4
        WHERE id = ?1
      `).bind(
        requestId,
        now(),
        decidedBy,
        data.reason ||
          null
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "rejected",
        data.reason ||
          null,
        decidedBy
      );

      return json({
        success: true,
        status:
          "rejected",
        request_id:
          requestId,
      });
    }

    /* =====================================================
       Cancel
    ===================================================== */

    if (
      action ===
      "cancel"
    ) {
      await db.prepare(`
        UPDATE enrollment_requests
        SET
          status = 'cancelled',
          decided_at = ?2,
          decided_by = ?3,
          notes = ?4
        WHERE id = ?1
      `).bind(
        requestId,
        now(),
        decidedBy,
        data.reason ||
          null
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "cancelled",
        data.reason ||
          null,
        decidedBy
      );

      return json({
        success: true,
        status:
          "cancelled",
        request_id:
          requestId,
      });
    }

    /* =====================================================
       Approve
    ===================================================== */

    const circle =
      await getCircle(
        db,
        request.circle_id
      );

    if (!circle) {
      return json(
        {
          success: false,
          error:
            "Circle not found.",
        },
        404
      );
    }

    const packageId =
      circle.package_id
        ? Number(
            circle.package_id
          )
        : Number(
            data.package_id
          );

    if (!packageId) {
      return json(
        {
          success: false,
          error:
            "Package is required for approval.",
        },
        409
      );
    }

    const pkg =
      await getPackage(
        db,
        packageId
      );

    if (!pkg) {
      return json(
        {
          success: false,
          error:
            "Package not found.",
        },
        404
      );
    }

    if (
      pkg.status !==
        "active" ||
      pkg.package_type !==
        circle.circle_type
    ) {
      return json(
        {
          success: false,
          error:
            "Package is invalid for this circle.",
        },
        409
      );
    }

    const packageRule =
      await getPackageCircleRule(
        db,
        packageId,
        circle.circle_type
      );

    if (!packageRule) {
      return json(
        {
          success: false,
          error:
            "This package is not enabled for this circle type.",
        },
        409
      );
    }

    /* =====================================================
       Capacity Recheck
    ===================================================== */

    const count =
      await enrollmentCount(
        db,
        request.circle_id
      );

    const capacity =
      Number(
        circle.capacity || 0
      );

    if (
      circle.circle_type ===
        "group" &&
      capacity > 0 &&
      count >= capacity
    ) {
      /*
       * الحلقة أصبحت ممتلئة قبل الموافقة.
       * ننقل الطالب إلى قائمة الانتظار
       * بدل رفضه نهائيًا.
       */

      const waitlist =
        await addWaitlist(
          db,
          request.student_id,
          request.circle_id
        );

      await db.prepare(`
        UPDATE enrollment_requests
        SET
          status = 'pending',
          notes = ?2
        WHERE id = ?1
      `).bind(
        requestId,
        "Circle became full; student moved to waitlist."
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "waitlisted",
        "Circle became full before approval.",
        decidedBy
      );

      let newCircle = null;

      const waiting =
        await waitlistCount(
          db,
          request.circle_id
        );

      if (
        waiting >=
        capacity
      ) {
        newCircle =
          await createNewGroupCircle(
            db,
            circle,
            packageId,
            "عدد قائمة الانتظار أصبح كافيًا لتكوين حلقة جديدة."
          );
      }

      return json(
        {
          success: true,
          status:
            newCircle
              ? "new_circle_created"
              : "waitlisted",

          request_id:
            requestId,

          waitlist_id:
            waitlist.id,

          position:
            waitlist.position,

          new_circle:
            newCircle,
        },
        202
      );
    }

    /* =====================================================
       Policy / Trial
    ===================================================== */

    const policy =
      await getPolicy(
        db,
        request.circle_id,
        packageId
      );

    const trialDays =
      policy &&
      policy.trial_days !==
        null
        ? Number(
            policy.trial_days
          )
        : Number(
            pkg.trial_days || 0
          );

    /* =====================================================
       Activate
    ===================================================== */

    const result =
      await activateEnrollment(
        db,
        request.student_id,
        request.circle_id,
        packageId,
        trialDays
      );

    await db.prepare(`
      UPDATE enrollment_requests
      SET
        status = 'accepted',
        decided_at = ?2,
        decided_by = ?3,
        notes = ?4
      WHERE id = ?1
    `).bind(
      requestId,
      now(),
      decidedBy,
      data.reason ||
        null
    ).run();

    await createDecision(
      db,
      requestId,
      request.student_id,
      request.circle_id,
      "accepted",
      data.reason ||
        null,
      decidedBy
    );

    await db.prepare(`
      UPDATE circle_waitlist
      SET
        status = 'accepted'
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status = 'waiting'
    `).bind(
      request.student_id,
      request.circle_id
    ).run();

    await normalizeWaitlist(
      db,
      request.circle_id
    );

    return json({
      success: true,

      status:
        "enrolled",

      request_id:
        requestId,

      enrollment:
        result.enrollment,

      subscription:
        result.subscription,

      new_circle:
        result.new_circle ||
        null,
    });
  } catch (error) {
    console.error(
      "Enrollment PATCH error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Enrollment decision failed.",
      },
      500
    );
  }
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
    return json(
      {
        success: false,
        error:
          "DB binding is not configured.",
      },
      500
    );
  }

  const url =
    new URL(
      context.request.url
    );

  const requestId =
    url.searchParams.get(
      "request_id"
    );

  const studentId =
    url.searchParams.get(
      "student_id"
    );

  const circleId =
    url.searchParams.get(
      "circle_id"
    );

  const status =
    url.searchParams.get(
      "status"
    );

  let sql = `
    SELECT
      er.*,

      s.full_name
        AS student_name,

      c.name
        AS circle_name,

      c.circle_type,

      c.capacity,

      c.status
        AS circle_status,

      (
        SELECT COUNT(*)
        FROM circle_enrollments ce
        WHERE ce.circle_id =
          er.circle_id
          AND ce.status IN (
            'pending',
            'active',
            'paused'
          )
      ) AS enrolled_count,

      (
        SELECT COUNT(*)
        FROM circle_waitlist cw
        WHERE cw.circle_id =
          er.circle_id
          AND cw.status = 'waiting'
      ) AS waitlist_count

    FROM enrollment_requests er

    LEFT JOIN students s
      ON s.id =
        er.student_id

    LEFT JOIN circles c
      ON c.id =
        er.circle_id

    WHERE 1 = 1
  `;

  const params = [];

  /* =====================================================
     Request ID
  ===================================================== */

  if (requestId) {
    params.push(
      Number(requestId)
    );

    sql +=
      ` AND er.id = ?${params.length}`;
  }

  /* =====================================================
     Student ID
  ===================================================== */

  if (studentId) {
    params.push(
      Number(studentId)
    );

    sql +=
      ` AND er.student_id = ?${params.length}`;
  }

  /* =====================================================
     Circle ID
  ===================================================== */

  if (circleId) {
    params.push(
      Number(circleId)
    );

    sql +=
      ` AND er.circle_id = ?${params.length}`;
  }

  /* =====================================================
     Status
  ===================================================== */

  if (status) {
    params.push(status);

    sql +=
      ` AND er.status = ?${params.length}`;
  }

  sql += `
    ORDER BY
      er.requested_at DESC
  `;

  try {
    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    return json({
      success: true,

      data:
        result.results || [],
    });
  } catch (error) {
    console.error(
      "Enrollment GET error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Failed to load enrollment requests.",
      },
      500
    );
  }
}
