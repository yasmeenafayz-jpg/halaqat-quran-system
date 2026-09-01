-- =========================================================
-- الأوَّابين — Absence Excuse Billing Rules
-- Migration 013
-- =========================================================

CREATE TABLE IF NOT EXISTS attendance_excuse_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  excuse_deadline_hours INTEGER NOT NULL DEFAULT 4
    CHECK (excuse_deadline_hours >= 0),

  late_excuse_is_chargeable INTEGER NOT NULL DEFAULT 1
    CHECK (late_excuse_is_chargeable IN (0,1)),

  absent_without_excuse_is_chargeable INTEGER NOT NULL DEFAULT 1
    CHECK (absent_without_excuse_is_chargeable IN (0,1)),

  excused_absence_is_chargeable INTEGER NOT NULL DEFAULT 0
    CHECK (excused_absence_is_chargeable IN (0,1)),

  cancelled_by_academy_is_chargeable INTEGER NOT NULL DEFAULT 0
    CHECK (cancelled_by_academy_is_chargeable IN (0,1)),

  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0,1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO attendance_excuse_rules (
  id,
  excuse_deadline_hours,
  late_excuse_is_chargeable,
  absent_without_excuse_is_chargeable,
  excused_absence_is_chargeable,
  cancelled_by_academy_is_chargeable,
  active
)
VALUES (
  1,
  4,
  1,
  1,
  0,
  0,
  1
);

CREATE TABLE IF NOT EXISTS attendance_excuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attendance_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,

  excuse_text TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'approved',
        'rejected'
      )
    ),

  reviewed_at TEXT,
  reviewed_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (attendance_id)
    REFERENCES attendance(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  UNIQUE(attendance_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_excuses_student
ON attendance_excuses(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_excuses_session
ON attendance_excuses(session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_excuses_status
ON attendance_excuses(status);
