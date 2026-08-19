export async function onRequestGet(context) {
  const hasDatabase = Boolean(context.env?.DB);

  return Response.json({
    ok: true,
    service: "alawabin-api",
    database: hasDatabase,
    timestamp: new Date().toISOString()
  });
}
