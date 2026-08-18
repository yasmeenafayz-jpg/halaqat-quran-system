PRAGMA foreign_keys = ON;

-- =========================================
-- أدوار النظام الجديدة
-- =========================================

INSERT OR IGNORE INTO roles (code, name)
VALUES ('guardian', 'ولي الأمر');

INSERT OR IGNORE INTO roles (code, name)
VALUES ('supervisor', 'المشرفة');


-- =========================================
-- تعدد الأدوار للمستخدم الواحد
-- =========================================

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role_code TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, role_code),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================================
-- صلاحيات المستخدم
-- =========================================

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  permission_code TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,

  UNIQUE(user_id, permission_code),

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================================
-- ولي الأمر
-- =========================================

CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS guardian_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  relationship TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(guardian_id, student_id),

  FOREIGN KEY (guardian_id)
    REFERENCES guardians(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);


-- =========================================
-- ملف المعلم
-- =========================================

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL UNIQUE,
  gender TEXT,
  birth_date TEXT,
  city TEXT,
  bio TEXT,
  qualifications TEXT,
  ijazat TEXT,
  certificates TEXT,
  experience_years INTEGER DEFAULT 0,
  memorized_amount TEXT,
  specialties TEXT,
  available_days TEXT,
  available_times TEXT,
  status TEXT DEFAULT 'available',

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE
);


-- =========================================
-- سعة الحلقات
-- نستخدم circles الموجودة بالفعل
-- =========================================

ALTER TABLE circles
ADD COLUMN min_students INTEGER DEFAULT 1;

ALTER TABLE circles
ADD COLUMN max_students INTEGER;

ALTER TABLE circles
ADD COLUMN registration_status TEXT DEFAULT 'open';


-- =========================================
-- قائمة انتظار الحلقات
-- =========================================

CREATE TABLE IF NOT EXISTS circle_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  position INTEGER,
  status TEXT DEFAULT 'waiting',
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  notified_at TEXT,
  expires_at TEXT,

  UNIQUE(circle_id, student_id),

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);


-- =========================================
-- التواصل
-- =========================================

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'private',
  title TEXT,
  created_by INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_read_at TEXT,

  UNIQUE(conversation_id, user_id),

  FOREIGN KEY (conversation_id)
    REFERENCES conversations(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT,
  message_type TEXT DEFAULT 'text',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  deleted_at TEXT,

  FOREIGN KEY (conversation_id)
    REFERENCES conversations(id)
    ON DELETE CASCADE,

  FOREIGN KEY (sender_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================================
-- الإدارة كمعلمة
-- =========================================

CREATE TABLE IF NOT EXISTS teacher_mode_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  enabled_by INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (enabled_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================================
-- الصلاحيات الأساسية
-- =========================================

INSERT OR IGNORE INTO permissions(code, name)
VALUES
('students.view', 'عرض الطلاب'),
('students.edit', 'تعديل الطلاب'),
('teachers.view', 'عرض المعلمين'),
('teachers.edit', 'تعديل المعلمين'),
('circles.view', 'عرض الحلقات'),
('circles.create', 'إنشاء الحلقات'),
('circles.edit', 'تعديل الحلقات'),
('circles.delete', 'حذف الحلقات'),
('attendance.view', 'عرض الحضور'),
('attendance.edit', 'تعديل الحضور'),
('quran.view', 'عرض القرآن'),
('quran.edit', 'تعديل القرآن'),
('finance.view', 'عرض المالية'),
('finance.edit', 'تعديل المالية'),
('messages.view', 'عرض الرسائل'),
('messages.send', 'إرسال الرسائل'),
('reports.view', 'عرض التقارير'),
('settings.edit', 'تعديل الإعدادات'),
('act_as_teacher', 'العمل كمعلمة');


CREATE INDEX IF NOT EXISTS idx_circle_waitlist
ON circle_waitlist(circle_id, position);

CREATE INDEX IF NOT EXISTS idx_conversation_participants
ON conversation_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id, created_at);
