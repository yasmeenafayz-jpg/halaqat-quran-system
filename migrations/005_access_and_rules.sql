PRAGMA foreign_keys = ON;

-- 005_access_and_rules.sql
-- الأوَّابين: الصلاحيات وقواعد التسجيل والغياب

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, permission)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, permission),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollment_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER,
  package_id INTEGER,
  allow_new_students INTEGER NOT NULL DEFAULT 1,
  require_introductory_meeting INTEGER NOT NULL DEFAULT 0,
  require_admin_approval INTEGER NOT NULL DEFAULT 1,
  allow_waitlist INTEGER NOT NULL DEFAULT 1,
  trial_days INTEGER NOT NULL DEFAULT 3,
  max_absences_per_month INTEGER NOT NULL DEFAULT 3,
  warning_after_absences INTEGER NOT NULL DEFAULT 2,
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enrollment_policies_circle
ON enrollment_policies(circle_id);

CREATE INDEX IF NOT EXISTS idx_enrollment_policies_package
ON enrollment_policies(package_id);

CREATE TABLE IF NOT EXISTS package_circle_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL,
  circle_type TEXT NOT NULL
    CHECK (circle_type IN ('individual','group')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(package_id, circle_type),
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,
  month_key TEXT NOT NULL,
  absence_count INTEGER NOT NULL DEFAULT 0,
  warning_level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (
      status IN (
        'open',
        'acknowledged',
        'resolved',
        'cancelled'
      )
    ),
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(
    student_id,
    circle_id,
    month_key,
    warning_level
  ),

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_warnings_student
ON attendance_warnings(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_warnings_circle_month
ON attendance_warnings(circle_id, month_key);

CREATE TABLE IF NOT EXISTS enrollment_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_request_id INTEGER,
  student_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,

  decision TEXT NOT NULL
    CHECK (
      decision IN (
        'accepted',
        'rejected',
        'waitlisted',
        'cancelled'
      )
    ),

  reason TEXT,
  decided_by INTEGER,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (enrollment_request_id)
    REFERENCES enrollment_requests(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (decided_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_enrollment_decisions_student
ON enrollment_decisions(student_id);

CREATE INDEX IF NOT EXISTS idx_enrollment_decisions_circle
ON enrollment_decisions(circle_id);

-- الصلاحيات الافتراضية

INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
('admin','*'),

('supervisor','students.read'),
('supervisor','students.write'),
('supervisor','teachers.read'),
('supervisor','circles.read'),
('supervisor','circles.write'),
('supervisor','sessions.read'),
('supervisor','sessions.write'),
('supervisor','attendance.read'),
('supervisor','attendance.write'),
('supervisor','reports.read'),

('teacher','students.read'),
('teacher','circles.read'),
('teacher','sessions.read'),
('teacher','sessions.write'),
('teacher','attendance.read'),
('teacher','attendance.write'),
('teacher','quran.read'),
('teacher','quran.write'),
('teacher','tests.read'),
('teacher','tests.write'),

('student','profile.read'),
('student','sessions.read'),
('student','attendance.read'),
('student','quran.read'),
('student','tests.read'),
('student','payments.read'),

('guardian','profile.read'),
('guardian','sessions.read'),
('guardian','attendance.read');

-- سياسة التسجيل الافتراضية
-- التجربة المجانية: 3 أيام
-- الحد الأقصى للغياب الشهري: 3

INSERT OR IGNORE INTO enrollment_policies (
  circle_id,
  package_id,
  allow_new_students,
  require_introductory_meeting,
  require_admin_approval,
  allow_waitlist,
  trial_days,
  max_absences_per_month,
  warning_after_absences,
  enabled,
  notes
)
VALUES (
  NULL,
  NULL,
  1,
  0,
  1,
  1,
  3,
  3,
  2,
  1,
  'Default enrollment policy'
);
