-- =========================================================
-- الأوَّابين - Migration 021
-- الرفيقة + المتابعة اليومية + الورد الأسبوعي
-- + تسجيل الحلقة + أدوار التسميع
-- لا يوجد تسجيل صوتي
-- =========================================================

-- 1. الرفيقة الثابتة
CREATE TABLE IF NOT EXISTS buddy_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  buddy_student_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','ended','cancelled')),
  assigned_by INTEGER,
  ended_by INTEGER,
  reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (buddy_student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (ended_by) REFERENCES users(id) ON DELETE SET NULL,

  CHECK (student_id <> buddy_student_id),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_buddy_pairs_circle
ON buddy_pairs(circle_id, status);

CREATE INDEX IF NOT EXISTS idx_buddy_pairs_student
ON buddy_pairs(student_id, status);

CREATE INDEX IF NOT EXISTS idx_buddy_pairs_buddy
ON buddy_pairs(buddy_student_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_buddy_student
ON buddy_pairs(student_id)
WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_buddy_buddy
ON buddy_pairs(buddy_student_id)
WHERE status = 'active';


-- 2. تاريخ تغييرات الرفيقة
CREATE TABLE IF NOT EXISTS buddy_pair_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buddy_pair_id INTEGER,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  old_buddy_student_id INTEGER,
  new_buddy_student_id INTEGER,

  change_type TEXT NOT NULL
    CHECK (change_type IN ('assigned','changed','ended','cancelled')),

  reason TEXT,
  changed_by INTEGER,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (buddy_pair_id)
    REFERENCES buddy_pairs(id) ON DELETE SET NULL,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id) ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  FOREIGN KEY (old_buddy_student_id)
    REFERENCES students(id) ON DELETE SET NULL,

  FOREIGN KEY (new_buddy_student_id)
    REFERENCES students(id) ON DELETE SET NULL,

  FOREIGN KEY (changed_by)
    REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_buddy_pair_changes_student
ON buddy_pair_changes(student_id, changed_at);

CREATE INDEX IF NOT EXISTS idx_buddy_pair_changes_circle
ON buddy_pair_changes(circle_id, changed_at);


-- 3. المتابعة اليومية الإلزامية للرفيقة
CREATE TABLE IF NOT EXISTS buddy_daily_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buddy_pair_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  buddy_student_id INTEGER NOT NULL,
  followup_date TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','missed','excused')),

  student_confirmed INTEGER NOT NULL DEFAULT 0
    CHECK (student_confirmed IN (0,1)),

  buddy_confirmed INTEGER NOT NULL DEFAULT 0
    CHECK (buddy_confirmed IN (0,1)),

  note TEXT,
  completed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (buddy_pair_id)
    REFERENCES buddy_pairs(id) ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id) ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  FOREIGN KEY (buddy_student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  UNIQUE(buddy_pair_id, followup_date)
);

CREATE INDEX IF NOT EXISTS idx_buddy_followups_date
ON buddy_daily_followups(followup_date, status);

CREATE INDEX IF NOT EXISTS idx_buddy_followups_student
ON buddy_daily_followups(student_id, followup_date);

CREATE INDEX IF NOT EXISTS idx_buddy_followups_buddy
ON buddy_daily_followups(buddy_student_id, followup_date);


-- 4. الورد الأسبوعي الموحد للحلقة
CREATE TABLE IF NOT EXISTS weekly_wirds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  week_start_date TEXT NOT NULL,

  title TEXT,

  surah_number INTEGER,
  surah_name TEXT,
  from_ayah INTEGER,
  to_ayah INTEGER,

  amount_label TEXT,
  amount_value REAL,

  instructions TEXT,
  notes TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','completed','cancelled')),

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,

  CHECK (from_ayah IS NULL OR from_ayah >= 1),
  CHECK (to_ayah IS NULL OR to_ayah >= 1),
  CHECK (
    from_ayah IS NULL
    OR to_ayah IS NULL
    OR to_ayah >= from_ayah
  ),
  CHECK (amount_value IS NULL OR amount_value >= 0),

  UNIQUE(circle_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_wirds_circle
ON weekly_wirds(circle_id, week_start_date);

CREATE INDEX IF NOT EXISTS idx_weekly_wirds_status
ON weekly_wirds(status, week_start_date);


-- 5. مهام الورد اليومية
CREATE TABLE IF NOT EXISTS weekly_wird_daily_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  weekly_wird_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,
  task_date TEXT NOT NULL,

  task_type TEXT NOT NULL DEFAULT 'recitation'
    CHECK (
      task_type IN (
        'memorization',
        'review',
        'recitation',
        'tamkeen'
      )
    ),

  surah_number INTEGER,
  surah_name TEXT,
  from_ayah INTEGER,
  to_ayah INTEGER,

  amount_label TEXT,
  amount_value REAL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','missed','excused')),

  quality_score REAL,

  teacher_note TEXT,
  student_note TEXT,
  completed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (weekly_wird_id)
    REFERENCES weekly_wirds(id) ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id) ON DELETE CASCADE,

  CHECK (
    quality_score IS NULL
    OR (quality_score >= 0 AND quality_score <= 100)
  ),

  CHECK (from_ayah IS NULL OR from_ayah >= 1),
  CHECK (to_ayah IS NULL OR to_ayah >= 1),

  CHECK (
    from_ayah IS NULL
    OR to_ayah IS NULL
    OR to_ayah >= from_ayah
  ),

  UNIQUE(weekly_wird_id, student_id, task_date)
);

CREATE INDEX IF NOT EXISTS idx_wird_tasks_student_date
ON weekly_wird_daily_tasks(student_id, task_date);

CREATE INDEX IF NOT EXISTS idx_wird_tasks_circle_date
ON weekly_wird_daily_tasks(circle_id, task_date);

CREATE INDEX IF NOT EXISTS idx_wird_tasks_status
ON weekly_wird_daily_tasks(status, task_date);


-- 6. نافذة تسجيل الحلقة
CREATE TABLE IF NOT EXISTS session_registration_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL UNIQUE,

  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','open','closed','cancelled')),

  max_registrations INTEGER,

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id) ON DELETE SET NULL,

  CHECK (closes_at > opens_at),

  CHECK (
    max_registrations IS NULL
    OR max_registrations >= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_registration_windows_dates
ON session_registration_windows(opens_at, closes_at);

CREATE INDEX IF NOT EXISTS idx_registration_windows_status
ON session_registration_windows(status);


-- 7. تسجيل الطلاب في الجلسة
CREATE TABLE IF NOT EXISTS session_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,

  registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (
      status IN (
        'registered',
        'cancelled',
        'removed',
        'completed',
        'no_show'
      )
    ),

  registration_source TEXT NOT NULL DEFAULT 'student'
    CHECK (
      registration_source IN (
        'student',
        'teacher',
        'admin',
        'system'
      )
    ),

  cancelled_at TEXT,
  cancelled_by INTEGER,
  note TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  FOREIGN KEY (cancelled_by)
    REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_session_registrations_session
ON session_registrations(session_id, status);

CREATE INDEX IF NOT EXISTS idx_session_registrations_student
ON session_registrations(student_id, registered_at);


-- 8. أدوار التسميع
CREATE TABLE IF NOT EXISTS session_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  session_id INTEGER NOT NULL,
  registration_id INTEGER NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,

  turn_number INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (
      status IN (
        'waiting',
        'called',
        'reciting',
        'completed',
        'skipped',
        'absent',
        'cancelled'
      )
    ),

  called_at TEXT,
  started_at TEXT,
  completed_at TEXT,

  quran_progress_id INTEGER,

  teacher_note TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,

  FOREIGN KEY (registration_id)
    REFERENCES session_registrations(id) ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id) ON DELETE CASCADE,

  FOREIGN KEY (quran_progress_id)
    REFERENCES quran_progress(id) ON DELETE SET NULL,

  UNIQUE(session_id, turn_number)
);

CREATE INDEX IF NOT EXISTS idx_session_turns_session
ON session_turns(session_id, turn_number);

CREATE INDEX IF NOT EXISTS idx_session_turns_student
ON session_turns(student_id);

CREATE INDEX IF NOT EXISTS idx_session_turns_status
ON session_turns(session_id, status);


-- =========================================================
-- 9. الصلاحيات
-- =========================================================

INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
('admin', 'buddy.read'),
('admin', 'buddy.write'),
('admin', 'buddy.followup.read'),
('admin', 'buddy.followup.write'),
('supervisor', 'buddy.read'),
('supervisor', 'buddy.write'),
('supervisor', 'buddy.followup.read'),
('supervisor', 'buddy.followup.write'),
('teacher', 'buddy.read'),
('teacher', 'buddy.write'),
('teacher', 'buddy.followup.read'),
('teacher', 'buddy.followup.write'),
('student', 'buddy.read'),
('student', 'buddy.followup.read'),

('admin', 'wird.read'),
('admin', 'wird.write'),
('supervisor', 'wird.read'),
('supervisor', 'wird.write'),
('teacher', 'wird.read'),
('teacher', 'wird.write'),
('student', 'wird.read'),

('admin', 'session.registration.read'),
('admin', 'session.registration.write'),
('admin', 'session.turn.read'),
('admin', 'session.turn.write'),
('supervisor', 'session.registration.read'),
('supervisor', 'session.registration.write'),
('supervisor', 'session.turn.read'),
('supervisor', 'session.turn.write'),
('teacher', 'session.registration.read'),
('teacher', 'session.registration.write'),
('teacher', 'session.turn.read'),
('teacher', 'session.turn.write'),
('student', 'session.registration.read'),
('student', 'session.registration.write'),
('student', 'session.turn.read');

-- =========================================================
-- END 021
-- =========================================================
