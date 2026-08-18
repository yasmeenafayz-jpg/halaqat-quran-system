export async function onRequestGet(context) {
  const { env, request } = context;

  // يجب استبدال هذا لاحقًا بقراءة المستخدم من جلسة الدخول الحقيقية
  const userId = request.headers.get("x-user-id");

  if (!userId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const conversations = await env.DB.prepare(`
    SELECT
      c.id,
      c.type,
      c.title,
      c.created_at,
      cp.last_read_at
    FROM conversations c
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id
    WHERE cp.user_id = ?
      AND c.status = 'active'
    ORDER BY c.created_at DESC
  `).bind(userId).all();

  return Response.json({
    success: true,
    conversations: conversations.results
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const userId = request.headers.get("x-user-id");

  if (!userId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const body = await request.json();

  if (!Array.isArray(body.participantIds) || body.participantIds.length === 0) {
    return Response.json(
      { success: false, error: "PARTICIPANTS_REQUIRED" },
      { status: 400 }
    );
  }

  const conversation = await env.DB.prepare(`
    INSERT INTO conversations
      (type, title, created_by, status)
    VALUES (?, ?, ?, 'active')
    RETURNING id
  `).bind(
    body.type || "private",
    body.title || null,
    userId
  ).first();

  const conversationId = conversation.id;

  const participants = [
    Number(userId),
    ...body.participantIds.map(Number)
  ];

  const uniqueParticipants = [...new Set(participants)];

  for (const participantId of uniqueParticipants) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO conversation_participants
      (conversation_id, user_id)
      VALUES (?, ?)
    `).bind(
      conversationId,
      participantId
    ).run();
  }

  return Response.json({
    success: true,
    conversationId
  });
}
