import { json, requireAuth } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  const { results } = await env.DB.prepare(`
    SELECT *
    FROM packages
    ORDER BY id DESC
  `).all();

  return json({
    success: true,
    packages: results || []
  });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  if (!["admin", "supervisor"].includes(auth.user.role)) {
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }

  const body = await request.json();

  const name = String(body.name || "").trim();
  const packageType = body.package_type;
  const price = Number(body.price ?? 0);
  const sessionsPerMonth = Number(body.sessions_per_month ?? 0);
  const durationMinutes = Number(body.duration_minutes ?? 30);
  const trialDays = Number(body.trial_days ?? 0);
  const capacity =
    body.capacity == null || body.capacity === ""
      ? null
      : Number(body.capacity);

  if (!name) {
    return json({ success: false, error: "NAME_REQUIRED" }, 400);
  }

  if (!["individual", "group"].includes(packageType)) {
    return json({ success: false, error: "INVALID_PACKAGE_TYPE" }, 400);
  }

  if (!Number.isFinite(price) || price < 0) {
    return json({ success: false, error: "INVALID_PRICE" }, 400);
  }

  if (
    !Number.isInteger(sessionsPerMonth) ||
    sessionsPerMonth < 0
  ) {
    return json({
      success: false,
      error: "INVALID_SESSIONS_PER_MONTH"
    }, 400);
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  ) {
    return json({
      success: false,
      error: "INVALID_DURATION"
    }, 400);
  }

  if (!Number.isInteger(trialDays) || trialDays < 0) {
    return json({
      success: false,
      error: "INVALID_TRIAL_DAYS"
    }, 400);
  }

  if (
    capacity !== null &&
    (!Number.isInteger(capacity) || capacity < 1)
  ) {
    return json({
      success: false,
      error: "INVALID_CAPACITY"
    }, 400);
  }

  const currency = String(body.currency || "EGP").trim() || "EGP";
  const description =
    body.description == null ? null : String(body.description);
  const rules =
    body.rules == null ? null : String(body.rules);

  const result = await env.DB.prepare(`
    INSERT INTO packages (
      name,
      package_type,
      description,
      price,
      currency,
      sessions_per_month,
      duration_minutes,
      capacity,
      rules,
      trial_days,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `).bind(
    name,
    packageType,
    description,
    price,
    currency,
    sessionsPerMonth,
    durationMinutes,
    capacity,
    rules,
    trialDays
  ).run();

  return json({
    success: true,
    id: result.meta?.last_row_id || null
  }, 201);
}

export async function onRequestPut({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  if (!["admin", "supervisor"].includes(auth.user.role)) {
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }

  const body = await request.json();
  const id = Number(body.id);

  const name = String(body.name || "").trim();
  const price = Number(body.price ?? 0);
  const sessionsPerMonth = Number(body.sessions_per_month ?? 0);
  const durationMinutes = Number(body.duration_minutes ?? 30);
  const trialDays = Number(body.trial_days ?? 0);
  const capacity =
    body.capacity == null || body.capacity === ""
      ? null
      : Number(body.capacity);

  if (!Number.isInteger(id) || id < 1 || !name) {
    return json({ success: false, error: "INVALID_PACKAGE" }, 400);
  }

  if (!Number.isFinite(price) || price < 0) {
    return json({ success: false, error: "INVALID_PRICE" }, 400);
  }

  if (
    !Number.isInteger(sessionsPerMonth) ||
    sessionsPerMonth < 0
  ) {
    return json({
      success: false,
      error: "INVALID_SESSIONS_PER_MONTH"
    }, 400);
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  ) {
    return json({
      success: false,
      error: "INVALID_DURATION"
    }, 400);
  }

  if (!Number.isInteger(trialDays) || trialDays < 0) {
    return json({
      success: false,
      error: "INVALID_TRIAL_DAYS"
    }, 400);
  }

  if (
    capacity !== null &&
    (!Number.isInteger(capacity) || capacity < 1)
  ) {
    return json({
      success: false,
      error: "INVALID_CAPACITY"
    }, 400);
  }

  const currency = String(body.currency || "EGP").trim() || "EGP";
  const description =
    body.description == null ? null : String(body.description);
  const rules =
    body.rules == null ? null : String(body.rules);

  const result = await env.DB.prepare(`
    UPDATE packages
    SET
      name = ?,
      description = ?,
      price = ?,
      currency = ?,
      sessions_per_month = ?,
      duration_minutes = ?,
      capacity = ?,
      rules = ?,
      trial_days = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    name,
    description,
    price,
    currency,
    sessionsPerMonth,
    durationMinutes,
    capacity,
    rules,
    trialDays,
    id
  ).run();

  return json({
    success: true,
    changed: result.meta?.changes || 0
  });
}

export async function onRequestPatch({ request, env }) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;

  if (!["admin", "supervisor"].includes(auth.user.role)) {
    return json({ success: false, error: "FORBIDDEN" }, 403);
  }

  const body = await request.json();
  const id = Number(body.id);
  const status = body.status;

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    !["active", "inactive"].includes(status)
  ) {
    return json({ success: false, error: "INVALID_STATUS" }, 400);
  }

  const result = await env.DB.prepare(`
    UPDATE packages
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, id).run();

  return json({
    success: true,
    changed: result.meta?.changes || 0
  });
}
