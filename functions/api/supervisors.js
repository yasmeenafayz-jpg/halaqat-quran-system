export async function onRequestGet(context) {
  const { env } = context;

  const result = await env.DB.prepare(`
    SELECT
      u.id,
      u.name,
      u.phone,
      u.email,
      u.active
    FROM users u
    JOIN roles r
      ON r.id = u.role_id
    WHERE r.code = 'supervisor'
      AND u.active = 1
    ORDER BY u.name
  `).all();

  return Response.json({
    success: true,
    supervisors: result.results
  });
}
