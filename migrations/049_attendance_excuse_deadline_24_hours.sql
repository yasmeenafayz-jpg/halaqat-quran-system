-- =========================================================
-- الأوَّابين — Attendance Excuse Deadline: 24 Hours
-- Migration 049
-- =========================================================

-- القاعدة المعتمدة: الاعتذار يُقبل في موعد لا يقل عن
-- 24 ساعة قبل بداية الجلسة.
UPDATE attendance_excuse_rules
SET excuse_deadline_hours = 24,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

UPDATE system_settings
SET setting_value = '24',
    updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'attendance.excuse_deadline_hours';

-- في حالة عدم وجود إعداد النظام لأي سبب، أنشئه بالقيمة المعتمدة.
INSERT OR IGNORE INTO system_settings (
  setting_key,
  setting_value,
  value_type,
  scope_type,
  description,
  is_sensitive,
  is_editable
)
VALUES (
  'attendance.excuse_deadline_hours',
  '24',
  'number',
  'global',
  'مهلة الاعتذار قبل الجلسة',
  0,
  1
);
