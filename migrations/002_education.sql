PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  package_type TEXT NOT NULL CHECK (
    package_type IN ('individual', 'group')
  ),
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  sessions_per_month INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  capacity INTEGER,
  rules TEXT,
  trial_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS circles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  circle_type TEXT NOT NULL CHECK (
    circle_type IN ('individual', 'group')
  ),
  teacher_id INTEGER,
  package_id INTEGER,
  capacity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'inactive',
        'full',
        'archived'
      )
    ),
  schedule_note TEXT,
  level_name TEXT,
  path_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,
  FOREIGN KEY (package_id)
    REFERENCES packages(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS circle_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'pending',
        'active',
        'paused',
        'completed',
        'cancelled'
      )
    ),
  joined_via TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(circle_id, student_id),
  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS circle_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (
      status IN (
        'waiting',
        'accepted',
        'rejected',
        'cancelled'
      )
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER,
  teacher_id INTEGER,
  session_type TEXT NOT NULL DEFAULT 'quran'
    CHECK (
      session_type IN (
        'quran',
        'noorani',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah'
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
        'completed',
        'cancelled',
        'rescheduled'
      )
    ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,
  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (
      status IN (
        'present',
        'absent',
        'late',
        'excused'
      )
    ),
  late_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, student_id),
  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_circle_enrollments_circle
ON circle_enrollments(circle_id);

CREATE INDEX IF NOT EXISTS idx_circle_enrollments_student
ON circle_enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_sessions_date
ON sessions(session_date);

CREATE INDEX IF NOT EXISTS idx_attendance_student
ON attendance(student_id);
