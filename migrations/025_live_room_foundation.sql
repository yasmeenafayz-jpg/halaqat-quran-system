-- الأوَّابين
-- 025_live_room_foundation
-- Stable live-room identity for academy-hosted sessions.
-- No media provider is hard-coded here.

CREATE TABLE IF NOT EXISTS live_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  session_id INTEGER NOT NULL UNIQUE,

  room_key TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (
      status IN (
        'ready',
        'open',
        'closed',
        'ended',
        'disabled'
      )
    ),

  media_provider TEXT,
  provider_room_id TEXT,

  max_viewers INTEGER NOT NULL DEFAULT 1000
    CHECK (max_viewers >= 1),

  max_active_speakers INTEGER NOT NULL DEFAULT 8
    CHECK (max_active_speakers >= 1),

  recording_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (recording_enabled IN (0,1)),

  recording_started_at TEXT,
  recording_stopped_at TEXT,

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_rooms_status
ON live_rooms(status);

CREATE INDEX IF NOT EXISTS idx_live_rooms_provider
ON live_rooms(media_provider, provider_room_id);

CREATE TABLE IF NOT EXISTS live_room_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  participant_role TEXT NOT NULL
    CHECK (
      participant_role IN (
        'teacher',
        'student',
        'admin',
        'supervisor'
      )
    ),

  connection_status TEXT NOT NULL DEFAULT 'connected'
    CHECK (
      connection_status IN (
        'connecting',
        'connected',
        'reconnecting',
        'disconnected',
        'removed'
      )
    ),

  media_role TEXT NOT NULL DEFAULT 'listener'
    CHECK (
      media_role IN (
        'listener',
        'speaker'
      )
    ),

  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TEXT,

  last_seen_at TEXT,

  mic_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (mic_enabled IN (0,1)),

  camera_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (camera_enabled IN (0,1)),

  removed_by INTEGER,
  removed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (room_id)
    REFERENCES live_rooms(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (removed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_room_participants_room
ON live_room_participants(room_id, connection_status);

CREATE INDEX IF NOT EXISTS idx_live_room_participants_user
ON live_room_participants(user_id, room_id);

CREATE INDEX IF NOT EXISTS idx_live_room_participants_role
ON live_room_participants(room_id, media_role);

CREATE TABLE IF NOT EXISTS live_room_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  room_id INTEGER NOT NULL,

  session_id INTEGER NOT NULL,

  actor_user_id INTEGER,

  event_type TEXT NOT NULL
    CHECK (
      event_type IN (
        'room_created',
        'room_opened',
        'room_closed',
        'room_ended',
        'participant_joined',
        'participant_left',
        'participant_removed',
        'participant_reconnected',
        'speaker_granted',
        'speaker_revoked',
        'mic_muted',
        'mic_unmuted',
        'camera_disabled',
        'camera_enabled',
        'recording_started',
        'recording_stopped'
      )
    ),

  target_user_id INTEGER,

  metadata_json TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (room_id)
    REFERENCES live_rooms(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (target_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_live_room_events_room
ON live_room_events(room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_events_session
ON live_room_events(session_id, created_at);
