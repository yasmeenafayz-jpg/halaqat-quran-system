/**
 * الأوَّابين
 * Enrollment API
 *
 * Handles:
 * - Individual / group enrollment
 * - Package/circle compatibility
 * - Capacity checking
 * - Waitlist
 * - Admin approval
 * - Introductory meeting requirement
 * - 3-day trial
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const now = () => new Date().toISOString();

async function getJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getPackage(db, packageId) {
  return await db
    .prepare(
      `SELECT *
       FROM packages
       WHERE id = ?1
       LIMIT 1`
    )
    .bind(packageId)
    .first();
}

async function getCircle(db, circleId) {
  return await db
    .prepare(
      `SELECT *
       FROM circles
       WHERE id = ?1
       LIMIT 1`
    )
    .bind(circleId)
    .first();
}

async function getPolicy(db, circleId, packageId) {
  const specific = await db
    .prepare(
      `SELECT *
       FROM enrollment_policies
       WHERE enabled = 1
         AND (
           (circle_id = ?1 AND package_id = ?2)
           OR
           (circle_id = ?1 AND package_id IS NULL)
           OR
           (circle_id IS NULL AND package_id = ?2)
         )
       ORDER BY
         CASE
           WHEN circle_id = ?1 AND package_id = ?2 THEN 1
           WHEN circle_id = ?1 AND package_id IS NULL THEN 2
           WHEN circle_id IS NULL AND package_id = ?2 THEN 3
           ELSE 4
         END
       LIMIT 1`
    )
    .bind(circleId, packageId)
    .first();

  if (specific) return specific;

  return await db
    .prepare(
      `SELECT *
       FROM enrollment_policies
       WHERE enabled = 1
         AND circle_id IS NULL
         AND package_id IS NULL
       LIMIT 1`
    )
    .first();
}

async function getPackageCircleRule(db, packageId, circleType) {
  return await db
    .prepare(
      `SELECT *
       FROM package_circle_rules
       WHERE package_id = ?1
         AND circle_type = ?2
         AND enabled = 1
       LIMIT 1`
    )
    .bind(packageId, circleType)
    .first();
}

async function getActiveEnrollmentCount(db, circleId) {
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM circle_enrollments
       WHERE circle_id = ?1
         AND status IN ('active', 'approved')`
    )
    .bind(circleId)
    .first();

  return Number(result?.count || 0);
}

async function isAlreadyEnrolled(db, studentId, circleId) {
  return await db
    .prepare(
      `SELECT id
       FROM circle_enrollments
       WHERE student_id = ?1
         AND circle_id = ?2
         AND status IN ('active', 'approved')
       LIMIT 1`
    )
    .bind(studentId, circleId)
    .first();
}

async function isAlreadyWaiting(db, studentId, circleId) {
  return await db
    .prepare(
      `SELECT id
       FROM circle_waitlist
       WHERE student_id = ?1
         AND circle_id = ?2
         AND status IN ('waiting', 'pending')
       LIMIT 1`
    )
    .bind(studentId, circleId)
    .first();
}

async function addToWaitlist(db, studentId, circleId) {
  const existing = await isAlreadyWaiting(db, studentId, circleId);

  if (existing) {
    return existing;
  }

  const result = await db
    .prepare(
      `INSERT INTO circle_waitlist (
        student_id,
        circle_id,
        status,
        created_at
      )
      VALUES (?1, ?2, 'waiting', ?3)
      RETURNING id`
    )
    .bind(studentId, circleId, now())
    .first();

  return result;
}

async function createEnrollmentRequest(
  db,
  studentId,
  circleId,
  requestType = "new",
  notes = null
) {
  return await db
    .prepare(
      `INSERT INTO enrollment_requests (
        student_id,
        circle_id,
        request_type,
        status,
        requested_at,
        notes
      )
      VALUES (?1, ?2, ?3, 'pending', ?4, ?5)
      RETURNING *`
    )
    .bind(
      studentId,
      circleId,
      requestType,
      now(),
      notes
    )
    .first();
}

async function createEnrollmentDecision(
  db,
  requestId,
  studentId,
  circleId,
  decision,
  reason = null,
  decidedBy = null
) {
  return await db
    .prepare(
      `INSERT INTO enrollment_decisions (
        enrollment_request_id,
        student_id,
        circle_id,
        decision,
        reason,
        decided_by,
        decided_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(
      requestId,
      studentId,
      circleId,
      decision,
      reason,
      decidedBy,
      now()
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
  const end = new Date(start);

  end.setDate(end.getDate() + Number(trialDays || 0));

  return await db
    .prepare(
      `INSERT INTO subscriptions (
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
      RETURNING *`
    )
    .bind(
      studentId,
      packageId,
      circleId,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
      Number(trialDays) > 0 ? "trial" : "active",
      Number(trialDays) > 0 ? end.toISOString() : null,
      now()
    )
    .first();
}

export async function onRequestPost(context) {
  const db = context.env.DB;

  if (!db) {
    return json(
      {
        success: false,
        error: "Database binding DB is not configured.",
      },
      500
    );
  }

  const body = await getJson(context.request);

  if (!body) {
    return json(
      {
        success: false,
        error: "Invalid JSON body.",
      },
      400
    );
  }

  const studentId = Number(body.student_id);
  const packageId = Number(body.package_id);
  const circleId = Number(body.circle_id);

  if (!studentId || !packageId || !circleId) {
    return json(
      {
        success: false,
        error:
          "student_id, package_id and circle_id are required.",
      },
      400
    );
  }

  try {
    const student = await db
      .prepare(
        `SELECT id
         FROM students
         WHERE id = ?1
         LIMIT 1`
      )
      .bind(studentId)
      .first();

    if (!student) {
      return json(
        {
          success: false,
          error: "Student not found.",
        },
        404
      );
    }

    const pkg = await getPackage(db, packageId);
    const circle = await getCircle(db, circleId);

    if (!pkg) {
      return json(
        {
          success: false,
          error: "Package not found.",
        },
        404
      );
    }

    if (!circle) {
      return json(
        {
          success: false,
          error: "Circle not found.",
        },
        404
      );
    }

    const circleType =
      circle.type ||
      circle.circle_type ||
      (circle.is_group ? "group" : "individual");

    if (!["individual", "group"].includes(circleType)) {
      return json(
        {
          success: false,
          error: "Invalid circle type.",
        },
        400
      );
    }

    const packageType =
      pkg.package_type ||
      pkg.type ||
      (pkg.is_group ? "group" : "individual");

    if (!["individual", "group"].includes(packageType)) {
      return json(
        {
          success: false,
          error: "Invalid package type.",
        },
        400
      );
    }

    if (packageType !== circleType) {
      return json(
        {
          success: false,
          error:
            "Package type does not match circle type.",
        },
        409
      );
    }

    const rule = await getPackageCircleRule(
      db,
      packageId,
      circleType
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

    const policy = await getPolicy(
      db,
      circleId,
      packageId
    );

    if (policy && !Number(policy.allow_new_students)) {
      return json(
        {
          success: false,
          error:
            "New student enrollment is currently disabled for this circle.",
        },
        409
      );
    }

    const existingEnrollment =
      await isAlreadyEnrolled(
        db,
        studentId,
        circleId
      );

    if (existingEnrollment) {
      return json(
        {
          success: false,
          error:
            "Student is already enrolled in this circle.",
        },
        409
      );
    }

    const activeCount =
      await getActiveEnrollmentCount(
        db,
        circleId
      );

    const capacity = Number(
      circle.capacity ??
      pkg.capacity ??
      0
    );

    if (
      circleType === "group" &&
      capacity > 0 &&
      activeCount >= capacity
    ) {
      if (
        policy &&
        Number(policy.allow_waitlist)
      ) {
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
            "new",
            "Circle is full; student added to waitlist."
          );

        await createEnrollmentDecision(
          db,
          request.id,
          studentId,
          circleId,
          "waitlisted",
          "Circle capacity reached."
        );

        return json(
          {
            success: true,
            status: "waitlisted",
            message:
              "Circle is full. Student was added to the waitlist.",
            waitlist_id: waitlist?.id || null,
            request_id: request?.id || null,
          },
          202
        );
      }

      return json(
        {
          success: false,
          status: "full",
          error:
            "Circle is full and waiting list is disabled.",
        },
        409
      );
    }

    const request =
      await createEnrollmentRequest(
        db,
        studentId,
        circleId,
        "new",
        body.notes || null
      );

    const requiresApproval =
      policy
        ? Number(policy.require_admin_approval)
        : 1;

    const requiresIntro =
      policy
        ? Number(policy.require_introductory_meeting)
        : 0;

    if (requiresApproval || requiresIntro) {
      await createEnrollmentDecision(
        db,
        request.id,
        studentId,
        circleId,
        "accepted",
        requiresIntro
          ? "Pending introductory meeting."
          : "Pending administrative approval."
      );

      return json(
        {
          success: true,
          status: requiresIntro
            ? "introductory"
            : "pending",
          request_id: request.id,
          message: requiresIntro
            ? "Introductory meeting is required before final enrollment."
            : "Enrollment request is awaiting administrative approval.",
        },
        202
      );
    }

    const subscription =
      await createSubscription(
        db,
        studentId,
        packageId,
        circleId,
        policy?.trial_days ?? 3
      );

    const enrollment =
      await db
        .prepare(
          `INSERT INTO circle_enrollments (
            student_id,
            circle_id,
            status,
            joined_at
          )
          VALUES (?1, ?2, 'active', ?3)
          RETURNING *`
        )
        .bind(
          studentId,
          circleId,
          now()
        )
        .first();

    await createEnrollmentDecision(
      db,
      request.id,
      studentId,
      circleId,
      "accepted",
      "Enrollment completed."
    );

    if (
      circleType === "group" &&
      capacity > 0 &&
      activeCount + 1 >= capacity
    ) {
      await db
        .prepare(
          `UPDATE circles
           SET status = 'full'
           WHERE id = ?1`
        )
        .bind(circleId)
        .run();
    }

    return json(
      {
        success: true,
        status: "enrolled",
        request_id: request.id,
        enrollment,
        subscription,
      },
      201
    );
  } catch (error) {
    console.error("Enrollment error:", error);

    return json(
      {
        success: false,
        error: "Enrollment operation failed.",
        details: error?.message || "Unknown error.",
      },
      500
    );
  }
}

export async function onRequestGet(context) {
  const db = context.env.DB;

  if (!db) {
    return json(
      {
        success: false,
        error: "Database binding DB is not configured.",
      },
      500
    );
  }

  const url = new URL(context.request.url);

  const studentId = url.searchParams.get("student_id");
  const circleId = url.searchParams.get("circle_id");
  const status = url.searchParams.get("status");

  let query = `
    SELECT
      er.*,
      s.name AS student_name,
      c.name AS circle_name
    FROM enrollment_requests er
    LEFT JOIN students s
      ON s.id = er.student_id
    LEFT JOIN circles c
      ON c.id = er.circle_id
    WHERE 1 = 1
  `;

  const params = [];

  if (studentId) {
    params.push(Number(studentId));
    query += ` AND er.student_id = ?${params.length}`;
  }

  if (circleId) {
    params.push(Number(circleId));
    query += ` AND er.circle_id = ?${params.length}`;
  }

  if (status) {
    params.push(status);
    query += ` AND er.status = ?${params.length}`;
  }

  query += ` ORDER BY er.requested_at DESC`;

  try {
    const result = await db
      .prepare(query)
      .bind(...params)
      .all();

    return json({
      success: true,
      data: result.results || [],
    });
  } catch (error) {
    return json(
      {
        success: false,
        error: "Failed to load enrollment requests.",
        details: error?.message || "Unknown error.",
      },
      500
    );
  }
}
