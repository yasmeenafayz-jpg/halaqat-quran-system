-- الأوَّابين
-- 031_live_room_board
-- Session-scoped interactive whiteboard.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_room_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  room_id INTEGER NOT NULL UNIQUE,
  session_id INTEGER NOT NULL UNIQUE,

  state_json TEXT NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'locked',
        'cleared'
      )
    ),

  version INTEGER NOT NULL DEFAULT 1,

  updated_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (room_id)
    REFERENCES live_rooms(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_room_boards_session
ON live_room_boards(session_id);

CREATE INDEX IF NOT EXISTS idx_live_room_boards_updated
ON live_room_boards(updated_at);
