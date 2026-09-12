-- الأوَّابين
-- 026_live_room_permissions
-- صلاحيات الغرفة الحية داخل الأكاديمية

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO role_permissions
  (role, permission, enabled)
VALUES
  ('supervisor', 'live_room.read', 1),
  ('supervisor', 'live_room.write', 1),
  ('supervisor', 'live_room.moderate', 1),
  ('supervisor', 'live_room.record', 1),

  ('teacher', 'live_room.read', 1),
  ('teacher', 'live_room.write', 1),
  ('teacher', 'live_room.moderate', 1),
  ('teacher', 'live_room.record', 1),

  ('student', 'live_room.read', 1),
  ('student', 'live_room.join', 1);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission
ON role_permissions(permission);

CREATE INDEX IF NOT EXISTS idx_user_permissions_permission
ON user_permissions(permission);
