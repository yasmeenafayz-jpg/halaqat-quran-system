/**
 * الأوَّابين
 * Enrollment API
 *
 * POST:
 *   إنشاء طلب تسجيل جديد
 *
 * PATCH:
 *   قبول / رفض / إلغاء طلب تسجيل
 *
 * GET:
 *   عرض طلبات التسجيل
 *
 * قواعد:
 * - توافق نوع الباقة مع نوع الحلقة
 * - منع التسجيل المكرر
 * - منع تجاوز السعة
 * - قائمة انتظار للحلقة الجماعية الممتلئة
 * - موافقة الإدارة
 * - الاجتماع التعريفي عند الحاجة
 * - تجربة مجانية 3 أيام افتراضيًا
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function currentISO() {
  return new Date().toISOString();
}

function today() {
  return currentISO().slice(0, 10);
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}


/* =========================================================
   Helpers
========================================================= */

async function getStudent(db, studentId) {
  return db
    .prepare(`
      SELECT *
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(studentId)
    .first();
}


async function getPackage(db, packageId) {
  return db
    .prepare(`
      SELECT *
      FROM packages
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(packageId)
    .first();
}


async function getCircle(db, circleId) {
  return db
    .prepare(`
      SELECT *
      FROM circles
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(circleId)
    .first();
}


async function getPolicy(db, circleId, packageId) {
  /*
   * الأولوية:
   *
   * 1. سياسة الحلقة + الباقة
   * 2. سياسة الحلقة
   * 3. سياسة الباقة
   * 4. السياسة العامة
   */

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
          WHEN circle_id = ?1 AND package_id = ?2 THEN 1
          WHEN circle_id = ?1 AND package_id IS NULL THEN 2
          WHEN circle_id IS NULL AND package_id = ?2 THEN 3
          WHEN circle_id IS NULL AND package_id IS NULL THEN 4
          ELSE 5
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


async function getActiveEnrollmentCount(db, circleId) {
  const result = await db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM circle_enrollments
      WHERE circle_id = ?1
        AND status = 'active'
    `)
    .bind(circleId)
    .first();

  return Number(result?.count || 0);
}


async function getExistingEnrollment(db, studentId, circleId) {
  return db
    .prepare(`
      SELECT *
      FROM circle_enrollments
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status IN ('pending', 'active', 'paused')
      LIMIT 1
    `)
    .bind(studentId, circleId)
    .first();
}


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


async function getWaitlistEntry(db, studentId, circleId) {
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


async function addToWaitlist(db, studentId, circleId) {
  const existing = await getWaitlistEntry(
    db,
    studentId,
    circleId
  );

  if (existing) {
    return existing;
  }

  const positionResult = await db
    .prepare(`
      SELECT COALESCE(MAX(position), 0) + 1 AS next_position
      FROM circle_waitlist
      WHERE circle_id = ?1
        AND status = 'waiting'
    `)
    .bind(circleId)
    .first();

  const position = Number(
    positionResult?.next_position || 1
  );

  const result = await db
    .prepare(`
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
      position,
      currentISO()
    )
    .first();

  return result;
}


async function createEnrollmentRequest(
  db,
  studentId,
  circleId,
  requestType,
  status,
  notes
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
      currentISO(),
      notes || null
    )
    .first();
}


async function createDecision(
  db,
  requestId,
  studentId,
  circleId,
  decision,
  reason,
  decidedBy
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
      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        ?6,
        ?7
      )
    `)
    .bind(
      requestId,
      studentId,
      circleId,
      decision,
      reason || null,
      decidedBy || null,
      currentISO()
    )
    .run();
}


async function createSubscription(
  db,
  studentId,
  packageId,
  circleId,
  trialDays
) {
  const start = new Date();

  const days = Math.max(
    0,
    Number(trialDays || 0)
  );

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
      currentISO()
    )
    .first();
}


async function activateEnrollment(
  db,
  studentId,
  circleId,
  packageId,
  trialDays
) {
  /*
   * منع السباق قدر الإمكان:
   * نعيد الفحص قبل إنشاء التسجيل.
   */

  const existing = await getExistingEnrollment(
    db,
    studentId,
    circleId
  );

  if (existing) {
    throw new Error(
      "Student is already enrolled in this circle."
    );
  }

  const circle = await getCircle(db, circleId);

  if (!circle) {
    throw new Error("Circle not found.");
  }

  const activeCount =
    await getActiveEnrollmentCount(
      db,
      circleId
    );

  const capacity = Number(
    circle.capacity || 0
  );

  if (
    circle.circle_type === "group" &&
    capacity > 0 &&
    activeCount >= capacity
  ) {
    throw new Error(
      "Circle capacity has been reached."
    );
  }

  const enrollment = await db
    .prepare(`
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
        'api',
        ?4,
        ?4
      )
      RETURNING *
    `)
    .bind(
      circleId,
      studentId,
      today(),
      currentISO()
    )
    .first();

  const subscription =
    await createSubscription(
      db,
      studentId,
      packageId,
      circleId,
      trialDays
    );

  if (
    circle.circle_type === "group" &&
    capacity > 0 &&
    activeCount + 1 >= capacity
  ) {
    await db
      .prepare(`
        UPDATE circles
        SET status = 'full',
            updated_at = ?2
        WHERE id = ?1
      `)
      .bind(
        circleId,
        currentISO()
      )
      .run();
  }

  return {
    enrollment,
    subscription,
  };
}


/* =========================================================
   POST
   إنشاء طلب تسجيل
========================================================= */

export async function onRequestPost(context) {
  const db = context.env.DB;

  if (!db) {
    return json(
      {
        success: false,
        error: "DB binding is not configured.",
      },
      500
    );
  }

  const body = await readBody(
    context.request
  );

  if (!body) {
    return json(
      {
        success: false,
        error: "Invalid JSON body.",
      },
      400
    );
  }

  const studentId =
    Number(body.student_id);

  const packageId =
    Number(body.package_id);

  const circleId =
    Number(body.circle_id);

  const requestType =
    body.request_type || "new";

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
    !["new", "transfer", "renewal"]
      .includes(requestType)
  ) {
    return json(
      {
        success: false,
        error: "Invalid request_type.",
      },
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
      return json(
        {
          success: false,
          error: "Student not found.",
        },
        404
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
          error: "Package not found.",
        },
        404
      );
    }

    if (pkg.status !== "active") {
      return json(
        {
          success: false,
          error: "Package is inactive.",
        },
        409
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
          success: false,
          error: "Circle not found.",
        },
        404
      );
    }

    if (
      !["active", "full"]
        .includes(circle.status)
    ) {
      return json(
        {
          success: false,
          error:
            "This circle is not accepting enrollment.",
        },
        409
      );
    }

    /*
     * إذا كانت الحلقة مرتبطة بباقة محددة،
     * يجب أن تكون الباقة المطلوبة هي نفسها.
     */
    if (
      circle.package_id !== null &&
      circle.package_id !== undefined &&
      Number(circle.package_id) !== packageId
    ) {
      return json(
        {
          success: false,
          error:
            "The selected package is not assigned to this circle.",
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

    const rule =
      await getPackageCircleRule(
        db,
        packageId,
        circle.circle_type
      );

    if (!rule) {
      return json(
        {
          success: false,
          error:
            "This package is not enabled for this circle type.",
        },
        409
      );
    }

    const policy =
      await getPolicy(
        db,
        circleId,
        packageId
      );

    if (
      policy &&
      Number(policy.allow_new_students) !== 1
    ) {
      return json(
        {
          success: false,
          error:
            "New enrollment is currently disabled.",
        },
        409
      );
    }

    const existing =
      await getExistingEnrollment(
        db,
        studentId,
        circleId
      );

    if (existing) {
      return json(
        {
          success: false,
          error:
            "Student is already enrolled in this circle.",
        },
        409
      );
    }

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
          request: pending,
        },
        409
      );
    }

    /*
     * فحص السعة.
     */
    const activeCount =
      await getActiveEnrollmentCount(
        db,
        circleId
      );

    const capacity =
      Number(circle.capacity || 0);

    const isFull =
      capacity > 0 &&
      activeCount >= capacity;

    if (
      circle.circle_type === "group" &&
      isFull
    ) {
      const allowWaitlist =
        policy
          ? Number(policy.allow_waitlist) === 1
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
        await addToWaitlist(
          db,
          studentId,
          circleId
        );

      const request =
        await createEnrollmentRequest(
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
        "Circle capacity reached.",
        null
      );

      return json(
        {
          success: true,
          status: "waitlisted",
          request_id: request.id,
          waitlist_id: waitlist.id,
          position: waitlist.position,
          message:
            "The circle is full. The student has been added to the waitlist.",
        },
        202
      );
    }

    /*
     * الاجتماع التعريفي مطلوب.
     */
    const requiresIntro =
      policy
        ? Number(
            policy.require_introductory_meeting
          ) === 1
        : false;

    if (requiresIntro) {
      const request =
        await createEnrollmentRequest(
          db,
          studentId,
          circleId,
          requestType,
          "introductory",
          body.notes ||
            "Introductory meeting required."
        );

      return json(
        {
          success: true,
          status: "introductory",
          request_id: request.id,
          message:
            "Introductory meeting is required before final enrollment.",
        },
        202
      );
    }

    /*
     * الموافقة الإدارية.
     */
    const requiresApproval =
      policy
        ? Number(
            policy.require_admin_approval
          ) === 1
        : true;

    const request =
      await createEnrollmentRequest(
        db,
        studentId,
        circleId,
        requestType,
        requiresApproval
          ? "pending"
          : "accepted",
        body.notes || null
      );

    if (requiresApproval) {
      return json(
        {
          success: true,
          status: "pending",
          request_id: request.id,
          message:
            "Enrollment request created and is waiting for administrative approval.",
        },
        202
      );
    }

    /*
     * إذا لم تكن الموافقة مطلوبة.
     */
    const trialDays =
      policy &&
      policy.trial_days !== null
        ? Number(policy.trial_days)
        : Number(pkg.trial_days || 0);

    const result =
      await activateEnrollment(
        db,
        studentId,
        circleId,
        packageId,
        trialDays
      );

    await db
      .prepare(`
        UPDATE enrollment_requests
        SET status = 'accepted',
            decided_at = ?2
        WHERE id = ?1
      `)
      .bind(
        request.id,
        currentISO()
      )
      .run();

    await createDecision(
      db,
      request.id,
      studentId,
      circleId,
      "accepted",
      "Enrollment completed automatically.",
      null
    );

    return json(
      {
        success: true,
        status: "enrolled",
        request_id: request.id,
        enrollment: result.enrollment,
        subscription: result.subscription,
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
   إدارة طلب التسجيل
========================================================= */

export async function onRequestPatch(context) {
  const db = context.env.DB;

  if (!db) {
    return json(
      {
        success: false,
        error: "DB binding is not configured.",
      },
      500
    );
  }

  const body = await readBody(
    context.request
  );

  if (!body) {
    return json(
      {
        success: false,
        error: "Invalid JSON body.",
      },
      400
    );
  }

  const requestId =
    Number(body.request_id);

  const action =
    body.action;

  const decidedBy =
    body.decided_by
      ? Number(body.decided_by)
      : null;

  if (!requestId || !action) {
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
    ].includes(action)
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

  try {
    const request =
      await db
        .prepare(`
          SELECT *
          FROM enrollment_requests
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(requestId)
        .first();

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
      ].includes(request.status)
    ) {
      return json(
        {
          success: false,
          error:
            "This enrollment request can no longer be processed.",
        },
        409
      );
    }

    const circle =
      await getCircle(
        db,
        request.circle_id
      );

    if (!circle) {
      return json(
        {
          success: false,
          error: "Circle not found.",
        },
        404
      );
    }

    /*
     * رفض الطلب
     */
    if (action === "reject") {
      await db
        .prepare(`
          UPDATE enrollment_requests
          SET status = 'rejected',
              decided_at = ?2,
              decided_by = ?3,
              notes = ?4
          WHERE id = ?1
        `)
        .bind(
          requestId,
          currentISO(),
          decidedBy,
          body.reason || null
        )
        .run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "rejected",
        body.reason ||
          "Enrollment request rejected.",
        decidedBy
      );

      return json({
        success: true,
        status: "rejected",
        request_id: requestId,
      });
    }

    /*
     * إلغاء الطلب
     */
    if (action === "cancel") {
      await db
        .prepare(`
          UPDATE enrollment_requests
          SET status = 'cancelled',
              decided_at = ?2,
              decided_by = ?3,
              notes = ?4
          WHERE id = ?1
        `)
        .bind(
          requestId,
          currentISO(),
          decidedBy,
          body.reason || null
        )
        .run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "cancelled",
        body.reason ||
          "Enrollment request cancelled.",
        decidedBy
      );

      return json({
        success: true,
        status: "cancelled",
        request_id: requestId,
      });
    }

    /*
     * القبول
     *
     * الباقة تأتي من الحلقة إن كانت محددة.
     */
    const packageId =
      circle.package_id
        ? Number(circle.package_id)
        : Number(body.package_id);

    if (!packageId) {
      return json(
        {
          success: false,
          error:
            "No package is assigned to this circle.",
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

    /*
     * فحص السعة مرة أخرى وقت الموافقة.
     */
    const activeCount =
      await getActiveEnrollmentCount(
        db,
        request.circle_id
      );

    const capacity =
      Number(circle.capacity || 0);

    if (
      circle.circle_type === "group" &&
      capacity > 0 &&
      activeCount >= capacity
    ) {
      return json(
        {
          success: false,
          status: "full",
          error:
            "The circle became full before approval.",
        },
        409
      );
    }

    const policy =
      await getPolicy(
        db,
        request.circle_id,
        packageId
      );

    const trialDays =
      policy &&
      policy.trial_days !== null
        ? Number(policy.trial_days)
        : Number(pkg.trial_days || 0);

    const result =
      await activateEnrollment(
        db,
        request.student_id,
        request.circle_id,
        packageId,
        trialDays
      );

    await db
      .prepare(`
        UPDATE enrollment_requests
        SET status = 'accepted',
            decided_at = ?2,
            decided_by = ?3
        WHERE id = ?1
      `)
      .bind(
        requestId,
        currentISO(),
        decidedBy
      )
      .run();

    await createDecision(
      db,
      requestId,
      request.student_id,
      request.circle_id,
      "accepted",
      body.reason ||
        "Enrollment approved.",
      decidedBy
    );

    /*
     * إذا كان الطالب موجودًا في قائمة الانتظار،
     * نحوله إلى accepted.
     */
    await db
      .prepare(`
        UPDATE circle_waitlist
        SET status = 'accepted'
        WHERE student_id = ?1
          AND circle_id = ?2
          AND status = 'waiting'
      `)
      .bind(
        request.student_id,
        request.circle_id
      )
      .run();

    return json({
      success: true,
      status: "enrolled",
      request_id: requestId,
      enrollment: result.enrollment,
      subscription: result.subscription,
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
   عرض طلبات التسجيل
========================================================= */

export async function onRequestGet(context) {
  const db = context.env.DB;

  if (!db) {
    return json(
      {
        success: false,
        error: "DB binding is not configured.",
      },
      500
    );
  }

  const url =
    new URL(context.request.url);

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

  const requestId =
    url.searchParams.get(
      "request_id"
    );

  let sql = `
    SELECT
      er.*,
      s.full_name AS student_name,
      c.name AS circle_name,
      c.circle_type,
      c.capacity,
      c.status AS circle_status
    FROM enrollment_requests er
    LEFT JOIN students s
      ON s.id = er.student_id
    LEFT JOIN circles c
      ON c.id = er.circle_id
    WHERE 1 = 1
  `;

  const params = [];

  if (requestId) {
    params.push(
      Number(requestId)
    );

    sql += `
      AND er.id = ?${params.length}
    `;
  }

  if (studentId) {
    params.push(
      Number(studentId)
    );

    sql += `
      AND er.student_id = ?${params.length}
    `;
  }

  if (circleId) {
    params.push(
      Number(circleId)
    );

    sql += `
      AND er.circle_id = ?${params.length}
    `;
  }

  if (status) {
    params.push(status);

    sql += `
      AND er.status = ?${params.length}
    `;
  }

  sql += `
    ORDER BY er.requested_at DESC
  `;

  try {
    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    return json({
      success: true,
      data: result.results || [],
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
