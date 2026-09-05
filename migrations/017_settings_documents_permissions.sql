-- 017_settings_documents_permissions.sql
-- Permissions for centralized settings and documents APIs.

INSERT OR IGNORE INTO role_permissions (role, permission, enabled)
VALUES
  ('admin', 'settings.read', 1),
  ('admin', 'settings.write', 1),
  ('admin', 'documents.read', 1),
  ('admin', 'documents.write', 1),
  ('admin', 'documents.permissions', 1),

  ('supervisor', 'settings.read', 1),
  ('supervisor', 'documents.read', 1),
  ('supervisor', 'documents.write', 1),

  ('teacher', 'documents.read', 1),

  ('student', 'documents.read', 1),

  ('guardian', 'documents.read', 1);
