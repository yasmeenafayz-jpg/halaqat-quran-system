export async function onRequestGet(context) {
  const db = context.env?.DB;

  if (!db) {
    return Response.json({
      ok: true,
      database: false,
      counts: {
        students: 0,
        teachers: 0,
        circles: 0,
        today: 0
      }
    });
  }

  try {
    const queries = await Promise.all([
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM students WHERE status = 'active'"
        )
        .first(),

      db
        .prepare(
          "SELECT COUNT(*) AS count FROM teachers WHERE status = 'active'"
        )
        .first(),

      db
        .prepare(
          "SELECT COUNT(*) AS count FROM circles WHERE status = 'active'"
        )
        .first(),

      db
        .prepare(
          "SELECT COUNT(*) AS count FROM sessions WHERE session_date = date('now') AND status != 'cancelled'"
        )
        .first()
    ]);

    return Response.json({
      ok: true,
      database: true,
      counts: {
        students: Number(queries[0]?.count || 0),
        teachers: Number(queries[1]?.count || 0),
        circles: Number(queries[2]?.count || 0),
        today: Number(queries[3]?.count || 0)
      }
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: "DASHBOARD_QUERY_FAILED",
        message: error instanceof Error
          ? error.message
          : String(error)
      },
      { status: 500 }
    );
  }
}
