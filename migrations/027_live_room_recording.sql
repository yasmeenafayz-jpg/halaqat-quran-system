-- الأوَّابين
-- 027_live_room_recording
-- Recording metadata for academy-hosted live rooms.
-- Recording is explicit and permission-controlled.
-- No automatic recording and no student recording capability.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS live_room_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created',
      'recording',
      'stopped',
      'processing',
      'ready',
      'failed',
      'deleted'
    )),
  provider_recording_id TEXT,
  storage_key TEXT,
  file_url TEXT,
  started_at TEXT,
  stopped_at TEXT,
  duration_seconds INTEGER,
  started_by INTEGER,
  stopped_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (room_id)
    REFERENCES live_rooms(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (started_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (stopped_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_room_recordings_room
ON live_room_recordings(room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_recordings_session
ON live_room_recordings(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_recordings_status
ON live_room_recordings(status);

CREATE UNIQUE INDEX IF NOT EXISTS
idx_live_room_recordings_active
ON live_room_recordings(room_id)
WHERE status = 'recording';
