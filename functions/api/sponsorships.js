import {
  requirePermission,
  json,
} from "./_auth.js";

const SCOPE_TYPES = [
  "student",
  "seats",
  "months",
  "level",
];

const STATUSES = [
  "pending",
  "active",
  "paused",
  "completed",
  "cancelled",
  "expired",
];

const BENEFICIARY_STATUSES = [
  "active",
  "paused",
  "completed",
  "cancelled",
];

const ALLOCATION_STATUSES = [
  "allocated",
  "partially_used",
  "used",
  "cancelled",
];

const PAYMENT_STATUSES = [
  "pending",
  "completed",
  "cancelled",
  "refunded",
];

function clean(value) {
  return String(value ?? "").trim();
}

function nullable(value) {
  const valueClean = clean(value);
  return valueClean ? valueClean : null;
}

function validId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function validAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(clean(value));
}

function now() {
  return new Date().toISOString();
}

function errorResponse(code, status = 400, extra = {}) {
  return json(
    {
      success: false,
      error: code,
      ...extra,
    },
    status
  );
}

function validateScope(scopeType) {
  return SCOPE_TYPES.includes(scopeType)
    ? null
    : "INVALID_SPONSORSHIP_SCOPE";
}

function validateStatus(status) {
  return STATUSES.includes(status)
    ? null
    : "INVALID_SPONSORSHIP_STATUS";
}

function validateBeneficiaryStatus(status) {
  return BENEFICIARY_STATUSES.includes(status)
    ? null
    : "INVALID_BENEFICIARY_STATUS";
}

function validateAllocationStatus(status) {
  return ALLOCATION_STATUSES.includes(status)
    ? null
    : "INVALID_ALLOCATION_STATUS";
}

function validatePaymentStatus(status) {
  return PAYMENT_STATUSES.includes(status)
    ? null
    : "INVALID_SPONSORSHIP_PAYMENT_STATUS";
}

async function getStudent(db, studentId) {
  if (!validId(studentId)) {
    return null;
  }

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
    .bind(Number(studentId))
    .first();
}

async function getLevel(db, levelId) {
  if (!validId(levelId)) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        id,
        name,
        status
      FROM quran_levels
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(Number(levelId))
    .first();
}

async function getSubscription(db, subscriptionId) {
  if (!validId(subscriptionId)) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        id,
        student_id,
        package_id,
        circle_id,
        start_date,
        end_date,
        status
      FROM subscriptions
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(Number(subscriptionId))
    .first();
}

async function getBillingCycle(db, billingCycleId) {
  if (!validId(billingCycleId)) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        id,
        student_id,
        subscription_id,
        billing_month,
        total_amount,
        paid_amount,
        sponsored_amount,
        remaining_amount,
        status
      FROM billing_cycles
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(Number(billingCycleId))
    .first();
}

async function getSponsorship(db, sponsorshipId) {
  if (!validId(sponsorshipId)) {
    return null;
  }

  return db
    .prepare(`
      SELECT
        s.id,
        s.sponsor_user_id,
        s.sponsor_name,
        s.sponsor_phone,
        s.sponsor_email,
        s.title,
        s.notes,
        s.scope_type,
        s.target_student_id,
        s.target_level_id,
        s.allocated_seats,
        s.allocated_months,
        s.total_amount,
        s.remaining_amount,
        s.currency,
        s.start_date,
        s.end_date,
        s.status,
        s.is_anonymous,
        s.created_by,
        s.created_at,
        s.updated_at,

        st.full_name AS target_student_name,
        ql.name AS target_level_name,
        (SELECT COALESCE(SUM(CASE WHEN sp.status = 'completed' THEN sp.amount WHEN sp.status = 'refunded' THEN -sp.amount ELSE 0 END), 0) FROM sponsorship_payments sp WHERE sp.sponsorship_id = s.id) AS funded_amount,
        (SELECT COALESCE(SUM(sa.allocated_amount), 0) FROM sponsorship_allocations sa WHERE sa.sponsorship_id = s.id AND sa.status != 'cancelled') AS allocated_amount,
        creator.full_name AS created_by_name

      FROM sponsorships s

      LEFT JOIN students st
        ON st.id = s.target_student_id

      LEFT JOIN quran_levels ql
        ON ql.id = s.target_level_id

      LEFT JOIN users creator
        ON creator.id = s.created_by

      WHERE s.id = ?1
      LIMIT 1
    `)
    .bind(Number(sponsorshipId))
    .first();
}

async function getFundingTotals(db, sponsorshipId) {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN status = 'completed'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS funded_amount,

        COALESCE(
          SUM(
            CASE
              WHEN status = 'refunded'
              THEN amount
              ELSE 0
            END
          ),
          0
        ) AS refunded_amount

      FROM sponsorship_payments
      WHERE sponsorship_id = ?1
    `)
    .bind(Number(sponsorshipId))
    .first();

  return {
    funded_amount: Number(row?.funded_amount || 0),
    refunded_amount: Number(row?.refunded_amount || 0),
  };
}

async function getAllocationTotals(db, sponsorshipId) {
  const row = await db
    .prepare(`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN status != 'cancelled'
              THEN allocated_amount
              ELSE 0
            END
          ),
          0
        ) AS allocated_amount,

        COALESCE(
          SUM(
            CASE
              WHEN status != 'cancelled'
              THEN used_amount
              ELSE 0
            END
          ),
          0
        ) AS used_amount

      FROM sponsorship_allocations
      WHERE sponsorship_id = ?1
    `)
    .bind(Number(sponsorshipId))
    .first();

  return {
    allocated_amount: Number(row?.allocated_amount || 0),
    used_amount: Number(row?.used_amount || 0),
  };
}

async function refreshSponsorshipTotals(db, sponsorshipId) {
  const funding = await getFundingTotals(
    db,
    sponsorshipId
  );

  const allocations = await getAllocationTotals(
    db,
    sponsorshipId
  );

  const funded = Math.max(
    0,
    funding.funded_amount -
      funding.refunded_amount
  );

  const remaining = Math.max(
    0,
    funded - allocations.allocated_amount
  );

  await db
    .prepare(`
      UPDATE sponsorships
      SET
        total_amount = ?1,
        remaining_amount = ?2,
        updated_at = ?3
      WHERE id = ?4
    `)
    .bind(
      funded,
      remaining,
      now(),
      Number(sponsorshipId)
    )
    .run();

  return {
    total_amount: funded,
    remaining_amount: remaining,
    allocated_amount: allocations.allocated_amount,
    used_amount: allocations.used_amount,
  };
}

async function getDetails(db, sponsorshipId) {
  const sponsorship = await getSponsorship(
    db,
    sponsorshipId
  );

  if (!sponsorship) {
    return null;
  }

  const totals = await refreshSponsorshipTotals(
    db,
    sponsorshipId
  );

  const beneficiaries = await db
    .prepare(`
      SELECT
        sb.id,
        sb.sponsorship_id,
        sb.student_id,
        sb.allocated_months,
        sb.allocated_amount,
        sb.used_months,
        sb.used_amount,
        sb.status,
        sb.started_at,
        sb.ended_at,
        sb.created_at,
        sb.updated_at,

        st.full_name AS student_name

      FROM sponsorship_beneficiaries sb

      JOIN students st
        ON st.id = sb.student_id

      WHERE sb.sponsorship_id = ?1

      ORDER BY
        sb.created_at DESC,
        sb.id DESC
    `)
    .bind(Number(sponsorshipId))
    .all();

  const allocations = await db
    .prepare(`
      SELECT
        sa.id,
        sa.sponsorship_id,
        sa.student_id,
        sa.subscription_id,
        sa.billing_cycle_id,
        sa.allocated_amount,
        sa.used_amount,
        sa.status,
        sa.notes,
        sa.created_by,
        sa.created_at,
        sa.updated_at,

        st.full_name AS student_name

      FROM sponsorship_allocations sa

      JOIN students st
        ON st.id = sa.student_id

      WHERE sa.sponsorship_id = ?1

      ORDER BY
        sa.created_at DESC,
        sa.id DESC
    `)
    .bind(Number(sponsorshipId))
    .all();

  const payments = await db
    .prepare(`
      SELECT
        sp.id,
        sp.sponsorship_id,
        sp.payment_id,
        sp.amount,
        sp.currency,
        sp.status,
        sp.paid_at,
        sp.notes,
        sp.created_by,
        sp.created_at,
        sp.updated_at,

        u.full_name AS created_by_name

      FROM sponsorship_payments sp

      LEFT JOIN users u
        ON u.id = sp.created_by

      WHERE sp.sponsorship_id = ?1

      ORDER BY
        sp.created_at DESC,
        sp.id DESC
    `)
    .bind(Number(sponsorshipId))
    .all();

  return {
    ...sponsorship,
    total_amount: totals.total_amount,
    remaining_amount: totals.remaining_amount,
    allocated_amount: totals.allocated_amount,
    used_amount: totals.used_amount,
    beneficiaries: beneficiaries.results || [],
    allocations: allocations.results || [],
    payments: payments.results || [],
  };
}

export async function onRequestGet(context) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "sponsorships.read"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      if (!validId(id)) {
        return errorResponse(
          "INVALID_SPONSORSHIP_ID"
        );
      }

      const details = await getDetails(
        db,
        Number(id)
      );

      if (!details) {
        return errorResponse(
          "SPONSORSHIP_NOT_FOUND",
          404
        );
      }

      return json({
        success: true,
        data: details,
      });
    }

    const status = clean(
      url.searchParams.get("status")
    ).toLowerCase();

    const scopeType = clean(
      url.searchParams.get("scope_type")
    ).toLowerCase();

    const studentId = url.searchParams.get(
      "student_id"
    );

    if (status) {
      const error = validateStatus(status);

      if (error) {
        return errorResponse(error);
      }
    }

    if (scopeType) {
      const error = validateScope(scopeType);

      if (error) {
        return errorResponse(error);
      }
    }

    if (
      studentId &&
      !validId(studentId)
    ) {
      return errorResponse(
        "INVALID_STUDENT_ID"
      );
    }

    let sql = `
      SELECT
        s.id,
        s.sponsor_user_id,
        s.sponsor_name,
        s.title,
        s.scope_type,
        s.target_student_id,
        s.target_level_id,
        s.allocated_seats,
        s.allocated_months,
        s.total_amount,
        s.remaining_amount,
        s.currency,
        s.start_date,
        s.end_date,
        s.status,
        s.is_anonymous,
        s.created_by,
        s.created_at,
        s.updated_at,

        (SELECT COALESCE(SUM(CASE WHEN sp.status = 'completed' THEN sp.amount WHEN sp.status = 'refunded' THEN -sp.amount ELSE 0 END), 0) FROM sponsorship_payments sp WHERE sp.sponsorship_id = s.id) AS funded_amount,

        (SELECT COALESCE(SUM(sa.allocated_amount), 0) FROM sponsorship_allocations sa WHERE sa.sponsorship_id = s.id AND sa.status != 'cancelled') AS allocated_amount,

        (SELECT COALESCE(SUM(CASE WHEN sp.status = 'completed' THEN sp.amount WHEN sp.status = 'refunded' THEN -sp.amount ELSE 0 END), 0) FROM sponsorship_payments sp WHERE sp.sponsorship_id = s.id) - (SELECT COALESCE(SUM(sa.allocated_amount), 0) FROM sponsorship_allocations sa WHERE sa.sponsorship_id = s.id AND sa.status != 'cancelled') AS available_amount,

        st.full_name AS target_student_name,
        ql.name AS target_level_name

      FROM sponsorships s

      LEFT JOIN students st
        ON st.id = s.target_student_id

      LEFT JOIN quran_levels ql
        ON ql.id = s.target_level_id

      WHERE 1 = 1
    `;

    const params = [];

    if (status) {
      params.push(status);

      sql += `
        AND s.status = ?${params.length}
      `;
    }

    if (scopeType) {
      params.push(scopeType);

      sql += `
        AND s.scope_type = ?${params.length}
      `;
    }

    if (studentId) {
      params.push(Number(studentId));

      sql += `
        AND (
          s.target_student_id = ?${params.length}
          OR EXISTS (
            SELECT 1
            FROM sponsorship_beneficiaries sb
            WHERE
              sb.sponsorship_id = s.id
              AND sb.student_id = ?${params.length}
              AND sb.status != 'cancelled'
          )
        )
      `;
    }

    sql += `
      ORDER BY
        s.created_at DESC,
        s.id DESC
    `;

    const result = await db
      .prepare(sql)
      .bind(...params)
      .all();

    return json({
      success: true,
      data: result.results || [],
    });
  } catch (error) {
    return errorResponse(
      "SPONSORSHIP_GET_FAILED",
      500,
      {
        detail: String(
          error?.message || error
        ),
      }
    );
  }
}

export async function onRequestPost(context) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "sponsorships.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let data;

  try {
    data = await context.request.json();
  } catch {
    return errorResponse("INVALID_JSON");
  }

  const action = clean(
    data.action
  ).toLowerCase();

  if (
    action &&
    !["create", "fund", "beneficiary", "allocate", "apply"].includes(action)
  ) {
    return errorResponse(
      "UNSUPPORTED_SPONSORSHIP_ACTION"
    );
  }

  try {
    if (action === "apply") {
      const allocationId = data.allocation_id ?? data.allocationId;
      if (!validId(allocationId)) return errorResponse("ALLOCATION_ID_REQUIRED");
      const allocation = await getAllocation(db, Number(allocationId));
      if (!allocation) return errorResponse("SPONSORSHIP_ALLOCATION_NOT_FOUND", 404);
      if (!validId(allocation.billing_cycle_id)) return errorResponse("BILLING_CYCLE_REQUIRED", 409);
      if (allocation.status === "cancelled") return errorResponse("SPONSORSHIP_ALLOCATION_CANCELLED", 409);
      const sponsorship = await getSponsorship(db, Number(allocation.sponsorship_id));
      if (!sponsorship) return errorResponse("SPONSORSHIP_NOT_FOUND", 404);
      if (sponsorship.status !== "active") return errorResponse("SPONSORSHIP_NOT_ACTIVE", 409);
      const existingUsage = await db.prepare("SELECT id FROM sponsorship_billing_usage WHERE sponsorship_allocation_id = ?1 AND billing_cycle_id = ?2 AND status = 'applied' LIMIT 1").bind(Number(allocation.id), Number(allocation.billing_cycle_id)).first();
      if (existingUsage) return errorResponse("SPONSORSHIP_BILLING_ALREADY_APPLIED", 409, { usage_id: Number(existingUsage.id) });
      const applied = await applySponsorshipToBilling(db, allocation, permission.user?.id ?? null);
      if (!applied.ok) return applied.response;
      return json({ success: true, message: "SPONSORSHIP_APPLIED_SUCCESSFULLY", data: { amount: applied.amount, billing_cycle_id: applied.billing_cycle_id, allocation: await getAllocation(db, Number(allocation.id)), sponsorship: await getDetails(db, Number(allocation.sponsorship_id)) } });
    }

    if (action === "allocate") {
      const sponsorshipId = data.sponsorship_id ?? data.sponsorshipId;
      const studentId = data.student_id ?? data.studentId;
      const subscriptionId = data.subscription_id ?? data.subscriptionId ?? null;
      const billingCycleId = data.billing_cycle_id ?? data.billingCycleId ?? null;
      const amount = Number(data.amount);

      if (!validId(sponsorshipId)) return errorResponse("SPONSORSHIP_ID_REQUIRED");
      if (!validId(studentId)) return errorResponse("STUDENT_ID_REQUIRED");
      if (!validAmount(amount)) return errorResponse("ALLOCATION_AMOUNT_REQUIRED");

      const sponsorship = await getSponsorship(db, Number(sponsorshipId));
      if (!sponsorship) return errorResponse("SPONSORSHIP_NOT_FOUND", 404);
      if (sponsorship.status !== "active") return errorResponse("SPONSORSHIP_NOT_ACTIVE", 409);

      const eligibility = await validateSponsorshipStudent(db, sponsorship, Number(studentId));
      if (!eligibility.ok) return eligibility.response;

      const beneficiary = await getBeneficiary(db, Number(sponsorshipId), Number(studentId));
      if (!beneficiary || beneficiary.status !== "active") {
        return errorResponse("SPONSORSHIP_BENEFICIARY_REQUIRED", 409);
      }

      const funding = await getSponsorshipFunding(db, Number(sponsorshipId));
      if (amount > Number(funding.available || 0)) {
        return errorResponse("SPONSORSHIP_INSUFFICIENT_AVAILABLE_FUNDS", 409, {
          available_amount: Number(funding.available || 0)
        });
      }

      if (subscriptionId !== null && !validId(subscriptionId)) {
        return errorResponse("INVALID_SUBSCRIPTION_ID");
      }

      if (billingCycleId !== null && !validId(billingCycleId)) {
        return errorResponse("INVALID_BILLING_CYCLE_ID");
      }

      if (subscriptionId !== null) {
        const subscription = await db.prepare("SELECT id, student_id FROM subscriptions WHERE id = ?1 LIMIT 1").bind(Number(subscriptionId)).first();
        if (!subscription) return errorResponse("SUBSCRIPTION_NOT_FOUND", 404);
        if (Number(subscription.student_id) !== Number(studentId)) {
          return errorResponse("SUBSCRIPTION_STUDENT_MISMATCH", 409);
        }
      }

      if (billingCycleId !== null) {
        const billingCycle = await getBillingCycle(db, Number(billingCycleId));
        if (!billingCycle) return errorResponse("BILLING_CYCLE_NOT_FOUND", 404);
        if (Number(billingCycle.student_id) !== Number(studentId)) {
          return errorResponse("BILLING_CYCLE_STUDENT_MISMATCH", 409);
        }
        if (subscriptionId !== null && Number(billingCycle.subscription_id) !== Number(subscriptionId)) {
          return errorResponse("BILLING_CYCLE_SUBSCRIPTION_MISMATCH", 409);
        }
        if (["cancelled", "paid"].includes(clean(billingCycle.status).toLowerCase())) {
          return errorResponse("BILLING_CYCLE_NOT_ALLOCATABLE", 409);
        }

        const billingRemaining = Math.max(0, Number(billingCycle.total_amount || 0) - Number(billingCycle.paid_amount || 0) - Number(billingCycle.sponsored_amount || 0));

        if (amount > billingRemaining) {
          return errorResponse("SPONSORSHIP_AMOUNT_EXCEEDS_BILLING_REMAINING", 409, { billing_remaining_amount: billingRemaining });
        }

        const duplicateAllocation = await db.prepare("SELECT id FROM sponsorship_allocations WHERE sponsorship_id = ?1 AND student_id = ?2 AND billing_cycle_id = ?3 AND status <> 'cancelled' LIMIT 1").bind(Number(sponsorshipId), Number(studentId), Number(billingCycleId)).first();

        if (duplicateAllocation) {
          return errorResponse("SPONSORSHIP_BILLING_ALLOCATION_EXISTS", 409, { allocation_id: Number(duplicateAllocation.id) });
        }
      }

      const result = await db.prepare("INSERT INTO sponsorship_allocations (sponsorship_id, student_id, subscription_id, billing_cycle_id, allocated_amount, used_amount, status, notes, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'allocated', ?6, ?7, ?8, ?8)").bind(
        Number(sponsorshipId),
        Number(studentId),
        subscriptionId !== null ? Number(subscriptionId) : null,
        billingCycleId !== null ? Number(billingCycleId) : null,
        Number(amount.toFixed(2)),
        nullable(data.notes),
        permission.user?.id ?? null,
        now()
      ).run();

      const allocationId = result.meta?.last_row_id;
      if (!validId(allocationId)) return errorResponse("SPONSORSHIP_ALLOCATION_FAILED", 500);

      await refreshSponsorshipTotals(db, Number(sponsorshipId));

      return json({
        success: true,
        message: "SPONSORSHIP_ALLOCATED_SUCCESSFULLY",
        data: {
          allocation: await getAllocation(db, Number(allocationId)),
          sponsorship: await getDetails(db, Number(sponsorshipId))
        }
      }, 201);
    }

    if (action === "beneficiary") {
      const sponsorshipSeatsSetting = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'academy.sponsorship_seats_open' AND scope_type = 'global' LIMIT 1").first();
      const sponsorshipSeatsOpen =
        sponsorshipSeatsSetting?.setting_value === true ||
        sponsorshipSeatsSetting?.setting_value === 1 ||
        String(sponsorshipSeatsSetting?.setting_value).toLowerCase() === "true" ||
        String(sponsorshipSeatsSetting?.setting_value) === "1";

      if (!sponsorshipSeatsOpen) {
        return errorResponse("SPONSORSHIP_SEATS_CLOSED", 409);
      }

      const sponsorshipId =
        data.sponsorship_id ??
        data.sponsorshipId;

      const studentId =
        data.student_id ??
        data.studentId;

      if (!validId(sponsorshipId)) {
        return errorResponse(
          "SPONSORSHIP_ID_REQUIRED"
        );
      }

      if (!validId(studentId)) {
        return errorResponse(
          "STUDENT_ID_REQUIRED"
        );
      }

      const sponsorship =
        await getSponsorship(
          db,
          Number(sponsorshipId)
        );

      if (!sponsorship) {
        return errorResponse(
          "SPONSORSHIP_NOT_FOUND",
          404
        );
      }

      if (
        !["active"].includes(
          sponsorship.status
        )
      ) {
        return errorResponse(
          "SPONSORSHIP_NOT_ACTIVE",
          409
        );
      }

      const eligibility =
        await validateSponsorshipStudent(
          db,
          sponsorship,
          Number(studentId)
        );

      if (!eligibility.ok) {
        return eligibility.response;
      }

      const existing =
        await getBeneficiary(
          db,
          Number(sponsorshipId),
          Number(studentId)
        );

      if (existing) {
        return errorResponse(
          "SPONSORSHIP_BENEFICIARY_ALREADY_EXISTS",
          409
        );
      }

      if (
        sponsorship.scope_type === "seats"
      ) {
        const row =
          await db
            .prepare(`
              SELECT COUNT(*) AS count
              FROM sponsorship_beneficiaries
              WHERE sponsorship_id = ?1
                AND status != 'cancelled'
            `)
            .bind(
              Number(sponsorshipId)
            )
            .first();

        if (
          Number(row?.count || 0) >=
          Number(sponsorship.allocated_seats || 0)
        ) {
          return errorResponse(
            "SPONSORSHIP_SEAT_LIMIT_REACHED",
            409
          );
        }
      }

      const requestedMonths =
        data.allocated_months ??
        data.allocatedMonths ??
        null;

      const requestedAmount =
        data.allocated_amount ??
        data.allocatedAmount ??
        0;

      if (
        requestedMonths !== null &&
        (
          !Number.isInteger(
            Number(requestedMonths)
          ) ||
          Number(requestedMonths) <= 0
        )
      ) {
        return errorResponse(
          "INVALID_BENEFICIARY_MONTHS"
        );
      }

      if (
        !validAmount(
          Number(requestedAmount)
        )
      ) {
        return errorResponse(
          "INVALID_BENEFICIARY_AMOUNT"
        );
      }

      if (
        sponsorship.scope_type === "months"
      ) {
        if (
          requestedMonths === null ||
          !Number.isInteger(
            Number(requestedMonths)
          ) ||
          Number(requestedMonths) <= 0
        ) {
          return errorResponse(
            "SPONSORSHIP_MONTHS_REQUIRED"
          );
        }

        const row =
          await db
            .prepare(`
              SELECT
                COALESCE(
                  SUM(
                    CASE
                      WHEN status != 'cancelled'
                      THEN COALESCE(allocated_months,0)
                      ELSE 0
                    END
                  ),
                  0
                ) AS allocated_months
              FROM sponsorship_beneficiaries
              WHERE sponsorship_id = ?1
            `)
            .bind(
              Number(sponsorshipId)
            )
            .first();

        const allocatedMonthsTotal =
          Number(
            row?.allocated_months || 0
          );

        const newMonths =
          Number(requestedMonths);

        if (
          allocatedMonthsTotal + newMonths >
          Number(sponsorship.allocated_months || 0)
        ) {
          return errorResponse(
            "SPONSORSHIP_MONTH_LIMIT_REACHED",
            409
          );
        }
      }

      const userId =
        permission.user?.id ?? null;

      const beneficiary =
        await ensureBeneficiary(
          db,
          sponsorship,
          Number(studentId),
          requestedMonths,
          Number(requestedAmount),
          userId
        );

      const details =
        await getDetails(
          db,
          Number(sponsorshipId)
        );

      return json({
        success: true,
        message:
          "SPONSORSHIP_BENEFICIARY_CREATED_SUCCESSFULLY",
        data: {
          beneficiary,
          sponsorship: details,
        },
      }, 201);
    }

    if (action === "fund") {
      const sponsorshipId =
        data.sponsorship_id ??
        data.sponsorshipId;

      const amount = Number(
        data.amount
      );

      if (!validId(sponsorshipId)) {
        return errorResponse(
          "SPONSORSHIP_ID_REQUIRED"
        );
      }

      if (!validAmount(amount)) {
        return errorResponse(
          "FUNDING_AMOUNT_REQUIRED"
        );
      }

      const sponsorship =
        await getSponsorship(
          db,
          Number(sponsorshipId)
        );

      if (!sponsorship) {
        return errorResponse(
          "SPONSORSHIP_NOT_FOUND",
          404
        );
      }

      if (
        !["pending", "active"].includes(
          sponsorship.status
        )
      ) {
        return errorResponse(
          "SPONSORSHIP_NOT_FUNDABLE",
          409
        );
      }

      const paymentStatus =
        clean(
          data.status
        ).toLowerCase() ||
        "completed";

      if (
        !PAYMENT_STATUSES.includes(
          paymentStatus
        )
      ) {
        return errorResponse(
          "INVALID_PAYMENT_STATUS"
        );
      }

      if (
        paymentStatus !== "completed"
      ) {
        return errorResponse(
          "SPONSORSHIP_FUNDING_MUST_BE_COMPLETED",
          409
        );
      }

      const paymentId =
        data.payment_id ??
        data.paymentId ??
        null;

      if (
        paymentId !== null &&
        !validId(paymentId)
      ) {
        return errorResponse(
          "INVALID_PAYMENT_ID"
        );
      }

      if (paymentId !== null) {
        const linkedPayment =
          await db
            .prepare(`
              SELECT
                id,
                student_id,
                amount,
                currency,
                status,
                paid_at
              FROM payments
              WHERE id = ?1
              LIMIT 1
            `)
            .bind(Number(paymentId))
            .first();

        if (!linkedPayment) {
          return errorResponse(
            "PAYMENT_NOT_FOUND",
            404
          );
        }

        if (
          clean(linkedPayment.status).toLowerCase() !==
          "completed"
        ) {
          return errorResponse(
            "SPONSORSHIP_PAYMENT_NOT_COMPLETED",
            409
          );
        }

        if (
          Number(linkedPayment.amount) !==
          Number(amount)
        ) {
          return errorResponse(
            "SPONSORSHIP_PAYMENT_AMOUNT_MISMATCH",
            409
          );
        }

        if (
          clean(linkedPayment.currency).toUpperCase() !==
          clean(data.currency || sponsorship.currency || "EGP").toUpperCase()
        ) {
          return errorResponse(
            "SPONSORSHIP_PAYMENT_CURRENCY_MISMATCH",
            409
          );
        }

        const duplicate =
          await db
            .prepare(`
              SELECT id
              FROM sponsorship_payments
              WHERE payment_id = ?1
                AND status != 'cancelled'
              LIMIT 1
            `)
            .bind(Number(paymentId))
            .first();

        if (duplicate) {
          return errorResponse(
            "SPONSORSHIP_PAYMENT_ALREADY_RECORDED",
            409
          );
        }
      }

      const userId =
        permission.user?.id ?? null;

      const paidAt =
        nullable(
          data.paid_at ??
          data.paidAt
        ) || now();

      const result =
        await db
          .prepare(`
            INSERT INTO sponsorship_payments (
              sponsorship_id,
              payment_id,
              amount,
              currency,
              status,
              paid_at,
              notes,
              created_by,
              created_at,
              updated_at
            )
            VALUES (
              ?1, ?2, ?3, ?4,
              'completed', ?5, ?6,
              ?7, ?5, ?5
            )
          `)
          .bind(
            Number(sponsorshipId),
            paymentId !== null
              ? Number(paymentId)
              : null,
            Number(amount.toFixed(2)),
            clean(data.currency) ||
              sponsorship.currency ||
              "EGP",
            paidAt,
            nullable(data.notes),
            userId
          )
          .run();

      if (
        !validId(
          result.meta?.last_row_id
        )
      ) {
        return errorResponse(
          "SPONSORSHIP_FUNDING_FAILED",
          500
        );
      }

      await db
        .prepare(`
          UPDATE sponsorships
          SET
            status = CASE
              WHEN status = pending
              THEN active
              ELSE status
            END,
            updated_at = ?1
          WHERE id = ?2
        `)
        .bind(
          now(),
          Number(sponsorshipId)
        )
        .run();

      const details =
        await getDetails(
          db,
          Number(sponsorshipId)
        );

      return json({
        success: true,
        message:
          "SPONSORSHIP_FUNDED_SUCCESSFULLY",
        data: details,
      }, 201);
    }
    const sponsorName = clean(
      data.sponsor_name ??
      data.sponsorName
    );

    const scopeType = clean(
      data.scope_type ??
      data.scopeType
    ).toLowerCase();

    const targetStudentId =
      data.target_student_id ??
      data.targetStudentId;

    const targetLevelId =
      data.target_level_id ??
      data.targetLevelId;

    const allocatedSeats =
      data.allocated_seats ??
      data.allocatedSeats;

    const allocatedMonths =
      data.allocated_months ??
      data.allocatedMonths;

    const startDate = nullable(
      data.start_date ??
      data.startDate
    );

    const endDate = nullable(
      data.end_date ??
      data.endDate
    );

    if (!sponsorName) {
      return errorResponse(
        "SPONSOR_NAME_REQUIRED"
      );
    }

    const scopeError = validateScope(
      scopeType
    );

    if (scopeError) {
      return errorResponse(scopeError);
    }

    if (
      startDate &&
      !validDate(startDate)
    ) {
      return errorResponse(
        "INVALID_START_DATE"
      );
    }

    if (
      endDate &&
      !validDate(endDate)
    ) {
      return errorResponse(
        "INVALID_END_DATE"
      );
    }

    if (
      startDate &&
      endDate &&
      endDate < startDate
    ) {
      return errorResponse(
        "END_DATE_BEFORE_START_DATE"
      );
    }

    if (
      targetStudentId &&
      !validId(targetStudentId)
    ) {
      return errorResponse(
        "INVALID_TARGET_STUDENT_ID"
      );
    }

    if (
      targetLevelId &&
      !validId(targetLevelId)
    ) {
      return errorResponse(
        "INVALID_TARGET_LEVEL_ID"
      );
    }

    if (
      scopeType === "student" &&
      !validId(targetStudentId)
    ) {
      return errorResponse(
        "TARGET_STUDENT_REQUIRED"
      );
    }

    if (
      scopeType === "level" &&
      !validId(targetLevelId)
    ) {
      return errorResponse(
        "TARGET_LEVEL_REQUIRED"
      );
    }

    if (
      scopeType === "seats" &&
      (
        !Number.isInteger(
          Number(allocatedSeats)
        ) ||
        Number(allocatedSeats) <= 0
      )
    ) {
      return errorResponse(
        "ALLOCATED_SEATS_REQUIRED"
      );
    }

    if (
      scopeType === "months" &&
      (
        !Number.isInteger(
          Number(allocatedMonths)
        ) ||
        Number(allocatedMonths) <= 0
      )
    ) {
      return errorResponse(
        "ALLOCATED_MONTHS_REQUIRED"
      );
    }

    if (targetStudentId) {
      const student = await getStudent(
        db,
        Number(targetStudentId)
      );

      if (!student) {
        return errorResponse(
          "TARGET_STUDENT_NOT_FOUND",
          404
        );
      }
    }

    if (targetLevelId) {
      const level = await getLevel(
        db,
        Number(targetLevelId)
      );

      if (!level) {
        return errorResponse(
          "TARGET_LEVEL_NOT_FOUND",
          404
        );
      }
    }

    const userId =
      permission.user?.id ?? null;

    const sponsorUserId =
      data.sponsor_user_id ??
      data.sponsorUserId ??
      userId;

    if (
      sponsorUserId !== null &&
      !validId(sponsorUserId)
    ) {
      return errorResponse(
        "INVALID_SPONSOR_USER_ID"
      );
    }

    const result = await db
      .prepare(`
        INSERT INTO sponsorships (
          sponsor_user_id,
          sponsor_name,
          sponsor_phone,
          sponsor_email,
          title,
          notes,
          scope_type,
          target_student_id,
          target_level_id,
          allocated_seats,
          allocated_months,
          total_amount,
          remaining_amount,
          currency,
          start_date,
          end_date,
          status,
          is_anonymous,
          created_by,
          created_at,
          updated_at
        )
        VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6,
          ?7, ?8, ?9, ?10, ?11,
          0, 0, ?12, ?13, ?14,
          'pending', ?15, ?16, ?17, ?17
        )
      `)
      .bind(
        sponsorUserId !== null
          ? Number(sponsorUserId)
          : null,

        sponsorName,

        nullable(
          data.sponsor_phone ??
          data.sponsorPhone
        ),

        nullable(
          data.sponsor_email ??
          data.sponsorEmail
        ),

        nullable(data.title),
        nullable(data.notes),

        scopeType,

        targetStudentId
          ? Number(targetStudentId)
          : null,

        targetLevelId
          ? Number(targetLevelId)
          : null,

        allocatedSeats
          ? Number(allocatedSeats)
          : null,

        allocatedMonths
          ? Number(allocatedMonths)
          : null,

        clean(data.currency) || "EGP",

        startDate,
        endDate,

        data.is_anonymous ? 1 : 0,

        userId,
        now()
      )
      .run();

    const sponsorshipId =
      result.meta?.last_row_id;

    if (!validId(sponsorshipId)) {
      return errorResponse(
        "SPONSORSHIP_CREATE_FAILED",
        500
      );
    }

    const details = await getDetails(
      db,
      sponsorshipId
    );

    return json({
      success: true,
      message:
        "SPONSORSHIP_CREATED_SUCCESSFULLY",
      data: details,
    }, 201);

  } catch (error) {
    return errorResponse(
      "SPONSORSHIP_CREATE_FAILED",
      500,
      {
        detail: String(
          error?.message || error
        ),
      }
    );
  }
}

/* =========================================================
   Sponsorship actions
========================================================= */

async function getCurrentStudentLevel(db, studentId) {
  return db
    .prepare(`
      SELECT
        student_id,
        current_path_id,
        current_level_id
      FROM student_progress_summary
      WHERE student_id = ?1
      LIMIT 1
    `)
    .bind(Number(studentId))
    .first();
}

async function getBeneficiary(
  db,
  sponsorshipId,
  studentId
) {
  return db
    .prepare(`
      SELECT
        id,
        sponsorship_id,
        student_id,
        allocated_months,
        allocated_amount,
        used_months,
        used_amount,
        status
      FROM sponsorship_beneficiaries
      WHERE sponsorship_id = ?1
        AND student_id = ?2
      LIMIT 1
    `)
    .bind(
      Number(sponsorshipId),
      Number(studentId)
    )
    .first();
}

async function getAllocation(
  db,
  allocationId
) {
  return db
    .prepare(`
      SELECT
        id,
        sponsorship_id,
        student_id,
        subscription_id,
        billing_cycle_id,
        allocated_amount,
        used_amount,
        status
      FROM sponsorship_allocations
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(Number(allocationId))
    .first();
}

async function getSponsorshipFunding(
  db,
  sponsorshipId
) {
  const funding =
    await getFundingTotals(
      db,
      sponsorshipId
    );

  const allocations =
    await getAllocationTotals(
      db,
      sponsorshipId
    );

  return {
    funded: Math.max(
      0,
      funding.funded_amount -
        funding.refunded_amount
    ),
    allocated:
      allocations.allocated_amount,
    used:
      allocations.used_amount,
    available:
      Math.max(
        0,
        funding.funded_amount -
          funding.refunded_amount -
          allocations.allocated_amount
      ),
  };
}

async function validateSponsorshipStudent(
  db,
  sponsorship,
  studentId
) {
  const student =
    await getStudent(
      db,
      studentId
    );

  if (!student) {
    return {
      ok: false,
      response: errorResponse(
        "STUDENT_NOT_FOUND",
        404
      ),
    };
  }

  if (
    sponsorship.scope_type === "student" &&
    Number(sponsorship.target_student_id) !==
      Number(studentId)
  ) {
    return {
      ok: false,
      response: errorResponse(
        "STUDENT_OUTSIDE_SPONSORSHIP_SCOPE",
        409
      ),
    };
  }

  if (
    sponsorship.scope_type === "level"
  ) {
    const summary =
      await getCurrentStudentLevel(
        db,
        studentId
      );

    if (
      !summary ||
      Number(summary.current_level_id) !==
        Number(sponsorship.target_level_id)
    ) {
      return {
        ok: false,
        response: errorResponse(
          "STUDENT_LEVEL_NOT_ELIGIBLE",
          409
        ),
      };
    }
  }

  return {
    ok: true,
    student,
  };
}

async function ensureBeneficiary(
  db,
  sponsorship,
  studentId,
  allocatedMonths,
  allocatedAmount,
  userId
) {
  const existing =
    await getBeneficiary(
      db,
      sponsorship.id,
      studentId
    );

  if (existing) {
    return existing;
  }

  const result =
    await db
      .prepare(`
        INSERT INTO sponsorship_beneficiaries (
          sponsorship_id,
          student_id,
          allocated_months,
          allocated_amount,
          used_months,
          used_amount,
          status,
          started_at,
          created_at,
          updated_at
        )
        VALUES (
          ?1, ?2, ?3, ?4,
          0, 0, 'active',
          ?5, ?5, ?5
        )
      `)
      .bind(
        Number(sponsorship.id),
        Number(studentId),
        allocatedMonths ?? null,
        Number(allocatedAmount || 0),
        now()
      )
      .run();

  const id =
    result.meta?.last_row_id;

  if (!validId(id)) {
    throw new Error(
      "SPONSORSHIP_BENEFICIARY_CREATE_FAILED"
    );
  }

  return getBeneficiary(
    db,
    sponsorship.id,
    studentId
  );
}

async function refreshAllocationStatus(
  db,
  allocationId
) {
  const allocation =
    await getAllocation(
      db,
      allocationId
    );

  if (!allocation) {
    return null;
  }

  let status =
    "allocated";

  if (
    Number(allocation.used_amount) >
    0
  ) {
    status =
      Number(allocation.used_amount) >=
      Number(allocation.allocated_amount)
        ? "used"
        : "partially_used";
  }

  await db
    .prepare(`
      UPDATE sponsorship_allocations
      SET
        status = ?1,
        updated_at = ?2
      WHERE id = ?3
    `)
    .bind(
      status,
      now(),
      Number(allocationId)
    )
    .run();

  return getAllocation(
    db,
    allocationId
  );
}

async function applySponsorshipToBilling(
  db,
  allocation,
  userId
) {
  const billingCycle = await getBillingCycle(
    db,
    allocation.billing_cycle_id
  );

  if (!billingCycle) {
    return {
      ok: false,
      response: errorResponse(
        "BILLING_CYCLE_NOT_FOUND",
        404
      ),
    };
  }

  const sponsorship = await getSponsorship(
    db,
    allocation.sponsorship_id
  );

  if (!sponsorship) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_NOT_FOUND",
        404
      ),
    };
  }

  if (sponsorship.status !== "active") {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_NOT_ACTIVE",
        409
      ),
    };
  }

  if (
    Number(billingCycle.student_id) !==
    Number(allocation.student_id)
  ) {
    return {
      ok: false,
      response: errorResponse(
        "BILLING_CYCLE_STUDENT_MISMATCH",
        409
      ),
    };
  }

  if (
    allocation.status === "cancelled" ||
    allocation.status === "used"
  ) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_ALLOCATION_NOT_AVAILABLE",
        409
      ),
    };
  }

  const existingUsage = await db
    .prepare(`
      SELECT id
      FROM sponsorship_billing_usage
      WHERE sponsorship_allocation_id = ?1
        AND billing_cycle_id = ?2
        AND status = 'applied'
      LIMIT 1
    `)
    .bind(
      Number(allocation.id),
      Number(allocation.billing_cycle_id)
    )
    .first();

  if (existingUsage) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_BILLING_ALREADY_APPLIED",
        409,
        {
          usage_id: Number(existingUsage.id),
        }
      ),
    };
  }

  const allocationRemaining = Math.max(
    0,
    Number(allocation.allocated_amount || 0) -
      Number(allocation.used_amount || 0)
  );

  const beneficiary =
    await getBeneficiary(
      db,
      allocation.sponsorship_id,
      allocation.student_id
    );

  if (
    !beneficiary ||
    beneficiary.status !== "active"
  ) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_BENEFICIARY_REQUIRED",
        409
      ),
    };
  }

  const isMonthsSponsorship =
    clean(sponsorship.scope_type).toLowerCase() ===
    "months";

  const currentUsedMonths =
    Number(beneficiary.used_months || 0);

  const allocatedMonths =
    Number(beneficiary.allocated_months || 0);

  if (
    isMonthsSponsorship &&
    (
      allocatedMonths <= 0 ||
      currentUsedMonths >= allocatedMonths
    )
  ) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_MONTHS_EXHAUSTED",
        409
      ),
    };
  }

  if (allocationRemaining <= 0) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_ALLOCATION_EXHAUSTED",
        409
      ),
    };
  }

  const paidAmount = Number(
    billingCycle.paid_amount || 0
  );

  const sponsoredAmount = Number(
    billingCycle.sponsored_amount || 0
  );

  const totalAmount = Number(
    billingCycle.total_amount || 0
  );

  const coveredAmount =
    paidAmount + sponsoredAmount;

  const remainingInvoice = Math.max(
    0,
    totalAmount - coveredAmount
  );

  if (clean(billingCycle.status).toLowerCase() === "cancelled") {
    return {
      ok: false,
      response: errorResponse(
        "BILLING_CYCLE_CANCELLED",
        409
      ),
    };
  }

  if (
    remainingInvoice <= 0 ||
    clean(billingCycle.status).toLowerCase() === "paid"
  ) {
    return {
      ok: false,
      response: errorResponse(
        "BILLING_CYCLE_ALREADY_COVERED",
        409
      ),
    };
  }

  const amount = Number(
    Math.min(
      allocationRemaining,
      remainingInvoice
    ).toFixed(2)
  );

  if (amount <= 0) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_AMOUNT_INVALID",
        409
      ),
    };
  }

  const newSponsoredAmount = Number(
    (sponsoredAmount + amount).toFixed(2)
  );

  const newRemainingAmount = Math.max(
    0,
    Number(
      (
        totalAmount -
        paidAmount -
        newSponsoredAmount
      ).toFixed(2)
    )
  );

  const newCoveredAmount = Number(
    (
      paidAmount +
      newSponsoredAmount
    ).toFixed(2)
  );

  const newBillingStatus =
    totalAmount <= 0 ||
    newCoveredAmount >= totalAmount
      ? "paid"
      : "partially_paid";

  const paidAt =
    newBillingStatus === "paid"
      ? billingCycle.paid_at || now()
      : billingCycle.paid_at;

  const newUsedAmount = Number(
    (
      Number(allocation.used_amount || 0) +
      amount
    ).toFixed(2)
  );

  const newAllocationStatus =
    newUsedAmount >=
    Number(allocation.allocated_amount || 0)
      ? "used"
      : "partially_used";

  const timestamp = now();

  const statements = [
    db.prepare(`
      UPDATE billing_cycles
      SET
        sponsored_amount = ?1,
        remaining_amount = ?2,
        status = ?3,
        paid_at = ?4,
        updated_at = ?5
      WHERE id = ?6
        AND student_id = ?7
        AND status NOT IN ('cancelled', 'paid')
    `).bind(
      newSponsoredAmount,
      newRemainingAmount,
      newBillingStatus,
      paidAt,
      timestamp,
      Number(allocation.billing_cycle_id),
      Number(allocation.student_id)
    ),

    db.prepare(`
      UPDATE sponsorship_allocations
      SET
        used_amount = ?1,
        status = ?2,
        updated_at = ?3
      WHERE id = ?4
        AND sponsorship_id = ?5
        AND student_id = ?6
        AND status NOT IN ('cancelled', 'used')
    `).bind(
      newUsedAmount,
      newAllocationStatus,
      timestamp,
      Number(allocation.id),
      Number(allocation.sponsorship_id),
      Number(allocation.student_id)
    ),

    db.prepare(`
      INSERT INTO sponsorship_billing_usage (
        sponsorship_id,
        sponsorship_allocation_id,
        student_id,
        billing_cycle_id,
        amount,
        status,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        ?1, ?2, ?3, ?4, ?5,
        'applied', ?6, ?7, ?7
      )
    `).bind(
      Number(allocation.sponsorship_id),
      Number(allocation.id),
      Number(allocation.student_id),
      Number(allocation.billing_cycle_id),
      amount,
      userId,
      timestamp
    ),
  ];

  let results;

  try {
    results = await db.batch(statements);
  } catch (error) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_APPLY_FAILED",
        500
      ),
    };
  }

  const expectedResultCount = 3;

  if (
    !Array.isArray(results) ||
    results.length !== expectedResultCount
  ) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_APPLY_FAILED",
        500
      ),
    };
  }

  if (
    Number(results[0]?.meta?.changes || 0) !== 1 ||
    Number(results[1]?.meta?.changes || 0) !== 1 ||
    Number(results[2]?.meta?.changes || 0) !== 1
  ) {
    return {
      ok: false,
      response: errorResponse(
        "SPONSORSHIP_APPLY_CONFLICT",
        409
      ),
    };
  }

  await refreshSponsorshipTotals(
    db,
    allocation.sponsorship_id
  );

  return {
    ok: true,
    amount,
    billing_cycle_id:
      Number(allocation.billing_cycle_id),
  };
}
