-- Unified identity / multi-role foundation
-- users.role remains temporarily for backward compatibility.
-- user_roles becomes the authoritative list of enabled roles per person.

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_enabled
  ON user_roles(user_id, enabled);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_enabled
  ON user_roles(role, enabled);

-- Preserve every existing account's current role.
INSERT OR IGNORE INTO user_roles (user_id, role, enabled)
SELECT id, role, 1
FROM users
WHERE role IS NOT NULL
  AND TRIM(role) <> '';

