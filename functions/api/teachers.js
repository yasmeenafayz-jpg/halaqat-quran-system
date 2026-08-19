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
          id,
          teacher_code,
          full_name,
          phone,
          email,
          specialization,
          qualifications,
          experience_years,
          status,
          created_at
        FROM teachers
        ORDER BY created_at DESC
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
        : "TEACHERS_FETCH_FAILED",
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

  const fullName =
    String(body.full_name || "").trim();

  if (!fullName) {
    return errorResponse("FULL_NAME_REQUIRED");
  }

  const teacherCode =
    String(body.teacher_code || "").trim() ||
    `TE-${Date.now()}`;

  try {
    const result = await db
      .prepare(`
        INSERT INTO teachers (
          teacher_code,
          full_name,
          phone,
          email,
          specialization,
          qualifications,
          experience_years,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        teacherCode,
        fullName,
        String(body.phone || "").trim(),
        String(body.email || "").trim(),
        String(body.specialization || "").trim(),
        String(body.qualifications || "").trim(),
        Number(body.experience_years || 0),
        String(body.status || "active")
      )
      .run();

    return Response.json(
      {
        ok: true,
        id: result.meta?.last_row_id || null,
        teacher_code: teacherCode
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "TEACHER_CREATE_FAILED",
      500
    );
  }
}
