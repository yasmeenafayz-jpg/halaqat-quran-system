function errorResponse(message, status = 400) {
  return Response.json(
    {
      ok: false,
      error: message
    },
    { status }
  );
}

export async function onRequestGet(context) {
  const db = context.env?.DB;

  if (!db) {
    return Response.json({
      ok: true,
      database: false,
      data: []
    });
  }

  try {
    const result = await db
      .prepare(`
        SELECT
          c.id,
          c.name,
          c.circle_type,
          c.capacity,
          c.status,
          c.schedule_note,
          t.full_name AS teacher_name,
          p.name AS package_name
        FROM circles c
        LEFT JOIN teachers t
          ON t.id = c.teacher_id
        LEFT JOIN packages p
          ON p.id = c.package_id
        ORDER BY c.created_at DESC
      `)
      .all();

    return Response.json({
      ok: true,
      data: result.results || []
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLES_FETCH_FAILED",
      500
    );
  }
}

export async function onRequestPost(context) {
  const db = context.env?.DB;

  if (!db) {
    return errorResponse(
      "DATABASE_NOT_CONFIGURED",
      503
    );
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return errorResponse("INVALID_JSON");
  }

  const name =
    String(body.name || "").trim();

  const circleType =
    String(body.circle_type || "").trim();

  if (!name) {
    return errorResponse("CIRCLE_NAME_REQUIRED");
  }

  if (!["individual", "group"].includes(circleType)) {
    return errorResponse(
      "CIRCLE_TYPE_MUST_BE_INDIVIDUAL_OR_GROUP"
    );
  }

  const capacity =
    Math.max(
      1,
      Number(body.capacity || 1)
    );

  try {
    const result = await db
      .prepare(`
        INSERT INTO circles (
          name,
          circle_type,
          teacher_id,
          package_id,
          capacity,
          status,
          schedule_note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        name,
        circleType,
        body.teacher_id || null,
        body.package_id || null,
        capacity,
        String(body.status || "active"),
        String(body.schedule_note || "").trim()
      )
      .run();

    return Response.json(
      {
        ok: true,
        id: result.meta?.last_row_id || null
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "CIRCLE_CREATE_FAILED",
      500
    );
  }
}
