export async function onRequestPost(context) {
  const { env, request } = context;

  const adminId = request.headers.get("x-user-id");

  if (!adminId) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // التحقق من أن المستخدم إداري
  const admin = await env.DB.prepare(`
    SELECT id, role
    FROM users
    WHERE id = ?
  `).bind(adminId).first();

  if (!admin || admin.role !== "admin") {
    return Response.json(
      { success: false, error: "ADMIN_ONLY" },
      { status: 403 }
    );
  }

  const body = await request.json();

  if (!body.userId) {
    return Response.json(
      { success: false, error: "USER_REQUIRED" },
      { status: 400 }
    );
  }

  // منح الصلاحية الحصرية
  await env.DB.prepare(`
    INSERT OR REPLACE INTO user_permissions
      (user_id, permission_code, granted)
    VALUES (?, 'act_as_teacher', 1)
  `).bind(body.userId).run();

  // تسجيل العملية
  await env.DB.prepare(`
    INSERT INTO teacher_mode_audit
      (user_id, enabled_by, action)
    VALUES (?, ?, 'enabled')
  `).bind(
    body.userId,
    adminId
  ).run();

  return Response.json({
    success: true,
    message: "تم تفعيل وضع المعلمة"
  });
}
