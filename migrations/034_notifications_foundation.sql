-- =========================================================
-- 034. Notifications Foundation
-- =========================================================
-- Extends the existing notifications table.
-- Does NOT create a second notifications table.
-- =========================================================

ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low','normal','high','urgent'));

ALTER TABLE notifications ADD COLUMN source_type TEXT;

ALTER TABLE notifications ADD COLUMN source_id INTEGER;

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;

ALTER TABLE notifications ADD COLUMN read_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_user_status
ON notifications(user_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON notifications(user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_student
ON notifications(student_id);

CREATE INDEX IF NOT EXISTS idx_notifications_source
ON notifications(source_type, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
ON notifications(dedupe_key)
WHERE dedupe_key IS NOT NULL;

-- =========================================================
-- Permissions
-- =========================================================

INSERT OR IGNORE INTO role_permissions (role, permission, enabled)
VALUES
  ('admin',      'notifications.read',  1),
  ('admin',      'notifications.write', 1),
  ('supervisor', 'notifications.read',  1),
  ('supervisor', 'notifications.write', 1),
  ('teacher',    'notifications.read',  1),
  ('student',    'notifications.read',  1),
  ('guardian',   'notifications.read',  1);

-- =========================================================
-- 034 END
-- =========================================================
