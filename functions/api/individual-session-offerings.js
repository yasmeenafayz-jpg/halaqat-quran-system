import { requirePermission } from "./_auth.js";

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: HEADERS,
  });
}

function fail(error, status = 400, extra = {}) {
  return json(
    {
      success: false,
      error,
      ...extra,
    },
    status
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function nullable(value) {
  const cleaned = clean(value);
  return cleaned || null;
}

function id(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

function timestamp() {
  return new Date().toISOString();
}

function isManager(user) {
  return ["admin", "supervisor"].includes(user?.role);
}

async function offering(db, offeringId) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        description,
        price,
        currency,
        duration_minutes,
        status,
        created_at,
        updated_at
      FROM individual_session_offerings
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(offeringId)
    .first();
}

export async function onRequestGet(context) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "individual-scheduling.read"
  );

  if (!permission.ok) {
    return permission.response;
  }

  const db = context.env?.DB;

  if (!db) {
    return fail("DATABASE_NOT_CONFIGURED", 503);
  }

  try {
    const rows = await db
      .prepare(`
        SELECT
          id,
          name,
          description,
          price,
          currency,
          duration_minutes,
          status,
          created_at,
          updated_at
        FROM individual_session_offerings
        WHERE status = 'active'
        ORDER BY price ASC, duration_minutes ASC, id ASC
      `)
      .all();

    return json({
      success: true,
      data: rows.results || [],
      count: rows.results?.length || 0,
    });
  } catch (error) {
    console.error(
      "INDIVIDUAL_SESSION_OFFERINGS_GET_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SESSION_OFFERINGS_FETCH_FAILED",
      500
    );
  }
}

export async function onRequestPost(context) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "individual-scheduling.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

  if (!isManager(permission.user)) {
    return fail("FORBIDDEN", 403);
  }

  const db = context.env?.DB;

  if (!db) {
    return fail("DATABASE_NOT_CONFIGURED", 503);
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return fail("INVALID_JSON");
  }

  const name = clean(body?.name);
  const description = nullable(body?.description);

  const price = Number(body?.price);
  const durationMinutes = Number(
    body?.duration_minutes ??
    body?.durationMinutes ??
    30
  );

  const currency =
    clean(body?.currency || "EGP").toUpperCase();

  const status =
    clean(body?.status || "active").toLowerCase();

  if (!name) {
    return fail("OFFERING_NAME_REQUIRED");
  }

  if (!Number.isFinite(price) || price < 0) {
    return fail("INVALID_OFFERING_PRICE");
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  ) {
    return fail("INVALID_OFFERING_DURATION");
  }

  if (!currency) {
    return fail("INVALID_OFFERING_CURRENCY");
  }

  if (!["active", "inactive"].includes(status)) {
    return fail("INVALID_OFFERING_STATUS");
  }

  try {
    const now = timestamp();

    const result = await db
      .prepare(`
        INSERT INTO individual_session_offerings (
          name,
          description,
          price,
          currency,
          duration_minutes,
          status,
          created_at,
          updated_at
        )
        VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7
        )
      `)
      .bind(
        name,
        description,
        price,
        currency,
        durationMinutes,
        status,
        now
      )
      .run();

    return json(
      {
        success: true,
        message: "INDIVIDUAL_SESSION_OFFERING_CREATED",
        data: await offering(
          db,
          result.meta.last_row_id
        ),
      },
      201
    );
  } catch (error) {
    console.error(
      "INDIVIDUAL_SESSION_OFFERING_CREATE_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SESSION_OFFERING_CREATE_FAILED",
      500
    );
  }
}

export async function onRequestPatch(context) {
  const permission = await requirePermission(
    context.request,
    context.env,
    "individual-scheduling.write"
  );

  if (!permission.ok) {
    return permission.response;
  }

  if (!isManager(permission.user)) {
    return fail("FORBIDDEN", 403);
  }

  const db = context.env?.DB;

  if (!db) {
    return fail("DATABASE_NOT_CONFIGURED", 503);
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return fail("INVALID_JSON");
  }

  const offeringId = id(
    body?.id ??
    body?.offering_id ??
    body?.offeringId
  );

  if (!offeringId) {
    return fail("OFFERING_ID_REQUIRED");
  }

  const current = await offering(db, offeringId);

  if (!current) {
    return fail("OFFERING_NOT_FOUND", 404);
  }

  const name =
    body?.name === undefined
      ? current.name
      : clean(body.name);

  const description =
    body?.description === undefined
      ? current.description
      : nullable(body.description);

  const price =
    body?.price === undefined
      ? Number(current.price)
      : Number(body.price);

  const durationMinutes =
    body?.duration_minutes !== undefined ||
    body?.durationMinutes !== undefined
      ? Number(
          body?.duration_minutes ??
          body?.durationMinutes
        )
      : Number(current.duration_minutes);

  const currency =
    body?.currency === undefined
      ? current.currency
      : clean(body.currency).toUpperCase();

  const status =
    body?.status === undefined
      ? current.status
      : clean(body.status).toLowerCase();

  if (!name) {
    return fail("OFFERING_NAME_REQUIRED");
  }

  if (!Number.isFinite(price) || price < 0) {
    return fail("INVALID_OFFERING_PRICE");
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  ) {
    return fail("INVALID_OFFERING_DURATION");
  }

  if (!currency) {
    return fail("INVALID_OFFERING_CURRENCY");
  }

  if (!["active", "inactive"].includes(status)) {
    return fail("INVALID_OFFERING_STATUS");
  }

  try {
    await db
      .prepare(`
        UPDATE individual_session_offerings
        SET
          name = ?2,
          description = ?3,
          price = ?4,
          currency = ?5,
          duration_minutes = ?6,
          status = ?7,
          updated_at = ?8
        WHERE id = ?1
      `)
      .bind(
        offeringId,
        name,
        description,
        price,
        currency,
        durationMinutes,
        status,
        timestamp()
      )
      .run();

    return json({
      success: true,
      message: "INDIVIDUAL_SESSION_OFFERING_UPDATED",
      data: await offering(db, offeringId),
    });
  } catch (error) {
    console.error(
      "INDIVIDUAL_SESSION_OFFERING_UPDATE_ERROR",
      error
    );

    return fail(
      "INDIVIDUAL_SESSION_OFFERING_UPDATE_FAILED",
      500
    );
  }
}

export async function onRequest(context) {
  switch (context.request.method.toUpperCase()) {
    case "GET":
      return onRequestGet(context);

    case "POST":
      return onRequestPost(context);

    case "PATCH":
      return onRequestPatch(context);

    default:
      return fail(
        "METHOD_NOT_ALLOWED",
        405,
        {
          allowed: ["GET", "POST", "PATCH"],
        }
      );
  }
}
