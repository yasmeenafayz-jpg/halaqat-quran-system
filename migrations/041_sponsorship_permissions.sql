-- =========================================================
-- 041_sponsorship_permissions.sql
-- الأوَّابين
-- صلاحيات نظام الكفالة
-- =========================================================

INSERT OR IGNORE INTO role_permissions
  (role, permission, enabled)
VALUES
  ('admin', 'sponsorships.read', 1),
  ('admin', 'sponsorships.write', 1),
  ('supervisor', 'sponsorships.read', 1),
  ('supervisor', 'sponsorships.write', 1);
