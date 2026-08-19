PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS quran_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quran_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  FOREIGN KEY (path_id)
    REFERENCES quran_paths(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quran_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  session_id INTEGER,
  level_id INTEGER,
  activity_type TEXT NOT NULL
    CHECK (
      activity_type IN (
        'new_memorization',
        'review',
        'memorization_review',
        'tamkeen',
        'cumulative_recitation'
      )
    ),
  surah_number INTEGER NOT NULL,
  surah_name TEXT,
  from_ayah INTEGER,
  to_ayah INTEGER,
  amount_label TEXT,
  amount_value REAL,
  quality_score REAL,
  teacher_note TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL,
  FOREIGN KEY (level_id)
    REFERENCES quran_levels(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quran_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  progress_id INTEGER,
  session_id INTEGER,
  file_url TEXT NOT NULL,
  duration_seconds INTEGER,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  transcript TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY (progress_id)
    REFERENCES quran_progress(id)
    ON DELETE SET NULL,
  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  teacher_id INTEGER,
  session_id INTEGER,
  title TEXT NOT NULL,
  test_type TEXT,
  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 100,
  percentage REAL NOT NULL DEFAULT 0,
  result TEXT,
  notes TEXT,
  tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,
  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS student_progress_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL UNIQUE,
  memorized_juz_count REAL NOT NULL DEFAULT 0,
  cumulative_score REAL NOT NULL DEFAULT 0,
  current_path_id INTEGER,
  current_level_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,
  FOREIGN KEY (current_path_id)
    REFERENCES quran_paths(id)
    ON DELETE SET NULL,
  FOREIGN KEY (current_level_id)
    REFERENCES quran_levels(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quran_progress_student
ON quran_progress(student_id);

CREATE INDEX IF NOT EXISTS idx_quran_progress_date
ON quran_progress(recorded_at);

CREATE INDEX IF NOT EXISTS idx_tests_student
ON tests(student_id);
