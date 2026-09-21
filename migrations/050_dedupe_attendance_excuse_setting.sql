-- =========================================================
-- الأوَّابين — Attendance Excuse Setting Reconciliation
-- Migration 050
-- =========================================================

-- تثبيت القيمة المعتمدة على كل السجلات الحالية.
UPDATE system_settings
SET setting_value = '24',
    value_type = 'number',
    updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'attendance.excuse_deadline_hours'
  AND scope_type = 'global'
  AND scope_id IS NULL;

-- الإبقاء على سجل عام واحد فقط للإعداد.
DELETE FROM system_settings
WHERE setting_key = 'attendance.excuse_deadline_hours'
  AND scope_type = 'global'
  AND scope_id IS NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM system_settings
    WHERE setting_key = 'attendance.excuse_deadline_hours'
      AND scope_type = 'global'
      AND scope_id IS NULL
  );

-- تثبيت قاعدة الاعتذار نفسها.
UPDATE attendance_excuse_rules
SET excuse_deadline_hours = 24,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
