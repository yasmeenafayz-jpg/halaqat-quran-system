import { requireAuth } from "./_auth.js";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS
  });
}

function fail(error, status = 400, extra = {}) {
  return json(
    {
      success: false,
      error,
      ...extra
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function timestamp() {
  return new Date().toISOString();
}

function isManager(user) {
  return ["admin", "supervisor"].includes(user?.role);
}

function safeStudentRow(row) {
  if (!row) return null;

  const messages = {
    pending_review: "تم استلام طلبك وسيتم مراجعته بسرية.",
    needs_info: "تحتاج الأكاديمية إلى بعض المعلومات الإضافية لاستكمال المراجعة.",
    approved: "تمت الموافقة على طلب الدعم.",
    partially_approved: "تمت الموافقة على جزء من طلب الدعم.",
    waiting_funding: "تمت مراجعة الطلب، وهو في انتظار توفر تمويل مناسب.",
    rejected: "تمت مراجعة الطلب ولم تتم الموافقة عليه حاليًا.",
    closed: "تم إغلاق الطلب."
  };

  return {
    id: Number(row.id),
    requested_scope: row.requested_scope,
    requested_months: row.requested_months
      ? Number(row.requested_months)
      : null,
    status: row.status,
    public_message: messages[row.status] || "جارٍ متابعة الطلب.",
    created_at: row.created_at,
    reviewed_at: row.reviewed_at || null,
    eligibility_review_until:
      row.eligibility_review_until || null
  };
}

async function supportOpen(db) {
  const row = await db
    .prepare(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = 'academy.sponsorship_seats_open'
        AND scope_type = 'global'
      LIMIT 1
    `)
    .first();

  return (
    row?.setting_value === true ||
    row?.setting_value === 1 ||
    String(row?.setting_value).toLowerCase() === "true" ||
    String(row?.setting_value) === "1"
  );
}

export async function onRequestGet(context) {
  const auth = await requireAuth(
    context.request,
    context.env
  );

  if (!auth.ok) return auth.response;

  const db = context.env?.DB;
  if (!db) return fail("DATABASE_NOT_CONFIGURED", 503);

  const user = auth.user;
  const url = new URL(context.request.url);
  const idParam = id(url.searchParams.get("id"));

  try {
    if (isManager(user)) {
      let sql = `
        SELECT
          r.id,
          r.student_id,
          s.full_name AS student_name,
          r.request_type,
          r.requested_scope,
          r.requested_amount,
          r.requested_months,
          r.reason,
          r.commitment_note,
          r.status,
          r.approved_amount,
          r.approved_months,
          r.eligibility_review_until,
          r.reviewed_by,
          r.reviewed_at,
          r.decision_note,
          r.created_at,
          r.updated_at
        FROM sponsorship_support_requests r
        JOIN students s ON s.id = r.student_id
      `;

      const params = [];

      if (idParam) {
        sql += " WHERE r.id = ?1";
        params.push(idParam);
      }

      sql += " ORDER BY r.created_at DESC, r.id DESC";

      const result = await db
        .prepare(sql)
        .bind(...params)
        .all();

      return json({
        success: true,
        data: result.results || []
      });
    }

    if (user.role !== "student" || !user.student_id) {
      return fail("FORBIDDEN", 403);
    }

    const result = await db
      .prepare(`
        SELECT
          id,
          requested_scope,
          requested_months,
          status,
          reviewed_at,
          eligibility_review_until,
          created_at
        FROM sponsorship_support_requests
        WHERE student_id = ?1
        ORDER BY created_at DESC, id DESC
        LIMIT 20
      `)
      .bind(Number(user.student_id))
      .all();

    return json({
      success: true,
      data: (result.results || []).map(safeStudentRow)
    });
  } catch (error) {
    console.error("SPONSORSHIP_SUPPORT_GET_ERROR", error);
    return fail("SUPPORT_REQUEST_FETCH_FAILED", 500);
  }
}

export async function onRequestPost(context) {
  const auth = await requireAuth(
    context.request,
    context.env
  );

  if (!auth.ok) return auth.response;

  const db = context.env?.DB;
  if (!db) return fail("DATABASE_NOT_CONFIGURED", 503);

  const user = auth.user;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return fail("INVALID_JSON");
  }

  const action = clean(body?.action).toLowerCase();

  try {
    if (action === "request_support") {
      if (user.role !== "student" || !user.student_id) {
        return fail("FORBIDDEN", 403);
      }

      if (!(await supportOpen(db))) {
        return fail("SPONSORSHIP_SEATS_CLOSED", 409);
      }

      const requestedScope =
        clean(body?.requested_scope || "subscription").toLowerCase();

      if (
        !["circle", "subscription", "level", "other"].includes(
          requestedScope
        )
      ) {
        return fail("INVALID_SUPPORT_SCOPE");
      }

      const reason = clean(body?.reason);
      if (reason.length < 10) {
        return fail("SUPPORT_REASON_REQUIRED");
      }

      if (reason.length > 2000) {
        return fail("SUPPORT_REASON_TOO_LONG");
      }

      const commitmentNote = clean(body?.commitment_note);

      const requestedAmountRaw = body?.requested_amount;
      const requestedAmount =
        requestedAmountRaw === "" ||
        requestedAmountRaw === null ||
        requestedAmountRaw === undefined
          ? null
          : Number(requestedAmountRaw);

      if (
        requestedAmount !== null &&
        (!Number.isFinite(requestedAmount) ||
          requestedAmount < 0)
      ) {
        return fail("INVALID_REQUESTED_AMOUNT");
      }

      const requestedMonthsRaw =
        body?.requested_months;

      const requestedMonths =
        requestedMonthsRaw === "" ||
        requestedMonthsRaw === null ||
        requestedMonthsRaw === undefined
          ? null
          : Number(requestedMonthsRaw);

      if (
        requestedMonths !== null &&
        (!Number.isInteger(requestedMonths) ||
          requestedMonths < 1)
      ) {
        return fail("INVALID_REQUESTED_MONTHS");
      }

      const existing = await db
        .prepare(`
          SELECT id
          FROM sponsorship_support_requests
          WHERE student_id = ?1
            AND status IN (
              'pending_review',
              'needs_info',
              'approved',
              'partially_approved',
              'waiting_funding'
            )
          LIMIT 1
        `)
        .bind(Number(user.student_id))
        .first();

      if (existing) {
        return fail(
          "ACTIVE_SUPPORT_REQUEST_EXISTS",
          409,
          { request_id: Number(existing.id) }
        );
      }

      const now = timestamp();

      const result = await db
        .prepare(`
          INSERT INTO sponsorship_support_requests (
            student_id,
            request_type,
            requested_scope,
            requested_amount,
            requested_months,
            reason,
            commitment_note,
            status,
            created_at,
            updated_at
          )
          VALUES (
            ?1,
            'educational_support',
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            'pending_review',
            ?7,
            ?7
          )
        `)
        .bind(
          Number(user.student_id),
          requestedScope,
          requestedAmount,
          requestedMonths,
          reason,
          commitmentNote || null,
          now
        )
        .run();

      return json(
        {
          success: true,
          message: "SUPPORT_REQUEST_SUBMITTED",
          data: {
            id: Number(result.meta.last_row_id),
            status: "pending_review",
            public_message:
              "تم استلام طلبك وسيتم مراجعته بسرية."
          }
        },
        201
      );
    }

    if (!isManager(user)) {
      return fail("FORBIDDEN", 403);
    }

    if (!id(body?.id)) {
      return fail("SUPPORT_REQUEST_ID_REQUIRED");
    }

    if (action !== "review") {
      return fail("UNSUPPORTED_SUPPORT_ACTION");
    }

    const requestId = id(body.id);

    const current = await db
      .prepare(`
        SELECT *
        FROM sponsorship_support_requests
        WHERE id = ?1
        LIMIT 1
      `)
      .bind(requestId)
      .first();

    if (!current) {
      return fail("SUPPORT_REQUEST_NOT_FOUND", 404);
    }

    const nextStatus = clean(body?.status).toLowerCase();

    const allowed = [
      "needs_info",
      "approved",
      "partially_approved",
      "waiting_funding",
      "rejected",
      "closed"
    ];

    if (!allowed.includes(nextStatus)) {
      return fail("INVALID_SUPPORT_STATUS");
    }

    const approvedAmountRaw = body?.approved_amount;
    const approvedAmount =
      approvedAmountRaw === "" ||
      approvedAmountRaw === null ||
      approvedAmountRaw === undefined
        ? null
        : Number(approvedAmountRaw);

    if (
      approvedAmount !== null &&
      (!Number.isFinite(approvedAmount) ||
        approvedAmount < 0)
    ) {
      return fail("INVALID_APPROVED_AMOUNT");
    }

    const approvedMonthsRaw = body?.approved_months;
    const approvedMonths =
      approvedMonthsRaw === "" ||
      approvedMonthsRaw === null ||
      approvedMonthsRaw === undefined
        ? null
        : Number(approvedMonthsRaw);

    if (
      approvedMonths !== null &&
      (!Number.isInteger(approvedMonths) ||
        approvedMonths < 1)
    ) {
      return fail("INVALID_APPROVED_MONTHS");
    }

    const eligibilityUntil =
      clean(body?.eligibility_review_until) || null;

    const decisionNote =
      clean(body?.decision_note) || null;

    await db
      .prepare(`
        UPDATE sponsorship_support_requests
        SET
          status = ?1,
          approved_amount = ?2,
          approved_months = ?3,
          eligibility_review_until = ?4,
          reviewed_by = ?5,
          reviewed_at = ?6,
          decision_note = ?7,
          updated_at = ?6
        WHERE id = ?8
      `)
      .bind(
        nextStatus,
        approvedAmount,
        approvedMonths,
        eligibilityUntil,
        Number(user.id),
        timestamp(),
        decisionNote,
        requestId
      )
      .run();

    return json({
      success: true,
      message: "SUPPORT_REQUEST_REVIEWED"
    });
  } catch (error) {
    console.error("SPONSORSHIP_SUPPORT_POST_ERROR", error);
    return fail("SUPPORT_REQUEST_SAVE_FAILED", 500);
  }
}
