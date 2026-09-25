/**
 * الأوَّابين — Unified Workflow Core
 *
 * طبقة مشتركة للعمليات الحرجة:
 * - enrollment
 * - subscription
 * - entitlement
 * - usage
 * - audit
 *
 * ملاحظة:
 * هذه الطبقة لا تغيّر D1 schema.
 * ولا تعتمد على واجهة المستخدم.
 */

function normalizeId(value) {
  const id = Number(value);

  return Number.isInteger(id) && id > 0
    ? id
    : null;
}

function clean(value) {
  return String(value ?? "").trim();
}

function now() {
  return new Date().toISOString();
}

function today() {
  return now().slice(0, 10);
}

/* =========================================================
   AUDIT
========================================================= */

export async function writeWorkflowAudit(
  db,
  {
    userId = null,
    action,
    entityType = null,
    entityId = null,
    details = null,
    request = null,
  } = {}
) {
  if (!db || !action) {
    return false;
  }

  try {
    const detailsJson =
      details === null
        ? null
        : typeof details === "string"
          ? details
          : JSON.stringify(details);

    await db
      .prepare(`
        INSERT INTO audit_logs (
          user_id,
          action,
          entity_type,
          entity_id,
          details,
          ip_address,
          user_agent,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        normalizeId(userId),
        clean(action),
        entityType
          ? clean(entityType)
          : null,
        normalizeId(entityId),
        detailsJson,
        request
          ? getClientIp(request)
          : null,
        request
          ? getUserAgent(request)
          : null,
        now()
      )
      .run();

    return true;
  } catch (error) {
    console.error(
      "WORKFLOW_AUDIT_FAILED",
      error
    );

    /*
     * Audit failure must never destroy
     * the primary business operation.
     */
    return false;
  }
}

/* =========================================================
   REQUEST METADATA
========================================================= */

function getClientIp(request) {
  if (!request) {
    return null;
  }

  return (
    request.headers.get(
      "CF-Connecting-IP"
    ) ||
    request.headers.get(
      "X-Forwarded-For"
    ) ||
    null
  );
}

function getUserAgent(request) {
  if (!request) {
    return null;
  }

  return (
    request.headers.get(
      "User-Agent"
    ) || null
  );
}

/* =========================================================
   IDEMPOTENCY
========================================================= */

export function getIdempotencyKey(
  request,
  explicitKey = null
) {
  const explicit =
    clean(explicitKey);

  if (explicit) {
    return explicit.slice(0, 200);
  }

  if (!request) {
    return null;
  }

  const header =
    request.headers.get(
      "Idempotency-Key"
    );

  return clean(header)
    ? clean(header).slice(0, 200)
    : null;
}

/* =========================================================
   STUDENT
========================================================= */

export async function getWorkflowStudent(
  db,
  studentId
) {
  const id =
    normalizeId(studentId);

  if (!id) {
    return null;
  }

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

/* =========================================================
   CIRCLE
========================================================= */

export async function getWorkflowCircle(
  db,
  circleId
) {
  const id =
    normalizeId(circleId);

  if (!id) {
    return null;
  }

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

/* =========================================================
   PACKAGE
========================================================= */

export async function getWorkflowPackage(
  db,
  packageId
) {
  const id =
    normalizeId(packageId);

  if (!id) {
    return null;
  }

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

/* =========================================================
   ENROLLMENT
========================================================= */

export async function getWorkflowEnrollment(
  db,
  studentId,
  circleId
) {
  const student =
    normalizeId(studentId);

  const circle =
    normalizeId(circleId);

  if (!student || !circle) {
    return null;
  }

  return db
    .prepare(`
      SELECT *
      FROM circle_enrollments
      WHERE student_id = ?1
        AND circle_id = ?2
      LIMIT 1
    `)
    .bind(student, circle)
    .first();
}

/* =========================================================
   SUBSCRIPTION
========================================================= */

export async function getWorkflowSubscription(
  db,
  subscriptionId
) {
  const id =
    normalizeId(subscriptionId);

  if (!id) {
    return null;
  }

  return db
    .prepare(`
      SELECT *
      FROM subscriptions
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();
}

export async function getActiveWorkflowSubscription(
  db,
  studentId,
  circleId = null
) {
  const student =
    normalizeId(studentId);

  if (!student) {
    return null;
  }

  const circle =
    normalizeId(circleId);

  if (circle) {
    return db
      .prepare(`
        SELECT *
        FROM subscriptions
        WHERE student_id = ?1
          AND circle_id = ?2
          AND status IN (
            'trial',
            'active',
            'paused'
          )
        ORDER BY id DESC
        LIMIT 1
      `)
      .bind(student, circle)
      .first();
  }

  return db
    .prepare(`
      SELECT *
      FROM subscriptions
      WHERE student_id = ?1
        AND status IN (
          'trial',
          'active',
          'paused'
        )
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(student)
    .first();
}

/* =========================================================
   ENTITLEMENT
========================================================= */

export async function getActiveWorkflowEntitlements(
  db,
  studentId
) {
  const student =
    normalizeId(studentId);

  if (!student) {
    return [];
  }

  const result =
    await db
      .prepare(`
        SELECT *
        FROM student_entitlements
        WHERE student_id = ?1
          AND status = 'active'
          AND used_quantity < quantity
          AND (
            valid_from IS NULL
            OR valid_from <= ?2
          )
          AND (
            valid_until IS NULL
            OR valid_until >= ?2
          )
        ORDER BY id ASC
      `)
      .bind(
        student,
        today()
      )
      .all();

  return result?.results || [];
}

/* =========================================================
   ENROLLMENT FINANCIAL COVERAGE
========================================================= */

/**
 * التحقق من أن التسجيل الفعال لديه تغطية مالية
 * واستحقاق صالح مرتبطين بنفس الطالب والحلقة والباقة.
 *
 * لا ينشئ اشتراكًا ولا Entitlement.
 * دوره تحقق فقط قبل شغل المقعد.
 */
export async function getEnrollmentCoverage(
  db,
  {
    studentId,
    circleId,
    packageId,
  } = {}
) {
  const student = normalizeId(studentId);
  const circle = normalizeId(circleId);
  const pkg = normalizeId(packageId);

  if (!student || !circle || !pkg) {
    return {
      eligible: false,
      reason: "ENROLLMENT_COVERAGE_REFERENCE_INVALID",
      subscription: null,
      entitlement: null,
    };
  }

  const subscription = await db
    .prepare(`
      SELECT *
      FROM subscriptions
      WHERE student_id = ?1
        AND circle_id = ?2
        AND package_id = ?3
        AND status IN ('trial', 'active')
      ORDER BY id DESC
      LIMIT 1
    `)
    .bind(student, circle, pkg)
    .first();

  if (!subscription) {
    return {
      eligible: false,
      reason: "SUBSCRIPTION_REQUIRED_FOR_ENROLLMENT",
      subscription: null,
      entitlement: null,
    };
  }

  const entitlement = await db
    .prepare(`
      SELECT *
      FROM student_entitlements
      WHERE student_id = ?1
        AND source_type = 'subscription'
        AND source_id = ?2
        AND status = 'active'
        AND used_quantity < quantity
        AND (
          valid_from IS NULL
          OR valid_from <= ?3
        )
        AND (
          valid_until IS NULL
          OR valid_until >= ?3
        )
      ORDER BY id ASC
      LIMIT 1
    `)
    .bind(
      student,
      normalizeId(subscription.id),
      today()
    )
    .first();

  if (!entitlement) {
    return {
      eligible: false,
      reason: "ENTITLEMENT_REQUIRED_FOR_ENROLLMENT",
      subscription,
      entitlement: null,
    };
  }

  return {
    eligible: true,
    reason: null,
    subscription,
    entitlement,
  };
}

/* =========================================================
   ISSUE ENTITLEMENT
========================================================= */

export async function issueWorkflowEntitlement(
  db,
  {
    studentId,
    sourceType,
    sourceId = null,
    entitlementType,
    title = null,
    quantity = 1,
    durationMinutes = null,
    validFrom = null,
    validUntil = null,
    notes = null,
    createdBy = null,
  } = {}
) {
  const student =
    normalizeId(studentId);

  const source =
    clean(sourceType);

  const type =
    clean(entitlementType);

  const amount =
    Number(quantity);

  const duration =
    durationMinutes === null ||
    durationMinutes === undefined ||
    durationMinutes === ""
      ? null
      : Number(durationMinutes);

  const sourceTypes = new Set([
    "subscription",
    "individual_booking",
    "sponsorship",
    "manual",
  ]);

  const entitlementTypes = new Set([
    "session",
    "minute",
    "class",
    "level",
    "month",
    "custom",
  ]);

  if (
    !student ||
    !sourceTypes.has(source) ||
    !entitlementTypes.has(type) ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "INVALID_ENTITLEMENT_DATA"
    );
  }

  if (
    duration !== null &&
    (!Number.isFinite(duration) ||
      duration <= 0)
  ) {
    throw new Error(
      "INVALID_ENTITLEMENT_DURATION"
    );
  }

  const normalizedSourceId =
    normalizeId(sourceId);

  const entitlementTitle =
    clean(title) ||
    `${type} entitlement`;

  const existing =
    await db
      .prepare(`
        SELECT *
        FROM student_entitlements
        WHERE student_id = ?1
          AND source_type = ?2
          AND (
            source_id = ?3
            OR (
              source_id IS NULL
              AND ?3 IS NULL
            )
          )
          AND entitlement_type = ?4
          AND status IN ('pending', 'active')
        ORDER BY id DESC
        LIMIT 1
      `)
      .bind(
        student,
        source,
        normalizedSourceId,
        type
      )
      .first();

  if (existing) {
    return existing;
  }

  const created =
    await db
      .prepare(`
        INSERT INTO student_entitlements (
          student_id,
          source_type,
          source_id,
          entitlement_type,
          title,
          quantity,
          used_quantity,
          duration_minutes,
          valid_from,
          valid_until,
          status,
          notes,
          created_by,
          updated_by,
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
          0,
          ?7,
          ?8,
          ?9,
          'active',
          ?10,
          ?11,
          ?11,
          ?12,
          ?12
        )
        RETURNING *
      `)
      .bind(
        student,
        source,
        normalizedSourceId,
        type,
        entitlementTitle,
        amount,
        duration,
        validFrom || today(),
        validUntil || null,
        notes || null,
        normalizeId(createdBy),
        now()
      )
      .first();

  if (!created) {
    throw new Error(
      "ENTITLEMENT_CREATE_FAILED"
    );
  }

  await writeWorkflowAudit(
    db,
    {
      userId: createdBy,
      action:
        "workflow.entitlement.issued",
      entityType:
        "student_entitlement",
      entityId:
        created.id,
      details: {
        student_id: student,
        source_type: source,
        source_id:
          normalizedSourceId,
        entitlement_type: type,
        title: entitlementTitle,
        quantity: amount,
        duration_minutes: duration,
        valid_from:
          validFrom || today(),
        valid_until:
          validUntil || null,
      },
    }
  );

  return created;
}


/* =========================================================
   SUBSCRIPTION → ENTITLEMENT
========================================================= */

export async function issueSubscriptionEntitlement(
  db,
  {
    subscription,
    packageData,
    createdBy = null,
  } = {}
) {
  if (!subscription) {
    throw new Error(
      "SUBSCRIPTION_REQUIRED"
    );
  }

  if (!packageData) {
    throw new Error(
      "PACKAGE_REQUIRED"
    );
  }

  const studentId =
    normalizeId(
      subscription.student_id
    );

  const subscriptionId =
    normalizeId(
      subscription.id
    );

  if (
    !studentId ||
    !subscriptionId
  ) {
    throw new Error(
      "INVALID_SUBSCRIPTION_REFERENCE"
    );
  }

  const sessionsPerMonth =
    Number(
      packageData.sessions_per_month || 0
    );

  const durationMinutes =
    Number(
      packageData.duration_minutes || 0
    );

  /*
   * لا ننشئ entitlement جلسات لباقة
   * لا تحتوي على جلسات شهرية.
   */
  if (
    !Number.isInteger(
      sessionsPerMonth
    ) ||
    sessionsPerMonth <= 0
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      durationMinutes
    ) ||
    durationMinutes <= 0
  ) {
    throw new Error(
      "INVALID_PACKAGE_DURATION"
    );
  }

  /*
   * كمية الاستحقاق مصدرها عقد الباقة.
   *
   * في حالة Trial لا نغير عدد الجلسات
   * إلى رقم مفترض؛ بل نستخدم sessions_per_month
   * مع تقييد valid_until بتاريخ انتهاء التجربة.
   *
   * بهذا تظل سياسة عدد جلسات التجربة
   * قابلة للتغيير لاحقًا دون تغيير عقد
   * الاشتراك نفسه.
   */
  const isTrial =
    subscription.status === "trial";

  const quantity =
    sessionsPerMonth;

  const title =
    isTrial
      ? `تجربة — ${clean(packageData.name) || "باقة"}`
      : clean(packageData.name) ||
        "اشتراك";

  const validFrom =
    clean(
      subscription.start_date
    ) || today();

  const validUntil =
    clean(
      subscription.end_date
    ) ||
    (
      isTrial
        ? clean(
            subscription.trial_ends_at
          ) || null
        : null
    );

  return issueWorkflowEntitlement(
    db,
    {
      studentId,
      sourceType:
        "subscription",
      sourceId:
        subscriptionId,
      entitlementType:
        "session",
      title,
      quantity,
      durationMinutes,
      validFrom,
      validUntil,
      notes:
        `Subscription #${subscriptionId}`,
      createdBy,
    }
  );
}

/* =========================================================
   ENTITLEMENT USAGE
========================================================= */

export async function consumeWorkflowEntitlement(
  db,
  {
    entitlementId,
    studentId,
    quantity = 1,
    usageType,
    referenceType = null,
    referenceId = null,
    sessionId = null,
    bookingId = null,
    notes = null,
    createdBy = null,
  } = {}
) {
  const entitlement =
    normalizeId(entitlementId);

  const student =
    normalizeId(studentId);

  const amount =
    Number(quantity);

  const normalizedUsageType =
    clean(usageType);

  const usageTypes = new Set([
    "session",
    "minute",
    "class",
    "level",
    "month",
    "manual",
    "refund",
  ]);

  if (
    !entitlement ||
    !student ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !usageTypes.has(
      normalizedUsageType
    )
  ) {
    throw new Error(
      "INVALID_ENTITLEMENT_USAGE"
    );
  }

  /*
   * منع تكرار الاستهلاك قبل أي كتابة.
   * الـ UNIQUE indexes في D1 تظل الحاجز النهائي.
   */
  if (sessionId !== null) {
    const duplicateSession =
      await db
        .prepare(`
          SELECT *
          FROM student_entitlement_usage
          WHERE entitlement_id = ?1
            AND session_id = ?2
          LIMIT 1
        `)
        .bind(
          entitlement,
          normalizeId(sessionId)
        )
        .first();

    if (duplicateSession) {
      return {
        usage: duplicateSession,
        entitlement:
          await db
            .prepare(`
              SELECT *
              FROM student_entitlements
              WHERE id = ?1
              LIMIT 1
            `)
            .bind(entitlement)
            .first(),
        duplicate: true,
      };
    }
  }

  if (bookingId !== null) {
    const duplicateBooking =
      await db
        .prepare(`
          SELECT *
          FROM student_entitlement_usage
          WHERE entitlement_id = ?1
            AND booking_id = ?2
          LIMIT 1
        `)
        .bind(
          entitlement,
          normalizeId(bookingId)
        )
        .first();

    if (duplicateBooking) {
      return {
        usage: duplicateBooking,
        entitlement:
          await db
            .prepare(`
              SELECT *
              FROM student_entitlements
              WHERE id = ?1
              LIMIT 1
            `)
            .bind(entitlement)
            .first(),
        duplicate: true,
      };
    }
  }

  const row =
    await db
      .prepare(`
        SELECT *
        FROM student_entitlements
        WHERE id = ?1
          AND student_id = ?2
          AND status = 'active'
          AND (
            valid_from IS NULL
            OR valid_from <= ?3
          )
          AND (
            valid_until IS NULL
            OR valid_until >= ?3
          )
        LIMIT 1
      `)
      .bind(
        entitlement,
        student,
        today()
      )
      .first();

  if (!row) {
    throw new Error(
      "ENTITLEMENT_NOT_AVAILABLE"
    );
  }

  const remaining =
    Number(row.quantity || 0) -
    Number(row.used_quantity || 0);

  if (
    amount > remaining
  ) {
    throw new Error(
      "ENTITLEMENT_INSUFFICIENT"
    );
  }

  const reference =
    referenceType || null;

  /*
   * تسجيل الاستخدام ثم تحديث الرصيد
   * داخل batch واحد.
   *
   * إذا فشل INSERT بسبب UNIQUE constraint
   * أو فشل أي statement في العملية،
   * لا نعتمد على نتيجة جزئية.
   */
  const statements = [
    db.prepare(`
      INSERT INTO student_entitlement_usage (
        entitlement_id,
        student_id,
        usage_type,
        quantity,
        reference_type,
        reference_id,
        session_id,
        booking_id,
        notes,
        created_by,
        created_at
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
        ?9,
        ?10,
        ?11
      )
      RETURNING *
    `).bind(
      entitlement,
      student,
      normalizedUsageType,
      amount,
      reference,
      normalizeId(referenceId),
      normalizeId(sessionId),
      normalizeId(bookingId),
      notes || null,
      normalizeId(createdBy),
      now()
    ),

    db.prepare(`
      UPDATE student_entitlements
      SET
        used_quantity =
          used_quantity + ?2,
        status =
          CASE
            WHEN used_quantity + ?2 >= quantity
            THEN 'exhausted'
            ELSE 'active'
          END,
        updated_by = ?3,
        updated_at = ?4
      WHERE id = ?1
        AND student_id = ?5
        AND status = 'active'
        AND used_quantity + ?2 <= quantity
      RETURNING *
    `).bind(
      entitlement,
      amount,
      normalizeId(createdBy),
      now(),
      student
    ),
  ];

  const results =
    await db.batch(statements);

  const usageResult =
    results?.[0];

  const entitlementResult =
    results?.[1];

  const usage =
    usageResult?.results?.[0];

  const updated =
    entitlementResult?.results?.[0];

  if (!usage || !updated) {
    throw new Error(
      "ENTITLEMENT_USAGE_UPDATE_FAILED"
    );
  }

  await writeWorkflowAudit(
    db,
    {
      userId: createdBy,
      action:
        "workflow.entitlement.consumed",
      entityType:
        "student_entitlement",
      entityId:
        entitlement,
      details: {
        student_id: student,
        quantity: amount,
        usage_type:
          normalizedUsageType,
        reference_type:
          reference,
        reference_id:
          normalizeId(referenceId),
        session_id:
          normalizeId(sessionId),
        booking_id:
          normalizeId(bookingId),
        resulting_status:
          updated.status,
        used_quantity:
          updated.used_quantity,
        remaining_quantity:
          Number(updated.quantity || 0) -
          Number(updated.used_quantity || 0),
      },
    }
  );

  return {
    usage,
    entitlement: updated,
    duplicate: false,
  };
}



/* =========================================================
   RESTORE INDIVIDUAL BOOKING ENTITLEMENT
========================================================= */

export async function restoreIndividualBookingEntitlement(
  db,
  {
    bookingId,
    createdBy = null,
    reason = "Individual booking cancelled",
  }
) {
  const booking = normalizeId(bookingId);
  const actor = normalizeId(createdBy);

  if (!booking) {
    throw new Error(
      "INVALID_INDIVIDUAL_BOOKING_ID"
    );
  }

  const createdAt = now();

  /*
   * Find the real entitlement consumption belonging to
   * this individual booking.
   *
   * Normal pay-per-session bookings have no matching row
   * and therefore are intentionally left untouched.
   */
  const consumed = await db
    .prepare(`
      SELECT
        u.id AS usage_id,
        u.entitlement_id,
        u.student_id,
        u.quantity,
        u.session_id,
        u.booking_id,
        e.quantity AS entitlement_quantity,
        e.used_quantity AS entitlement_used_quantity,
        e.status AS entitlement_status
      FROM student_entitlement_usage u
      JOIN student_entitlements e
        ON e.id = u.entitlement_id
      WHERE u.booking_id = ?1
        AND u.usage_type = 'session'
        AND u.reference_type = 'individual_booking'
      ORDER BY u.id DESC
      LIMIT 1
    `)
    .bind(booking)
    .first();

  if (!consumed) {
    return {
      restored: false,
      reason: "NO_ENTITLEMENT_CONSUMPTION",
      bookingId: booking,
    };
  }

  const quantity = Number(consumed.quantity || 1);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(
      "INVALID_ENTITLEMENT_RESTORE_QUANTITY"
    );
  }

  /*
   * The unique migration guard ensures that only one restore
   * ledger row can exist for an individual booking.
   *
   * IMPORTANT:
   * The refund INSERT and entitlement balance UPDATE are now
   * executed inside ONE D1 batch, so they succeed or fail
   * together.
   */
  const statements = [
    db.prepare(`
      INSERT INTO student_entitlement_usage (
        entitlement_id,
        student_id,
        usage_type,
        quantity,
        reference_type,
        reference_id,
        session_id,
        booking_id,
        notes,
        created_by,
        created_at
      )
      VALUES (
        ?1,
        ?2,
        'refund',
        ?3,
        'individual_booking_restore',
        ?4,
        NULL,
        NULL,
        ?5,
        ?6,
        ?7
      )
      ON CONFLICT DO NOTHING
      RETURNING *
    `).bind(
      consumed.entitlement_id,
      consumed.student_id,
      quantity,
      booking,
      reason,
      actor,
      createdAt
    ),

    db.prepare(`
      UPDATE student_entitlements
      SET
        used_quantity =
          CASE
            WHEN used_quantity >= ?2
            THEN used_quantity - ?2
            ELSE 0
          END,
        status = 'active',
        updated_by = ?3,
        updated_at = ?5
      WHERE id = ?1
        AND used_quantity > 0
        AND used_quantity >= ?2
        AND NOT EXISTS (
          SELECT 1
          FROM student_entitlement_usage existing_restore
          WHERE existing_restore.reference_type =
            'individual_booking_restore'
            AND existing_restore.reference_id = ?4
        )
      RETURNING *
    `).bind(
      consumed.entitlement_id,
      quantity,
      actor,
      booking,
      createdAt
    ),
  ];

  const results = await db.batch(statements);

  const restore =
    results?.[0]?.results?.[0] ?? null;

  const restoredEntitlement =
    results?.[1]?.results?.[0] ?? null;

  /*
   * If the restore row already existed, D1 returned no INSERT
   * row. Treat this as an already-restored booking.
   */
  if (!restore) {
    return {
      restored: false,
      reason: "ALREADY_RESTORED",
      bookingId: booking,
      entitlementId:
        consumed.entitlement_id,
    };
  }

  /*
   * The INSERT and UPDATE are one transaction.
   * Therefore reaching this point means both succeeded.
   */
  if (!restoredEntitlement) {
    throw new Error(
      "ENTITLEMENT_RESTORE_BALANCE_UPDATE_FAILED"
    );
  }

  try {
    await writeWorkflowAudit(
      db,
      {
        userId: actor,
        action:
          "workflow.entitlement.individual_booking_restored",
      entityType:
        "student_entitlement",
      entityId:
        consumed.entitlement_id,
      details: {
        student_id:
          consumed.student_id,
        booking_id:
          booking,
        original_usage_id:
          consumed.usage_id,
        restore_usage_id:
          restore.id,
        quantity,
        reason,
        used_quantity:
          restoredEntitlement.used_quantity,
        remaining_quantity:
          Number(
            restoredEntitlement.quantity || 0
          ) -
          Number(
            restoredEntitlement.used_quantity || 0
          ),
        },
      }
    );
  } catch (auditError) {
    console.error(
      "INDIVIDUAL_BOOKING_RESTORE_AUDIT_ERROR",
      auditError
    );
  }

  return {
    restored: true,
    bookingId: booking,
    entitlementId:
      consumed.entitlement_id,
    usageId:
      restore.id,
    entitlement:
      restoredEntitlement,
  };
}

/* =========================================================
   ATOMIC INDIVIDUAL BOOKING + ENTITLEMENT + SESSION
========================================================= */

export async function consumeEntitlementWithIndividualBookingSession(
  db,
  {
    studentId,
    entitlementId,
    bookingId,
    circleId = null,
    teacherId,
    sessionDate,
    startTime,
    endTime,
    durationMinutes = null,
    notes = null,
    createdBy = null,
  }
) {
  const student = normalizeId(studentId);
  const entitlement = normalizeId(entitlementId);
  const booking = normalizeId(bookingId);
  const teacher = normalizeId(teacherId);
  const circle = normalizeId(circleId);
  const duration =
    durationMinutes == null
      ? null
      : Number(durationMinutes);

  if (!student || !entitlement || !booking || !teacher) {
    throw new Error("INVALID_ENTITLEMENT_BOOKING_INPUT");
  }

  if (!sessionDate || !startTime || !endTime) {
    throw new Error("INVALID_SESSION_TIME");
  }

  if (
    duration !== null &&
    (!Number.isFinite(duration) || duration <= 0)
  ) {
    throw new Error("INVALID_SESSION_DURATION");
  }

  const createdAt = now();

  /*
   * IMPORTANT:
   * The entire operation is one D1 batch.
   *
   * 1) Create the official individual session.
   * 2) Attach that exact session to the booking.
   * 3) Consume one entitlement unit.
   * 4) Record the usage against the booking/session.
   *
   * If any statement fails, D1 rolls back the batch.
   */

  const statements = [
    db.prepare(`
      INSERT INTO sessions (
        circle_id,
        teacher_id,
        student_id,
        session_type,
        session_date,
        start_time,
        end_time,
        meeting_provider,
        meeting_url,
        status,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        ?1,
        ?2,
        ?3,
        'individual',
        ?4,
        ?5,
        ?6,
        NULL,
        NULL,
        'scheduled',
        ?7,
        ?8,
        ?8
      )
    `).bind(
      circle,
      teacher,
      student,
      sessionDate,
      startTime,
      endTime,
      notes || `Individual booking #${booking}`,
      createdAt
    ),

    /*
     * last_insert_rowid() is still the session id here because
     * this UPDATE does not create another row.
     */
    db.prepare(`
      UPDATE individual_schedule_bookings
      SET
        session_id = last_insert_rowid(),
        updated_at = ?2
      WHERE id = ?1
        AND student_id = ?3
        AND status = 'confirmed'
        AND session_id IS NULL
    `).bind(
      booking,
      createdAt,
      student
    ),

    /*
     * Record the consumption against the exact session now
     * stored on the booking.
     */
    db.prepare(`
      INSERT INTO student_entitlement_usage (
        entitlement_id,
        student_id,
        usage_type,
        quantity,
        reference_type,
        reference_id,
        session_id,
        booking_id,
        notes,
        created_by,
        created_at
      )
      SELECT
        ?1,
        ?2,
        'session',
        1,
        'individual_booking',
        ?3,
        b.session_id,
        b.id,
        ?4,
        ?5,
        ?6
      FROM individual_schedule_bookings b
      WHERE b.id = ?3
        AND b.student_id = ?2
        AND b.session_id IS NOT NULL
      RETURNING *
    `).bind(
      entitlement,
      student,
      booking,
      notes || `Entitlement consumed for individual booking #${booking}`,
      normalizeId(createdBy),
      createdAt
    ),

    /*
     * Guard the balance against concurrent consumption.
     */
    db.prepare(`
      UPDATE student_entitlements
      SET
        used_quantity = used_quantity + 1,
        status =
          CASE
            WHEN used_quantity + 1 >= quantity
            THEN 'exhausted'
            ELSE 'active'
          END,
        updated_by = ?2,
        updated_at = ?3
      WHERE id = ?1
        AND student_id = ?4
        AND status = 'active'
        AND used_quantity + 1 <= quantity
      RETURNING *
    `).bind(
      entitlement,
      normalizeId(createdBy),
      createdAt,
      student
    ),
  ];

  const results = await db.batch(statements);

  const sessionId =
    results?.[0]?.meta?.last_row_id;

  const bookingUpdate =
    results?.[1];

  const usage =
    results?.[2]?.results?.[0];

  const updatedEntitlement =
    results?.[3]?.results?.[0];

  if (!sessionId) {
    throw new Error("INDIVIDUAL_SESSION_CREATION_FAILED");
  }

  if (
    !bookingUpdate?.meta?.changes ||
    bookingUpdate.meta.changes !== 1
  ) {
    throw new Error(
      "INDIVIDUAL_BOOKING_SESSION_ATTACH_FAILED"
    );
  }

  if (!usage) {
    throw new Error(
      "ENTITLEMENT_USAGE_CREATION_FAILED"
    );
  }

  if (!updatedEntitlement) {
    throw new Error(
      "ENTITLEMENT_BALANCE_UPDATE_FAILED"
    );
  }

  try {
    await writeWorkflowAudit(
      db,
      {
        userId: createdBy,
        action:
          "workflow.entitlement.individual_booking_consumed",
      entityType:
        "student_entitlement",
      entityId:
        entitlement,
      details: {
        student_id: student,
        booking_id: booking,
        session_id: sessionId,
        quantity: 1,
        usage_type: "session",
        source_type: "subscription",
        resulting_status:
          updatedEntitlement.status,
        used_quantity:
          updatedEntitlement.used_quantity,
        remaining_quantity:
          Number(updatedEntitlement.quantity || 0) -
          Number(updatedEntitlement.used_quantity || 0),
        },
      }
    );
  } catch (auditError) {
    console.error(
      "INDIVIDUAL_BOOKING_CONSUME_AUDIT_ERROR",
      auditError
    );
  }

  return {
    sessionId,
    bookingId: booking,
    usage,
    entitlement: updatedEntitlement,
  };
}

/* =========================================================
   ATOMIC SUBSCRIPTION + ENTITLEMENT
========================================================= */

export async function createSubscriptionWithEntitlement(
  db,
  {
    studentId,
    packageId,
    circleId = null,
    startDate,
    endDate = null,
    status = "active",
    trialEndsAt = null,
    notes = null,
    packageData,
    createdBy = null,
  } = {}
) {
  const student =
    normalizeId(studentId);

  const packageIdValue =
    normalizeId(packageId);

  const circle =
    circleId === null ||
    circleId === undefined
      ? null
      : normalizeId(circleId);

  if (!student || !packageIdValue) {
    throw new Error(
      "INVALID_SUBSCRIPTION_REFERENCE"
    );
  }

  if (!packageData) {
    throw new Error(
      "PACKAGE_REQUIRED"
    );
  }

  const sessionsPerMonth =
    Number(
      packageData.sessions_per_month || 0
    );

  const durationMinutes =
    Number(
      packageData.duration_minutes || 0
    );

  if (
    sessionsPerMonth < 0 ||
    !Number.isInteger(
      sessionsPerMonth
    )
  ) {
    throw new Error(
      "INVALID_PACKAGE_SESSIONS"
    );
  }

  if (
    sessionsPerMonth > 0 &&
    (
      !Number.isFinite(
        durationMinutes
      ) ||
      durationMinutes <= 0
    )
  ) {
    throw new Error(
      "INVALID_PACKAGE_DURATION"
    );
  }

  const createdAt =
    now();

  /*
   * D1 batch is atomic.
   *
   * Statement 1 creates the subscription.
   *
   * Statement 2 uses SQLite's
   * last_insert_rowid() from the same
   * batch execution context to reference
   * the subscription created immediately
   * before it.
   *
   * لذلك لا نعتمد على:
   * - ORDER BY id DESC
   * - مطابقة قيم قديمة
   * - last_row_id من طلب منفصل
   */

  const statements = [
    db.prepare(`
      INSERT INTO subscriptions (
        student_id,
        package_id,
        circle_id,
        start_date,
        end_date,
        status,
        trial_ends_at,
        notes,
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
        ?9,
        ?9
      )
    `).bind(
      student,
      packageIdValue,
      circle,
      startDate,
      endDate,
      status,
      trialEndsAt,
      notes,
      createdAt
    ),
  ];

  /*
   * الباقات التي لا تحتوي على جلسات شهرية
   * تنشئ الاشتراك فقط.
   */
  if (sessionsPerMonth > 0) {
    const isTrial =
      status === "trial";

    const quantity =
      sessionsPerMonth;

    const title =
      isTrial
        ? `تجربة — ${
            clean(packageData.name) ||
            "باقة"
          }`
        : clean(packageData.name) ||
          "اشتراك";

    statements.push(
      db.prepare(`
        INSERT INTO student_entitlements (
          student_id,
          source_type,
          source_id,
          entitlement_type,
          title,
          quantity,
          used_quantity,
          duration_minutes,
          valid_from,
          valid_until,
          status,
          notes,
          created_by,
          updated_by,
          created_at,
          updated_at
        )
        SELECT
          ?1,
          'subscription',
          last_insert_rowid(),
          'session',
          ?2,
          ?3,
          0,
          ?4,
          ?5,
          ?6,
          'active',
          ?7,
          ?8,
          ?8,
          ?9,
          ?9
      `).bind(
        student,
        title,
        quantity,
        durationMinutes,
        startDate,
        trialEndsAt || endDate || null,
        notes,
        normalizeId(createdBy),
        createdAt
      )
    );
  }

  const results =
    await db.batch(
      statements
    );

  const subscriptionInsert =
    results?.[0];

  if (
    !subscriptionInsert ||
    Number(
      subscriptionInsert.meta?.changes || 0
    ) !== 1
  ) {
    throw new Error(
      "SUBSCRIPTION_CREATE_FAILED"
    );
  }

  if (sessionsPerMonth > 0) {
    const entitlementInsert =
      results?.[1];

    if (
      !entitlementInsert ||
      Number(
        entitlementInsert.meta?.changes || 0
      ) !== 1
    ) {
      throw new Error(
        "SUBSCRIPTION_ENTITLEMENT_CREATE_FAILED"
      );
    }
  }

  /*
   * last_row_id هنا يُقرأ فقط من نتيجة
   * INSERT الأولى بعد نجاح الـbatch.
   *
   * لا نستخدمه لربط entitlement؛
   * الربط تم داخل نفس الـbatch بواسطة
   * last_insert_rowid().
   */
  const subscriptionId =
    normalizeId(
      subscriptionInsert
        ?.meta
        ?.last_row_id
    );

  if (!subscriptionId) {
    throw new Error(
      "SUBSCRIPTION_ID_NOT_AVAILABLE"
    );
  }

  const subscription =
    await db
      .prepare(`
        SELECT *
        FROM subscriptions
        WHERE id = ?1
        LIMIT 1
      `)
      .bind(
        subscriptionId
      )
      .first();

  if (!subscription) {
    throw new Error(
      "SUBSCRIPTION_CREATED_BUT_NOT_FOUND"
    );
  }

  await writeWorkflowAudit(
    db,
    {
      userId:
        createdBy,
      action:
        "workflow.subscription.created",
      entityType:
        "subscription",
      entityId:
        subscription.id,
      details: {
        student_id:
          student,
        package_id:
          packageIdValue,
        circle_id:
          circle,
        status,
        entitlement_sessions:
          sessionsPerMonth,
      },
    }
  );

  return subscription;
}

/* =========================================================
   EXPORT DATE HELPERS
========================================================= */

export {
  normalizeId,
  clean,
  now,
  today,
};
