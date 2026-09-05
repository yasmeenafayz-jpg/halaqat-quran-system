import { requirePermission } from "./_auth.js";
/**
 * الأوَّابين — Enrollment API
 *
 * GET    /api/enrollments
 * GET    /api/enrollments?id=1
 * POST   /api/enrollments
 * PATCH  /api/enrollments
 *
 * التسجيل والسعة وقائمة الانتظار
 * تستخدم قاعدة موحدة مع subscriptions.
 */

import {
  getCircleCapacity,
  getCircleStudentCount,
  canAddStudentToCircle,
  validateCirclePackage,
  getCircleType,
} from "./_circle-capacity.js";

const HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",
};

const ACTIVE_STATUSES = [
  "pending",
  "active",
  "paused",
];

const ENROLLMENT_STATUSES = [
  "pending",
  "active",
  "paused",
  "completed",
  "cancelled",
];

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: HEADERS,
    }
  );
}

function error(
  message,
  status = 400,
  extra = {}
) {
  return json(
    {
      success: false,
      error: message,
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

function validId(value) {
  const number =
    Number(value);

  return (
    Number.isInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

function text(value) {
  return String(
    value ?? ""
  ).trim();
}

function activeStatus(status) {
  return ACTIVE_STATUSES.includes(
    text(status).toLowerCase()
  );
}

/* =========================================================
   Entity Scope
========================================================= */

function isPrivilegedUser(user) {
  return (
    user?.role === "admin" ||
    user?.role === "supervisor"
  );
}

async function canTeacherAccessCircle(
  db,
  user,
  circleId
) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  if (
    user?.role !== "teacher" ||
    !user?.teacher_id
  ) {
    return false;
  }

  const circle = await db
    .prepare(`
      SELECT
        id
      FROM circles
      WHERE id = ?
        AND teacher_id = ?
        AND status = 'active'
      LIMIT 1
    `)
    .bind(
      circleId,
      Number(user.teacher_id)
    )
    .first();

  return Boolean(circle);
}

async function canTeacherAccessEnrollment(
  db,
  user,
  enrollment
) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  if (
    !enrollment ||
    user?.role !== "teacher" ||
    !user?.teacher_id
  ) {
    return false;
  }

  return canTeacherAccessCircle(
    db,
    user,
    enrollment.circle_id
  );
}

/* =========================================================
   Queries
========================================================= */

async function getStudent(
  db,
  studentId
) {
  return db
    .prepare(`
      SELECT
        id,
        full_name,
        status
      FROM students
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(studentId)
    .first();
}

async function getCircle(
  db,
  circleId
) {
  return db
    .prepare(`
      SELECT
        c.*,
        t.full_name AS teacher_name,
        t.status AS teacher_status,
        p.name AS package_name,
        p.package_type,
        p.capacity AS package_capacity,
        p.status AS package_status
      FROM circles c
      LEFT JOIN teachers t
        ON t.id = c.teacher_id
      LEFT JOIN packages p
        ON p.id = c.package_id
      WHERE c.id = ?1
      LIMIT 1
    `)
    .bind(circleId)
    .first();
}

async function getPackage(
  db,
  packageId
) {
  if (!packageId) {
    return null;
  }

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

async function getEnrollment(
  db,
  studentId,
  circleId
) {
  return db
    .prepare(`
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

async function getEnrollmentById(
  db,
  enrollmentId
) {
  return db
    .prepare(`
      SELECT *
      FROM circle_enrollments
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(enrollmentId)
    .first();
}

/* =========================================================
   Waitlist
========================================================= */

async function getWaitlistEntry(
  db,
  studentId,
  circleId
) {
  return db
    .prepare(`
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

async function normalizeWaitlist(
  db,
  circleId
) {
  const result =
    await db
      .prepare(`
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
    await db
      .prepare(`
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

async function addToWaitlist(
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
    await db
      .prepare(`
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

  return db
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
      Number(
        row?.position || 1
      ),
      now()
    )
    .first();
}

async function removeFromWaitlist(
  db,
  studentId,
  circleId
) {
  await db
    .prepare(`
      UPDATE circle_waitlist
      SET status = 'cancelled'
      WHERE student_id = ?1
        AND circle_id = ?2
        AND status = 'waiting'
    `)
    .bind(
      studentId,
      circleId
    )
    .run();

  await normalizeWaitlist(
    db,
    circleId
  );
}

async function promoteNextStudent(
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
    getCircleCapacity(
      circle
    );

  if (!capacity) {
    return null;
  }

  const count =
    await getCircleStudentCount(
      db,
      circleId
    );

  if (count >= capacity) {
    return null;
  }

  const next =
    await db
      .prepare(`
        SELECT *
        FROM circle_waitlist
        WHERE circle_id = ?1
          AND status = 'waiting'
        ORDER BY
          position ASC,
          id ASC
        LIMIT 1
      `)
      .bind(circleId)
      .first();

  if (!next) {
    return null;
  }

  const student =
    await getStudent(
      db,
      next.student_id
    );

  if (
    !student ||
    (
      student.status &&
      student.status !== "active"
    )
  ) {
    await db
      .prepare(`
        UPDATE circle_waitlist
        SET status = 'rejected'
        WHERE id = ?1
      `)
      .bind(next.id)
      .run();

    await normalizeWaitlist(
      db,
      circleId
    );

    return null;
  }

  const existing =
    await getEnrollment(
      db,
      next.student_id,
      circleId
    );

  let enrollment;

  if (existing) {
    enrollment =
      await db
        .prepare(`
          UPDATE circle_enrollments
          SET
            start_date = ?2,
            end_date = NULL,
            status = 'active',
            joined_via = 'waitlist',
            updated_at = ?3
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          existing.id,
          today(),
          now()
        )
        .first();
  } else {
    enrollment =
      await db
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
            'waitlist',
            NULL,
            ?4,
            ?4
          )
          RETURNING *
        `)
        .bind(
          circleId,
          next.student_id,
          today(),
          now()
        )
        .first();
  }

  await db
    .prepare(`
      UPDATE circle_waitlist
      SET status = 'accepted'
      WHERE id = ?1
    `)
    .bind(next.id)
    .run();

  await normalizeWaitlist(
    db,
    circleId
  );

  return enrollment;
}

async function syncCircleStatus(
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
    getCircleCapacity(
      circle
    );

  if (!capacity) {
    return {
      count:
        await getCircleStudentCount(
          db,
          circleId
        ),
      capacity: null,
      status:
        "invalid_capacity",
    };
  }

  const count =
    await getCircleStudentCount(
      db,
      circleId
    );

  const type =
    getCircleType(
      circle
    );

  /*
   * الفردية لا نضعها full بسبب
   * منطق خاص في الواجهة مستقبلًا.
   * لكن عددها يظل محدودًا بواحد.
   */
  const status =
    count >= capacity
      ? "full"
      : "active";

  await db
    .prepare(`
      UPDATE circles
      SET
        status = ?2,
        updated_at = ?3
      WHERE id = ?1
        AND status NOT IN (
          'inactive',
          'archived'
        )
    `)
    .bind(
      circleId,
      status,
      now()
    )
    .run();

  return {
    count,
    capacity,
    type,
    status,
  };
}

/* =========================================================
   GET
========================================================= */

export async function onRequestGet(
  context
) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "enrollments.read"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db =
    context.env?.DB;

  if (!db) {
    return error(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const url =
    new URL(
      context.request.url
    );

  const enrollmentId =
    validId(
      url.searchParams.get(
        "id"
      )
    );

  const studentId =
    validId(
      url.searchParams.get(
        "student_id"
      )
    );

  const circleId =
    validId(
      url.searchParams.get(
        "circle_id"
      )
    );

  try {
    if (enrollmentId) {
      const row =
        await db
          .prepare(`
            SELECT
              ce.*,
              s.full_name AS student_name,
              c.name AS circle_name,
              c.circle_type,
              c.capacity,
              c.status AS circle_status,
              t.full_name AS teacher_name,
              p.name AS package_name
            FROM circle_enrollments ce
            JOIN students s
              ON s.id = ce.student_id
            JOIN circles c
              ON c.id = ce.circle_id
            LEFT JOIN teachers t
              ON t.id = c.teacher_id
            LEFT JOIN packages p
              ON p.id = c.package_id
            WHERE ce.id = ?1
            LIMIT 1
          `)
          .bind(enrollmentId)
          .first();

      if (!row) {
        return error(
          "ENROLLMENT_NOT_FOUND",
          404
        );
      }

      const allowed =
        await canTeacherAccessEnrollment(
          db,
          permission.user,
          row
        );

      if (!allowed) {
        return error(
          "ENROLLMENT_OUT_OF_SCOPE",
          403
        );
      }

      return json({
        success: true,
        data: row,
      });
    }

    let sql = `
      SELECT
        ce.*,
        s.full_name AS student_name,
        c.name AS circle_name,
        c.circle_type,
        c.capacity,
        c.status AS circle_status,
        t.full_name AS teacher_name,
        p.name AS package_name
      FROM circle_enrollments ce
      JOIN students s
        ON s.id = ce.student_id
      JOIN circles c
        ON c.id = ce.circle_id
      LEFT JOIN teachers t
        ON t.id = c.teacher_id
      LEFT JOIN packages p
        ON p.id = c.package_id
      WHERE 1 = 1
    `;

    const params = [];

    if (
      permission.user?.role === "teacher" &&
      permission.user?.teacher_id
    ) {
      params.push(
        Number(permission.user.teacher_id)
      );

      sql += `
        AND c.teacher_id = ?${params.length}
      `;
    } else if (
      !isPrivilegedUser(
        permission.user
      )
    ) {
      return error(
        "ENROLLMENT_SCOPE_DENIED",
        403
      );
    }

    if (studentId) {
      params.push(studentId);

      sql += `
        AND ce.student_id = ?${params.length}
      `;
    }

    if (circleId) {
      params.push(circleId);

      sql += `
        AND ce.circle_id = ?${params.length}
      `;
    }

    sql += `
      ORDER BY
        ce.created_at DESC,
        ce.id DESC
    `;

    const result =
      await db
        .prepare(sql)
        .bind(...params)
        .all();

    return json({
      success: true,
      data:
        result.results || [],
      count:
        result.results?.length ||
        0,
    });
  } catch (e) {
    console.error(
      "ENROLLMENTS_GET_ERROR",
      e
    );

    return error(
      "ENROLLMENTS_FETCH_FAILED",
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
  const permission = await requirePermission(
    context.request,
    context.env,
    "enrollments.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db =
    context.env?.DB;

  if (!db) {
    return error(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let data;

  try {
    data =
      await context.request.json();
  } catch {
    return error(
      "INVALID_JSON"
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    return error(
      "INVALID_REQUEST_BODY"
    );
  }

  const studentId =
    validId(
      data.student_id ??
      data.studentId
    );

  const circleId =
    validId(
      data.circle_id ??
      data.circleId
    );

  if (!studentId) {
    return error(
      "STUDENT_ID_REQUIRED"
    );
  }

  if (!circleId) {
    return error(
      "CIRCLE_ID_REQUIRED"
    );
  }

  try {
    const student =
      await getStudent(
        db,
        studentId
      );

    if (!student) {
      return error(
        "STUDENT_NOT_FOUND",
        404
      );
    }

    if (
      student.status &&
      student.status !== "active"
    ) {
      return error(
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
      return error(
        "CIRCLE_NOT_FOUND",
        404
      );
    }

    const circleAllowed =
      await canTeacherAccessCircle(
        db,
        permission.user,
        circleId
      );

    if (!circleAllowed) {
      return error(
        "CIRCLE_OUT_OF_SCOPE",
        403
      );
    }

    if (
      circle.status ===
        "inactive" ||
      circle.status ===
        "archived"
    ) {
      return error(
        "CIRCLE_NOT_AVAILABLE",
        409
      );
    }

    const type =
      getCircleType(
        circle
      );

    if (
      type !== "individual" &&
      type !== "group"
    ) {
      return error(
        "INVALID_CIRCLE_TYPE",
        409
      );
    }

    const capacity =
      getCircleCapacity(
        circle
      );

    if (!capacity) {
      return error(
        "INVALID_CIRCLE_CAPACITY",
        409
      );
    }

    const packageId =
      validId(
        data.package_id ??
        data.packageId ??
        circle.package_id
      );

    const pkg =
      await getPackage(
        db,
        packageId
      );

    const packageCheck =
      validateCirclePackage(
        circle,
        pkg
      );

    if (!packageCheck.valid) {
      return error(
        packageCheck.error,
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
      activeStatus(
        existing.status
      )
    ) {
      return error(
        "STUDENT_ALREADY_ENROLLED",
        409,
        {
          enrollment:
            existing,
        }
      );
    }

    const capacityCheck =
      await canAddStudentToCircle(
        db,
        circle,
        studentId
      );

    if (
      !capacityCheck.allowed
    ) {
      if (
        type === "group"
      ) {
        const waitlist =
          await addToWaitlist(
            db,
            studentId,
            circleId
          );

        return json(
          {
            success: true,
            waitlisted: true,
            message:
              "CIRCLE_IS_FULL_STUDENT_ADDED_TO_WAITLIST",
            data: waitlist,
          },
          201
        );
      }

      return error(
        "CIRCLE_IS_FULL",
        409
      );
    }

    const startDate =
      text(
        data.start_date ??
        data.startDate
      ) || today();

    const status =
      text(
        data.status
      ) || "active";

    if (
      !ENROLLMENT_STATUSES.includes(
        status
      )
    ) {
      return error(
        "INVALID_ENROLLMENT_STATUS"
      );
    }

    const joinedVia =
      text(
        data.joined_via ??
        data.joinedVia
      ) || null;

    const notes =
      text(data.notes) ||
      null;

    let enrollment;

    if (existing) {
      enrollment =
        await db
          .prepare(`
            UPDATE circle_enrollments
            SET
              start_date = ?2,
              end_date = NULL,
              status = ?3,
              joined_via = ?4,
              notes = ?5,
              updated_at = ?6
            WHERE id = ?1
            RETURNING *
          `)
          .bind(
            existing.id,
            startDate,
            status,
            joinedVia,
            notes,
            now()
          )
          .first();
    } else {
      enrollment =
        await db
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
              ?4,
              ?5,
              ?6,
              ?7,
              ?7
            )
            RETURNING *
          `)
          .bind(
            circleId,
            studentId,
            startDate,
            status,
            joinedVia,
            notes,
            now()
          )
          .first();
    }

    await removeFromWaitlist(
      db,
      studentId,
      circleId
    );

    await syncCircleStatus(
      db,
      circleId
    );

    return json(
      {
        success: true,
        message:
          "ENROLLMENT_CREATED_SUCCESSFULLY",
        data: enrollment,
      },
      201
    );
  } catch (e) {
    console.error(
      "ENROLLMENTS_POST_ERROR",
      e
    );

    return error(
      e instanceof Error
        ? e.message
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
  const permission = await requirePermission(
    context.request,
    context.env,
    "enrollments.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db =
    context.env?.DB;

  if (!db) {
    return error(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let data;

  try {
    data =
      await context.request.json();
  } catch {
    return error(
      "INVALID_JSON"
    );
  }

  if (
    !data ||
    typeof data !== "object"
  ) {
    return error(
      "INVALID_REQUEST_BODY"
    );
  }

  const enrollmentId =
    validId(
      data.id ??
      data.enrollment_id ??
      data.enrollmentId
    );

  if (!enrollmentId) {
    return error(
      "ENROLLMENT_ID_REQUIRED"
    );
  }

  try {
    const current =
      await getEnrollmentById(
        db,
        enrollmentId
      );

    if (!current) {
      return error(
        "ENROLLMENT_NOT_FOUND",
        404
      );
    }

    const enrollmentAllowed =
      await canTeacherAccessEnrollment(
        db,
        permission.user,
        current
      );

    if (!enrollmentAllowed) {
      return error(
        "ENROLLMENT_OUT_OF_SCOPE",
        403
      );
    }

    const newStatus =
      data.status !== undefined
        ? text(data.status)
        : current.status;

    if (
      !ENROLLMENT_STATUSES.includes(
        newStatus
      )
    ) {
      return error(
        "INVALID_ENROLLMENT_STATUS"
      );
    }

    const startDate =
      data.start_date !==
        undefined ||
      data.startDate !==
        undefined
        ? (
            text(
              data.start_date ??
              data.startDate
            ) || today()
          )
        : current.start_date;

    const endDate =
      data.end_date !==
        undefined ||
      data.endDate !==
        undefined
        ? (
            text(
              data.end_date ??
              data.endDate
            ) || null
          )
        : current.end_date;

    const joinedVia =
      data.joined_via !==
        undefined ||
      data.joinedVia !==
        undefined
        ? (
            text(
              data.joined_via ??
              data.joinedVia
            ) || null
          )
        : current.joined_via;

    const notes =
      data.notes !==
        undefined
        ? (
            text(data.notes) ||
            null
          )
        : current.notes;

    if (
      endDate &&
      endDate < startDate
    ) {
      return error(
        "END_DATE_BEFORE_START_DATE"
      );
    }

    if (
      activeStatus(
        newStatus
      ) &&
      !activeStatus(
        current.status
      )
    ) {
      const circle =
        await getCircle(
          db,
          current.circle_id
        );

      if (!circle) {
        return error(
          "CIRCLE_NOT_FOUND",
          404
        );
      }

      if (
        circle.status ===
          "inactive" ||
        circle.status ===
          "archived"
      ) {
        return error(
          "CIRCLE_NOT_AVAILABLE",
          409
        );
      }

      const capacityCheck =
        await canAddStudentToCircle(
          db,
          circle,
          current.student_id
        );

      if (
        !capacityCheck.allowed
      ) {
        if (
          getCircleType(
            circle
          ) === "group"
        ) {
          const waitlist =
            await addToWaitlist(
              db,
              current.student_id,
              current.circle_id
            );

          return json(
            {
              success: true,
              waitlisted: true,
              message:
                "CIRCLE_IS_FULL_STUDENT_ADDED_TO_WAITLIST",
              data: waitlist,
            },
            201
          );
        }

        return error(
          "CIRCLE_IS_FULL",
          409
        );
      }
    }

    const updated =
      await db
        .prepare(`
          UPDATE circle_enrollments
          SET
            start_date = ?2,
            end_date = ?3,
            status = ?4,
            joined_via = ?5,
            notes = ?6,
            updated_at = ?7
          WHERE id = ?1
          RETURNING *
        `)
        .bind(
          enrollmentId,
          startDate,
          endDate,
          newStatus,
          joinedVia,
          notes,
          now()
        )
        .first();

    if (
      newStatus ===
        "cancelled" ||
      newStatus ===
        "completed"
    ) {
      await promoteNextStudent(
        db,
        current.circle_id
      );
    }

    await syncCircleStatus(
      db,
      current.circle_id
    );

    return json({
      success: true,
      message:
        "ENROLLMENT_UPDATED_SUCCESSFULLY",
      data: updated,
    });
  } catch (e) {
    console.error(
      "ENROLLMENTS_PATCH_ERROR",
      e
    );

    return error(
      e instanceof Error
        ? e.message
        : "ENROLLMENT_UPDATE_FAILED",
      500
    );
  }
}

/* =========================================================
   Router
========================================================= */

export async function onRequest(
  context
) {
  switch (
    context.request.method.toUpperCase()
  ) {
    case "GET":
      return onRequestGet(context);

    case "POST":
      return onRequestPost(context);

    case "PATCH":
      return onRequestPatch(context);

    default:
      return error(
        "METHOD_NOT_ALLOWED",
        405
      );
  }
}
