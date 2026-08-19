PRAGMA foreign_keys = ON;

-- =========================================================
-- 005_access_and_rules.sql
-- الأوَّابين
-- الصلاحيات + قواعد التسجيل + السعة + الغياب
-- =========================================================


-- =========================================================
-- 1) صلاحيات الأدوار
-- =========================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  role TEXT NOT NULL
    CHECK (
      role IN (
        'admin',
        'supervisor',
        'teacher',
        'student',
        'guardian'
      )
    ),

  permission TEXT NOT NULL,

  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(role, permission)
);


-- =========================================================
-- 2) صلاحيات إضافية لمستخدم محدد
-- =========================================================

CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  permission TEXT NOT NULL,

  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, permission),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS idx_user_permissions_user
ON user_permissions(user_id);


-- =========================================================
-- 3) سياسات التسجيل
--
-- circle_id = NULL + package_id = NULL
-- تعني السياسة العامة الافتراضية.
--
-- سياسة الحلقة الخاصة تتغلب على السياسة العامة.
-- سياسة الباقة الخاصة تتغلب على العامة عند الحاجة.
-- =========================================================

CREATE TABLE IF NOT EXISTS enrollment_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  circle_id INTEGER,

  package_id INTEGER,

  allow_new_students INTEGER NOT NULL DEFAULT 1
    CHECK (allow_new_students IN (0, 1)),

  require_introductory_meeting INTEGER NOT NULL DEFAULT 0
    CHECK (require_introductory_meeting IN (0, 1)),

  require_admin_approval INTEGER NOT NULL DEFAULT 1
    CHECK (require_admin_approval IN (0, 1)),

  allow_waitlist INTEGER NOT NULL DEFAULT 1
    CHECK (allow_waitlist IN (0, 1)),

  trial_days INTEGER NOT NULL DEFAULT 3
    CHECK (trial_days >= 0),

  max_absences_per_month INTEGER NOT NULL DEFAULT 3
    CHECK (max_absences_per_month >= 0),

  warning_after_absences INTEGER NOT NULL DEFAULT 2
    CHECK (warning_after_absences >= 0),

  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (package_id)
    REFERENCES packages(id)
    ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS idx_enrollment_policies_circle
ON enrollment_policies(circle_id);


CREATE INDEX IF NOT EXISTS idx_enrollment_policies_package
ON enrollment_policies(package_id);


-- =========================================================
-- 4) منع تكرار السياسة لنفس الحلقة/الباقة
--
-- SQLite لا يسمح بـ UNIQUE بسيط مناسب لحالات NULL،
-- لذلك نستخدم unique indexes منفصلة.
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_policy_circle
ON enrollment_policies(circle_id)
WHERE circle_id IS NOT NULL
  AND package_id IS NULL;


CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_policy_package
ON enrollment_policies(package_id)
WHERE package_id IS NOT NULL
  AND circle_id IS NULL;


CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollment_policy_circle_package
ON enrollment_policies(circle_id, package_id)
WHERE circle_id IS NOT NULL
  AND package_id IS NOT NULL;


-- =========================================================
-- 5) توافق الباقة مع نوع الحلقة
--
-- الباقة الفردية -> حلقة فردية
-- الباقة الجماعية -> حلقة جماعية
--
-- القرار النهائي يتم في الـAPI.
-- =========================================================

CREATE TABLE IF NOT EXISTS package_circle_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  package_id INTEGER NOT NULL,

  circle_type TEXT NOT NULL
    CHECK (
      circle_type IN (
        'individual',
        'group'
      )
    ),

  enabled INTEGER NOT NULL DEFAULT 1
    CHECK (enabled IN (0, 1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(package_id, circle_type),

  FOREIGN KEY (package_id)
    REFERENCES packages(id)
    ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS idx_package_circle_rules_package
ON package_circle_rules(package_id);


-- =========================================================
-- 6) تحذيرات الغياب
--
-- تستخدم للحلقات الجماعية.
-- =========================================================

CREATE TABLE IF NOT EXISTS attendance_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  circle_id INTEGER NOT NULL,

  month_key TEXT NOT NULL,

  absence_count INTEGER NOT NULL DEFAULT 0
    CHECK (absence_count >= 0),

  warning_level INTEGER NOT NULL DEFAULT 1
    CHECK (warning_level >= 1),

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
ON attendance_warnings(
  circle_id,
  month_key
);


-- =========================================================
-- 7) قرارات طلبات التسجيل
-- =========================================================

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


-- =========================================================
-- 8) الصلاحيات الافتراضية
-- =========================================================

INSERT OR IGNORE INTO role_permissions
(role, permission)
VALUES

-- الإدارة
('admin', '*'),

-- المشرفة
('supervisor', 'students.read'),
('supervisor', 'students.write'),
('supervisor', 'teachers.read'),
('supervisor', 'teachers.write'),
('supervisor', 'circles.read'),
('supervisor', 'circles.write'),
('supervisor', 'sessions.read'),
('supervisor', 'sessions.write'),
('supervisor', 'attendance.read'),
('supervisor', 'attendance.write'),
('supervisor', 'reports.read'),
('supervisor', 'quran.read'),
('supervisor', 'quran.write'),

-- المعلمة
('teacher', 'students.read'),
('teacher', 'circles.read'),
('teacher', 'sessions.read'),
('teacher', 'sessions.write'),
('teacher', 'attendance.read'),
('teacher', 'attendance.write'),
('teacher', 'quran.read'),
('teacher', 'quran.write'),
('teacher', 'tests.read'),
('teacher', 'tests.write'),

-- الطالب
('student', 'profile.read'),
('student', 'sessions.read'),
('student', 'attendance.read'),
('student', 'quran.read'),
('student', 'tests.read'),
('student', 'payments.read'),

-- ولي الأمر
('guardian', 'profile.read'),
('guardian', 'sessions.read'),
('guardian', 'attendance.read');


-- =========================================================
-- 9) السياسة العامة الافتراضية
--
-- تجربة مجانية: 3 أيام
-- تحذير: بعد غيابين
-- الحد الشهري: 3 غيابات
-- الانتظار: مسموح
-- موافقة الإدارة: مطلوبة
-- =========================================================

INSERT INTO enrollment_policies (
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
SELECT
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
WHERE NOT EXISTS (
  SELECT 1
  FROM enrollment_policies
  WHERE circle_id IS NULL
    AND package_id IS NULL
);


-- =========================================================
-- 10) قواعد افتراضية لتوافق نوع الباقات
--
-- نقرأ package_type الموجود أصلًا في packages.
-- =========================================================

INSERT OR IGNORE INTO package_circle_rules (
  package_id,
  circle_type,
  enabled
)
SELECT
  id,
  package_type,
  1
FROM packages
WHERE package_type IN (
  'individual',
  'group'
);


-- =========================================================
-- نهاية 005
-- =========================================================
