function jsonError(message, status = 400) {
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
      data: [],
      database: false
    });
  }

  try {
    const result = await db
      .prepare(`
        SELECT
          id,
          student_code,
          full_name,
          phone,
          guardian_name,
          guardian_phone,
          status,
          created_at
        FROM students
        ORDER BY created_at DESC
      `)
      .all();

    return Response.json({
      ok: true,
      data: result.results || []
    });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "STUDENTS_FETCH_FAILED",
      500
    );
  }
}

export async function onRequestPost(context) {
  const db = context.env?.DB;

  if (!db) {
    return jsonError("DATABASE_NOT_CONFIGURED", 503);
  }

  let body;

  try {
    body = await context.request.json();
  } catch {
    return jsonError("INVALID_JSON");
  }

  const fullName = String(body.full_name || "").trim();

  if (!fullName) {
    return jsonError("FULL_NAME_REQUIRED");
  }

  const studentCode =
    String(body.student_code || "").trim() ||
    `ST-${Date.now()}`;

  const phone =
    String(body.phone || "").trim();

  const guardianName =
    String(body.guardian_name || "").trim();

  const guardianPhone =
    String(body.guardian_phone || "").trim();

  const status =
    String(body.status || "active").trim();

  try {
    const result = await db
      .prepare(`
        INSERT INTO students (
          student_code,
          full_name,
          phone,
          guardian_name,
          guardian_phone,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        studentCode,
        fullName,
        phone,
        guardianName,
        guardianPhone,
        status
      )
      .run();

    return Response.json(
      {
        ok: true,
        id: result.meta?.last_row_id || null,
        student_code: studentCode
      },
      { status: 201 }
    );
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "STUDENT_CREATE_FAILED",
      500
    );
  }
}
