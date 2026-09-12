-- الأوَّابين
-- 030_live_room_host_events
-- Extend live-room audit events for Host / Co-host delegation.

PRAGMA foreign_keys = ON;

-- SQLite does not support ALTER CHECK directly.
-- Rebuild the event table while preserving all existing data.

CREATE TABLE live_room_events_new (
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
        'recording_stopped',

        'host_assigned',
        'cohost_assigned',
        'host_revoked',
        'cohost_revoked',
        'cohost_permissions_updated'
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

INSERT INTO live_room_events_new (
  id,
  room_id,
  session_id,
  actor_user_id,
  event_type,
  target_user_id,
  metadata_json,
  created_at
)
SELECT
  id,
  room_id,
  session_id,
  actor_user_id,
  event_type,
  target_user_id,
  metadata_json,
  created_at
FROM live_room_events;

DROP TABLE live_room_events;

ALTER TABLE live_room_events_new
RENAME TO live_room_events;

CREATE INDEX IF NOT EXISTS idx_live_room_events_room
ON live_room_events(room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_events_session
ON live_room_events(session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_events_actor
ON live_room_events(actor_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_events_target
ON live_room_events(target_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_live_room_events_type
ON live_room_events(event_type, created_at);
