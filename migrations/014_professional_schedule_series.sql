-- =========================================================
-- الأوَّابين
-- Migration 014 — Professional Schedule Series
-- =========================================================

-- ---------------------------------------------------------
-- 1) سلاسل المواعيد
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS schedule_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT,

  circle_id INTEGER,
  teacher_id INTEGER,
  student_id INTEGER,

  session_type TEXT NOT NULL DEFAULT 'quran',

  recurrence_type TEXT NOT NULL DEFAULT 'once'
    CHECK (
      recurrence_type IN (
        'once',
        'daily',
        'weekly',
        'biweekly',
        'monthly',
        'custom'
      )
    ),

  interval_value INTEGER NOT NULL DEFAULT 1
    CHECK (interval_value >= 1),

  weekdays_json TEXT,

  start_date TEXT NOT NULL,
  end_date TEXT,

  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,

  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'paused',
        'stopped',
        'completed',
        'cancelled'
      )
    ),

  notes TEXT,

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (
    end_date IS NULL
    OR end_date >= start_date
  )
);

CREATE INDEX IF NOT EXISTS idx_schedule_series_teacher
ON schedule_series(teacher_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_schedule_series_circle
ON schedule_series(circle_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_schedule_series_student
ON schedule_series(student_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_schedule_series_status
ON schedule_series(status);


-- ---------------------------------------------------------
-- 2) استثناءات السلاسل
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  series_id INTEGER NOT NULL,

  occurrence_date TEXT NOT NULL,

  exception_type TEXT NOT NULL
    CHECK (
      exception_type IN (
        'cancelled',
        'rescheduled',
        'modified',
        'skipped'
      )
    ),

  new_date TEXT,
  new_start_time TEXT,
  new_end_time TEXT,

  replacement_teacher_id INTEGER,

  reason TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (series_id)
    REFERENCES schedule_series(id)
    ON DELETE CASCADE,

  FOREIGN KEY (replacement_teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  UNIQUE(series_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_series
ON schedule_exceptions(series_id, occurrence_date);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_new_date
ON schedule_exceptions(new_date);


-- ---------------------------------------------------------
-- 3) ربط الجلسات بالسلسلة
-- ---------------------------------------------------------

ALTER TABLE sessions
ADD COLUMN series_id INTEGER;

ALTER TABLE sessions
ADD COLUMN series_occurrence_date TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_series
ON sessions(series_id, series_occurrence_date);


-- ---------------------------------------------------------
-- 4) صلاحيات الجدولة
-- ---------------------------------------------------------

INSERT OR IGNORE INTO role_permissions
(role, permission)
VALUES
('admin', 'schedule.series.read'),
('admin', 'schedule.series.write'),
('admin', 'schedule.leave.read'),
('admin', 'schedule.leave.write'),
('admin', 'schedule.exceptions.write'),

('supervisor', 'schedule.series.read'),
('supervisor', 'schedule.series.write'),
('supervisor', 'schedule.leave.read'),
('supervisor', 'schedule.leave.write'),
('supervisor', 'schedule.exceptions.write'),

('teacher', 'schedule.series.read'),
('teacher', 'schedule.leave.read'),
('teacher', 'schedule.leave.write'),

('student', 'schedule.series.read'),
('guardian', 'schedule.series.read');
