/**
 * الأوَّابين — Unified Circle Capacity
 *
 * قاعدة موحدة للسعة والتسجيل.
 *
 * الطالب يُحسب مرة واحدة فقط في الحلقة،
 * سواء كان لديه:
 * - circle_enrollment
 * - subscription مرتبط بنفس الحلقة
 */

const ACTIVE_ENROLLMENT_STATUSES = [
  "pending",
  "active",
  "paused",
];

const ACTIVE_SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "paused",
];

function normalizeType(value) {
  const type = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    type === "individual" ||
    type === "فردية" ||
    type === "فردي"
  ) {
    return "individual";
  }

  if (
    type === "group" ||
    type === "جماعية" ||
    type === "جماعي"
  ) {
    return "group";
  }

  return type;
}

export function getCircleType(circle) {
  return normalizeType(
    circle?.circle_type
  );
}

export function getCircleCapacity(circle) {
  const type =
    getCircleType(circle);

  if (type === "individual") {
    return 1;
  }

  const capacity =
    Number(circle?.capacity);

  if (
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    return null;
  }

  return capacity;
}

/**
 * الحصول على IDs الطلاب الفعليين
 * بدون تكرار بين التسجيل والاشتراك.
 */
export async function getCircleStudentIds(
  db,
  circleId
) {
  const students = new Set();

  const enrollmentResult =
    await db
      .prepare(`
        SELECT student_id
        FROM circle_enrollments
        WHERE circle_id = ?1
          AND status IN (
            'pending',
            'active',
            'paused'
          )
      `)
      .bind(circleId)
      .all();

  for (
    const row
    of enrollmentResult?.results || []
  ) {
    const studentId =
      Number(row.student_id);

    if (
      Number.isInteger(studentId) &&
      studentId > 0
    ) {
      students.add(studentId);
    }
  }

  const subscriptionResult =
    await db
      .prepare(`
        SELECT student_id
        FROM subscriptions
        WHERE circle_id = ?1
          AND status IN (
            'trial',
            'active',
            'paused'
          )
      `)
      .bind(circleId)
      .all();

  for (
    const row
    of subscriptionResult?.results || []
  ) {
    const studentId =
      Number(row.student_id);

    if (
      Number.isInteger(studentId) &&
      studentId > 0
    ) {
      students.add(studentId);
    }
  }

  return students;
}

export async function getCircleStudentCount(
  db,
  circleId
) {
  const students =
    await getCircleStudentIds(
      db,
      circleId
    );

  return students.size;
}

export async function isStudentInCircle(
  db,
  circleId,
  studentId
) {
  const students =
    await getCircleStudentIds(
      db,
      circleId
    );

  return students.has(
    Number(studentId)
  );
}

/**
 * التحقق من إمكانية إضافة طالب.
 *
 * الطالب الموجود بالفعل لا يستهلك
 * مقعدًا إضافيًا.
 */
export async function canAddStudentToCircle(
  db,
  circle,
  studentId
) {
  const capacity =
    getCircleCapacity(circle);

  if (!capacity) {
    return {
      allowed: false,
      reason:
        "INVALID_CIRCLE_CAPACITY",
      count: 0,
      effectiveCount: 0,
      capacity: null,
      alreadyInCircle: false,
    };
  }

  const students =
    await getCircleStudentIds(
      db,
      circle.id
    );

  const alreadyInCircle =
    students.has(
      Number(studentId)
    );

  const count =
    students.size;

  const effectiveCount =
    alreadyInCircle
      ? count
      : count + 1;

  return {
    allowed:
      effectiveCount <= capacity,

    alreadyInCircle,

    count,

    effectiveCount,

    capacity,

    remaining: Math.max(
      0,
      capacity - effectiveCount
    ),
  };
}

/**
 * التحقق من توافق الباقة مع الحلقة.
 */
export function validateCirclePackage(
  circle,
  pkg
) {
  if (!pkg) {
    return {
      valid: true,
    };
  }

  const circleType =
    getCircleType(circle);

  const packageType =
    normalizeType(
      pkg.package_type
    );

  if (
    circleType !== packageType
  ) {
    return {
      valid: false,
      error:
        "PACKAGE_TYPE_DOES_NOT_MATCH_CIRCLE_TYPE",
    };
  }

  if (
    pkg.status &&
    pkg.status !== "active"
  ) {
    return {
      valid: false,
      error:
        "PACKAGE_IS_INACTIVE",
    };
  }

  const circleCapacity =
    getCircleCapacity(circle);

  if (!circleCapacity) {
    return {
      valid: false,
      error:
        "INVALID_CIRCLE_CAPACITY",
    };
  }

  if (
    packageType === "group" &&
    pkg.capacity !== null &&
    pkg.capacity !== undefined
  ) {
    const packageCapacity =
      Number(pkg.capacity);

    if (
      !Number.isInteger(
        packageCapacity
      ) ||
      packageCapacity <= 0
    ) {
      return {
        valid: false,
        error:
          "INVALID_PACKAGE_CAPACITY",
      };
    }

    if (
      circleCapacity >
      packageCapacity
    ) {
      return {
        valid: false,
        error:
          "CIRCLE_CAPACITY_EXCEEDS_PACKAGE_CAPACITY",
      };
    }
  }

  return {
    valid: true,
  };
}
