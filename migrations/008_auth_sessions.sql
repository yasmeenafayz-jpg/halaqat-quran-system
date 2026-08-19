PRAGMA foreign_keys = ON;

-- =========================================================
-- 008_auth_sessions.sql
-- الأوَّابين
-- جلسات تسجيل الدخول الآمنة
-- =========================================================

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  session_token_hash TEXT NOT NULL UNIQUE,

  expires_at TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  revoked_at TEXT,

  ip_address TEXT,

  user_agent TEXT,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
ON auth_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked
ON auth_sessions(revoked_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
ON auth_sessions(user_id, expires_at, revoked_at);
