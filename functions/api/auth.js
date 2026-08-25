async function hasPermission(
  db,
  user,
  permission
) {
  if (!permission) {
    return false;
  }

  // المدير له جميع الصلاحيات
  if (user.role === "admin") {
    return true;
  }

  // صلاحية مخصصة للمستخدم
  const userPermission = await db
    .prepare(`
      SELECT enabled
      FROM user_permissions
      WHERE user_id = ?
        AND permission = ?
      LIMIT 1
    `)
    .bind(
      user.id,
      permission
    )
    .first();

  // إذا وُجدت صلاحية مخصصة فهي صاحبة الأولوية
  if (userPermission) {
    return Number(
      userPermission.enabled
    ) === 1;
  }

  // صلاحية الدور
  const rolePermission = await db
    .prepare(`
      SELECT enabled
      FROM role_permissions
      WHERE role = ?
        AND permission = ?
      LIMIT 1
    `)
    .bind(
      user.role,
      permission
    )
    .first();

  return (
    !!rolePermission &&
    Number(
      rolePermission.enabled
    ) === 1
  );
}

