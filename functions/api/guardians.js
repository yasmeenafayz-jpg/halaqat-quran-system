export async function onRequestGet(context) {
  const { env, request } = context;

  const userId = request.headers.get("x-user-id");

  if (!userId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const children = await env.DB.prepare(`
    SELECT
      s.id,
      s.name,
      s.gender,
      s.birth_date,
      s.level,
      s.memorized_amount
    FROM guardian_students gs
    JOIN students s
      ON s.id = gs.student_id
    WHERE gs.guardian_id = ?
    ORDER BY s.name
  `).bind(userId).all();

  return Response.json({
    success: true,
    children: children.results
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const guardianId = request.headers.get("x-user-id");

  if (!guardianId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const body = await request.json();

  if (!body.studentId) {
    return Response.json(
      { success: false, error: "STUDENT_REQUIRED" },
      { status: 400 }
    );
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO guardian_students
      (guardian_id, student_id)
    VALUES (?, ?)
  `).bind(
    guardianId,
    body.studentId
  ).run();

  return Response.json({
    success: true
  });
}
