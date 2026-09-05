-- =========================================================
-- الأوَّابين
-- Migration 015 — Professional Session Types & Statuses
-- =========================================================
--
-- Purpose:
-- Expand sessions to support the approved professional
-- scheduling model without deleting existing session data.
--
-- Existing rows are preserved.
-- No seed/demo data is inserted.
-- =========================================================

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------
-- 1) Rebuild sessions with the professional session model
-- ---------------------------------------------------------

CREATE TABLE sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  circle_id INTEGER,
  teacher_id INTEGER,
  student_id INTEGER,

  session_type TEXT NOT NULL DEFAULT 'quran'
    CHECK (
      session_type IN (
        'quran',
        'noorani',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah',
        'group',
        'individual',
        'trial',
        'test',
        'independent_recitation',
        'scientific',
        'admin_meeting',
        'teacher_leave',
        'closed_slot'
      )
    ),

  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,

  meeting_provider TEXT,
  meeting_url TEXT,

  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (
      status IN (
        'scheduled',
        'started',
        'completed',
        'cancelled',
        'postponed',
        'no_show',
        'substitute',
        'rescheduled'
      )
    ),

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  series_id INTEGER,
  series_occurrence_date TEXT,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL
);

-- Preserve every existing session row.
INSERT INTO sessions_new (
  id,
  circle_id,
  teacher_id,
  session_type,
  session_date,
  start_time,
  end_time,
  meeting_provider,
  meeting_url,
  status,
  notes,
  created_at,
  updated_at,
  series_id,
  series_occurrence_date
)
SELECT
  id,
  circle_id,
  teacher_id,
  session_type,
  session_date,
  start_time,
  end_time,
  meeting_provider,
  meeting_url,
  status,
  notes,
  created_at,
  updated_at,
  series_id,
  series_occurrence_date
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions_new RENAME TO sessions;

-- ---------------------------------------------------------
-- 2) Restore indexes
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sessions_date
ON sessions(session_date, start_time);

CREATE INDEX IF NOT EXISTS idx_sessions_teacher
ON sessions(teacher_id, session_date, start_time);

CREATE INDEX IF NOT EXISTS idx_sessions_circle
ON sessions(circle_id, session_date, start_time);

CREATE INDEX IF NOT EXISTS idx_sessions_student
ON sessions(student_id, session_date, start_time);

CREATE INDEX IF NOT EXISTS idx_sessions_series
ON sessions(series_id, series_occurrence_date);

-- ---------------------------------------------------------
-- 3) Useful uniqueness guard for generated series sessions
-- ---------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS
idx_sessions_series_occurrence_unique
ON sessions(series_id, series_occurrence_date)
WHERE series_id IS NOT NULL
  AND series_occurrence_date IS NOT NULL;

PRAGMA foreign_keys=ON;
