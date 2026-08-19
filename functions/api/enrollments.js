/**
 * الأوَّابين — Enrollment API
 *
 * POST  /api/enrollments
 * GET   /api/enrollments
 * PATCH /api/enrollments
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
   Basic
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

async function getEnrollment(db, studentId, circleId) {
  return db.prepare(`
    SELECT *
    FROM circle_enrollments
    WHERE student_id = ?1
      AND circle_id = ?2
    LIMIT 1
  `).bind(studentId, circleId).first();
}

async function enrollmentCount(db, circleId) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM circle_enrollments
    WHERE circle_id = ?1
      AND status IN ('pending', 'active', 'paused')
  `).bind(circleId).first();

  return Number(row?.count || 0);
}

/* =========================================================
   Policies
========================================================= */

async function getPolicy(db, circleId, packageId) {
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
        WHEN circle_id = ?1 AND package_id = ?2 THEN 1
        WHEN circle_id = ?1 AND package_id IS NULL THEN 2
        WHEN circle_id IS NULL AND package_id = ?2 THEN 3
        ELSE 4
      END
    LIMIT 1
  `).bind(circleId, packageId).first();
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
  `).bind(packageId, circleType).first();
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
      AND status IN ('pending', 'introductory')
    ORDER BY id DESC
    LIMIT 1
  `).bind(studentId, circleId).first();
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
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
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
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
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
  `).bind(studentId, circleId).first();
}

async function addWaitlist(
  db,
  studentId,
  circleId
) {
  const existing = await getWaitlist(
    db,
    studentId,
    circleId
  );

  if (existing) {
    return existing;
  }

  const row = await db.prepare(`
    SELECT COALESCE(MAX(position), 0) + 1 AS position
    FROM circle_waitlist
    WHERE circle_id = ?1
      AND status = 'waiting'
  `).bind(circleId).first();

  return db.prepare(`
    INSERT INTO circle_waitlist (
      circle_id,
      student_id,
      position,
      status,
      created_at
    )
    VALUES (?1, ?2, ?3, 'waiting', ?4)
    RETURNING *
  `).bind(
    circleId,
    studentId,
    Number(row?.position || 1),
    now()
  ).first();
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
  const start = new Date();

  const days = Math.max(
    0,
    Number(trialDays || 0)
  );

  const end = new Date(start);

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
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
    RETURNING *
  `).bind(
    studentId,
    packageId,
    circleId,
    start.toISOString().slice(0, 10),
    end.toISOString().slice(0, 10),
    days > 0 ? "trial" : "active",
    days > 0 ? end.toISOString() : null,
    now()
  ).first();
}

/* =========================================================
   Permissions
========================================================= */

async function canDecide(db, userId) {
  if (!userId) {
    return false;
  }

  const user = await db.prepare(`
    SELECT id, role, status
    FROM users
    WHERE id = ?1
    LIMIT 1
  `).bind(userId).first();

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
   Activate Enrollment
========================================================= */

async function activateEnrollment(
  db,
  studentId,
  circleId,
  packageId,
  trialDays
) {
  const circle = await getCircle(
    db,
    circleId
  );

  if (!circle) {
    throw new Error(
      "Circle not found."
    );
  }

  const existing = await getEnrollment(
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
      ].includes(existing.status)
    ) {
      throw new Error(
        "Student is already enrolled in this circle."
      );
    }

    const enrollment = await db.prepare(`
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
    };
  }

  const count =
    await enrollmentCount(
      db,
      circleId
    );

  const capacity =
    Number(circle.capacity || 0);

  if (
    circle.circle_type === "group" &&
    capacity > 0 &&
    count >= capacity
  ) {
    throw new Error(
      "Circle capacity has been reached."
    );
  }

  const enrollment = await db.prepare(`
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

  if (
    circle.circle_type === "group" &&
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
  }

  return {
    enrollment,
    subscription,
  };
}

/* =========================================================
   POST
========================================================= */

export async function onRequestPost(context) {
  const db = context.env.DB;

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

  const data = await body(
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
    Number(data.student_id);

  const packageId =
    Number(data.package_id);

  const circleId =
    Number(data.circle_id);

  const requestType =
    data.request_type || "new";

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
    ].includes(requestType)
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

    if (student.status !== "active") {
      return json(
        {
          success: false,
          error:
            "Student is not active.",
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

    if (pkg.status !== "active") {
      return json(
        {
          success: false,
          error:
            "Package is inactive.",
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
      ].includes(circle.status)
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

    if (
      circle.package_id !== null &&
      circle.package_id !== undefined &&
      Number(circle.package_id) !== packageId
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
            "New enrollment is disabled.",
        },
        409
      );
    }

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
      ].includes(existing.status)
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

    const count =
      await enrollmentCount(
        db,
        circleId
      );

    const capacity =
      Number(circle.capacity || 0);

    const full =
      circle.circle_type === "group" &&
      capacity > 0 &&
      count >= capacity;

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

      return json(
        {
          success: true,
          status: "waitlisted",
          request_id: request.id,
          waitlist_id: waitlist.id,
          position: waitlist.position,
        },
        202
      );
    }

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
          status: "introductory",
          request_id: request.id,
        },
        202
      );
    }

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
        data.notes || null
      );

    if (approvalRequired) {
      return json(
        {
          success: true,
          status: "pending",
          request_id: request.id,
        },
        202
      );
    }

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
      data.notes || null,
      null
    );

    return json(
      {
        success: true,
        status: "enrolled",
        request_id: request.id,
        enrollment:
          result.enrollment,
        subscription:
          result.subscription,
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

export async function onRequestPatch(context) {
  const db = context.env.DB;

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

  const data = await body(
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
    Number(data.request_id);

  const action =
    data.action;

  const decidedBy =
    Number(data.decided_by);

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
      `).bind(requestId).first();

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
            "This request can no longer be processed.",
        },
        409
      );
    }

    if (action === "reject") {
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
        data.reason || null
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "rejected",
        data.reason || null,
        decidedBy
      );

      return json({
        success: true,
        status: "rejected",
        request_id: requestId,
      });
    }

    if (action === "cancel") {
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
        data.reason || null
      ).run();

      await createDecision(
        db,
        requestId,
        request.student_id,
        request.circle_id,
        "cancelled",
        data.reason || null,
        decidedBy
      );

      return json({
        success: true,
        status: "cancelled",
        request_id: requestId,
      });
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
          error:
            "Circle not found.",
        },
        404
      );
    }

    const packageId =
      circle.package_id
        ? Number(circle.package_id)
        : Number(data.package_id);

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
      pkg.status !== "active" ||
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

    const count =
      await enrollmentCount(
        db,
        request.circle_id
      );

    const capacity =
      Number(circle.capacity || 0);

    if (
      circle.circle_type === "group" &&
      capacity > 0 &&
      count >= capacity
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
      data.reason || null
    ).run();

    await createDecision(
      db,
      requestId,
      request.student_id,
      request.circle_id,
      "accepted",
      data.reason || null,
      decidedBy
    );

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

    return json({
      success: true,
      status: "enrolled",
      request_id: requestId,
      enrollment:
        result.enrollment,
      subscription:
        result.subscription,
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

export async function onRequestGet(context) {
  const db = context.env.DB;

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

    sql +=
      ` AND er.id = ?${params.length}`;
  }

  if (studentId) {
    params.push(
      Number(studentId)
    );

    sql +=
      ` AND er.student_id = ?${params.length}`;
  }

  if (circleId) {
    params.push(
      Number(circleId)
    );

    sql +=
      ` AND er.circle_id = ?${params.length}`;
  }

  if (status) {
    params.push(status);

    sql +=
      ` AND er.status = ?${params.length}`;
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
