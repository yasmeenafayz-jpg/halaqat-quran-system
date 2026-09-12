-- الأوَّابين
-- 028_live_room_host_controls
-- Session-scoped Host / Co-host controls.
-- Co-host is delegated per live room and is never a global role.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_room_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  host_role TEXT NOT NULL DEFAULT 'cohost'
    CHECK (
      host_role IN (
        'host',
        'cohost'
      )
    ),

  permissions_json TEXT NOT NULL DEFAULT '[]',

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'revoked'
      )
    ),

  assigned_by INTEGER,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_by INTEGER,
  revoked_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (room_id)
    REFERENCES live_rooms(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (assigned_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (revoked_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_room_hosts_active_user
ON live_room_hosts(room_id, user_id)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_live_room_hosts_room
ON live_room_hosts(room_id, status);

CREATE INDEX IF NOT EXISTS idx_live_room_hosts_user
ON live_room_hosts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_live_room_hosts_role
ON live_room_hosts(room_id, host_role, status);

CREATE INDEX IF NOT EXISTS idx_live_room_hosts_assigned_by
ON live_room_hosts(assigned_by, assigned_at);
