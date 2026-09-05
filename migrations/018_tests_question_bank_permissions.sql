-- =========================================================
-- الأوَّابين
-- 018_tests_question_bank_permissions.sql
-- صلاحيات الاختبارات وبنك الأسئلة
-- =========================================================

INSERT OR IGNORE INTO role_permissions (role, permission, enabled)
VALUES
  ('supervisor', 'tests.read', 1),
  ('supervisor', 'tests.write', 1),
  ('supervisor', 'question_bank.read', 1),
  ('supervisor', 'question_bank.write', 1),

  ('teacher', 'question_bank.read', 1),
  ('teacher', 'question_bank.write', 1);
