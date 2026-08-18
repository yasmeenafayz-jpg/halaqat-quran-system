const DEFAULT_PERMISSIONS = [
  ["students.view", "عرض الطلاب"],
  ["students.edit", "تعديل الطلاب"],

  ["teachers.view", "عرض المعلمين"],
  ["teachers.edit", "تعديل المعلمين"],

  ["groups.view", "عرض الحلقات"],
  ["groups.create", "إنشاء الحلقات"],
  ["groups.edit", "تعديل الحلقات"],
  ["groups.delete", "حذف الحلقات"],

  ["attendance.view", "عرض الحضور"],
  ["attendance.edit", "تعديل الحضور"],

  ["quran.view", "عرض بيانات القرآن"],
  ["quran.edit", "تعديل بيانات القرآن"],

  ["finance.view", "عرض المالية"],
  ["finance.edit", "تعديل المالية"],

  ["messages.view", "عرض الرسائل"],
  ["messages.send", "إرسال الرسائل"],

  ["reports.view", "عرض التقارير"],

  ["settings.edit", "تعديل الإعدادات"],

  ["act_as_teacher", "العمل كمعلمة"]
];

export async function onRequestGet(context) {
  const { env } = context;

  for (const [code, name] of DEFAULT_PERMISSIONS) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO permissions
      (code, name)
      VALUES (?, ?)
    `).bind(code, name).run();
  }

  const result = await env.DB.prepare(`
    SELECT id, code, name
    FROM permissions
    ORDER BY id
  `).all();

  return Response.json({
    success: true,
    permissions: result.results
  });
}
