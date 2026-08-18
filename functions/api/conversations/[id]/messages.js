export async function onRequestGet(context) {
  const { env, params, request } = context;

  const userId = request.headers.get("x-user-id");
  const conversationId = params.id;

  if (!userId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const participant = await env.DB.prepare(`
    SELECT id
    FROM conversation_participants
    WHERE conversation_id = ?
      AND user_id = ?
  `).bind(
    conversationId,
    userId
  ).first();

  if (!participant) {
    return Response.json(
      { success: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const messages = await env.DB.prepare(`
    SELECT
      m.id,
      m.sender_id,
      m.body,
      m.message_type,
      m.created_at,
      m.edited_at,
      m.deleted_at
    FROM messages m
    WHERE m.conversation_id = ?
      AND m.deleted_at IS NULL
    ORDER BY m.created_at ASC
  `).bind(conversationId).all();

  return Response.json({
    success: true,
    messages: messages.results
  });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;

  const userId = request.headers.get("x-user-id");
  const conversationId = params.id;

  if (!userId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const participant = await env.DB.prepare(`
    SELECT id
    FROM conversation_participants
    WHERE conversation_id = ?
      AND user_id = ?
  `).bind(
    conversationId,
    userId
  ).first();

  if (!participant) {
    return Response.json(
      { success: false, error: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const body = await request.json();

  if (!body.body || !body.body.trim()) {
    return Response.json(
      { success: false, error: "MESSAGE_EMPTY" },
      { status: 400 }
    );
  }

  const message = await env.DB.prepare(`
    INSERT INTO messages
      (conversation_id, sender_id, body, message_type)
    VALUES (?, ?, ?, 'text')
    RETURNING id, created_at
  `).bind(
    conversationId,
    userId,
    body.body.trim()
  ).first();

  return Response.json({
    success: true,
    message
  });
}
