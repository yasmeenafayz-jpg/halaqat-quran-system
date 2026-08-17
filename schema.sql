PRAGMA foreign_keys = ON;

-- =========================
-- الأدوار والصلاحيات
-- =========================

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

INSERT OR IGNORE INTO roles(code,name) VALUES
('admin','الإدارة'),
('teacher','المعلمة/المشرفة'),
('student','الطالب');


-- =========================
-- المستخدمون
-- =========================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  password_hash TEXT,
  telegram_chat_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(role_id) REFERENCES roles(id)
);


-- =========================
-- المعلمات
-- =========================

CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  notes TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- =========================
-- الطلاب
-- =========================

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  student_number TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  guardian_phone TEXT,
  teacher_id INTEGER,
  companion_name TEXT,
  current_level_id INTEGER,
  current_plan_type TEXT,
  current_portion TEXT,
  last_page REAL DEFAULT 1,
  exempt_from_payment INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
);


-- =========================
-- أنواع الجلسات
-- =========================

CREATE TABLE IF NOT EXISTS session_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO session_types(code,name) VALUES
('quran','القرآن الكريم'),
('noorani','القاعدة النورانية'),
('tafsir','التفسير'),
('fiqh','الفقه'),
('hadith','الحديث'),
('sirah','السيرة');


-- =========================
-- الحلقات
-- =========================

CREATE TABLE IF NOT EXISTS circles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('group','individual')),
  session_type_id INTEGER,
  teacher_id INTEGER,
  telegram_chat_id TEXT,
  meeting_link TEXT,
  meeting_provider TEXT,
  days TEXT,
  start_time TEXT,
  duration_minutes INTEGER DEFAULT 60,
  reminder_minutes INTEGER DEFAULT 30,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_type_id) REFERENCES session_types(id),
  FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
);


-- =========================
-- مستويات المسار
-- =========================

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- المراحل الأساسية الافتراضية
INSERT OR IGNORE INTO levels(name,sort_order,description) VALUES
('القاعدة / نور البيان + عم وتبارك',1,'مرحلة التأسيس وحفظ جزء عم وتبارك'),
('جزء قد سمع',2,'استكمال المسار بحسب مستوى الطالب'),
('سورة البقرة',3,'مسار حفظ سورة البقرة بحسب مستوى الطالب');


-- =========================
-- سجل انتقال الطالب بين المستويات
-- =========================

CREATE TABLE IF NOT EXISTS student_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(level_id) REFERENCES levels(id)
);


-- =========================
-- أعضاء الحلقات
-- =========================

CREATE TABLE IF NOT EXISTS circle_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(circle_id,student_id),
  FOREIGN KEY(circle_id) REFERENCES circles(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);


-- =========================
-- الجلسات
-- =========================

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  meeting_link TEXT,
  intro_meeting INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(circle_id) REFERENCES circles(id) ON DELETE CASCADE
);


-- =========================
-- الحضور والغياب
-- =========================

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('present','absent','excused','late')),
  note TEXT,
  recorded_by INTEGER,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id,student_id),
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(recorded_by) REFERENCES users(id) ON DELETE SET NULL
);


-- =========================
-- مقادير الورد
-- =========================

CREATE TABLE IF NOT EXISTS quran_portions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  page_fraction REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO quran_portions
(code,name,page_fraction) VALUES
('quarter_face','ربع وجه',0.25),
('half_face','نصف وجه',0.5),
('face','وجه',1),
('two_quarters','ربعين',0.5),
('hizb','حزب',10),
('juz','جزء',20);


-- =========================
-- سجلات القرآن والورد
-- =========================

CREATE TABLE IF NOT EXISTS quran_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,

  record_type TEXT NOT NULL
    CHECK(record_type IN
    ('new','review','new_review','mastery','cumulative')),

  surah_from INTEGER,
  ayah_from INTEGER,
  surah_to INTEGER,
  ayah_to INTEGER,

  page_from REAL,
  page_to REAL,

  portion_id INTEGER,

  record_date TEXT NOT NULL,

  completed INTEGER NOT NULL DEFAULT 1,

  score REAL,

  teacher_id INTEGER,

  notes TEXT,

  audio_url TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY(portion_id)
    REFERENCES quran_portions(id),

  FOREIGN KEY(teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL
);


-- =========================
-- الاختبارات
-- =========================

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  teacher_id INTEGER,

  type TEXT NOT NULL,

  test_date TEXT NOT NULL,

  score REAL NOT NULL DEFAULT 0,

  max_score REAL NOT NULL DEFAULT 100,

  errors_count INTEGER DEFAULT 0,

  position_note TEXT,

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY(teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL
);


-- =========================
-- باقات الاشتراك
-- =========================

CREATE TABLE IF NOT EXISTS subscription_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL UNIQUE,

  price REAL NOT NULL DEFAULT 0,

  currency TEXT NOT NULL DEFAULT 'EGP',

  monthly_sessions INTEGER,

  session_types TEXT,

  duration_days INTEGER NOT NULL DEFAULT 30,

  active INTEGER NOT NULL DEFAULT 1
);


-- =========================
-- اشتراكات الطلاب
-- =========================

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  plan_id INTEGER NOT NULL,

  starts_at TEXT NOT NULL,

  ends_at TEXT NOT NULL,

  amount REAL NOT NULL DEFAULT 0,

  discount REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active',

  notes TEXT,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY(plan_id)
    REFERENCES subscription_plans(id)
);


-- =========================
-- المعاملات المالية
-- =========================

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  subscription_id INTEGER,

  type TEXT NOT NULL,

  amount REAL NOT NULL DEFAULT 0,

  currency TEXT NOT NULL DEFAULT 'EGP',

  payment_method TEXT,

  transfer_number TEXT,

  reference_number TEXT,

  transaction_at TEXT NOT NULL,

  notes TEXT,

  recorded_by INTEGER,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY(subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  FOREIGN KEY(recorded_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================
-- الغرامات
-- مخصصة للحلقات الجماعية فقط
-- =========================

CREATE TABLE IF NOT EXISTS fines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  session_id INTEGER NOT NULL,

  amount REAL NOT NULL,

  reason TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY(session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE
);


-- =========================
-- اللقاءات والاجتماعات
-- =========================

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  circle_id INTEGER NOT NULL,

  meeting_at TEXT NOT NULL,

  duration_minutes INTEGER NOT NULL DEFAULT 60,

  reminder_minutes INTEGER NOT NULL DEFAULT 30,

  link TEXT,

  sent_at TEXT,

  status TEXT NOT NULL DEFAULT 'scheduled',

  FOREIGN KEY(circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE
);


-- =========================
-- الإشعارات
-- =========================

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER,

  channel TEXT NOT NULL,

  title TEXT,

  body TEXT NOT NULL,

  scheduled_at TEXT,

  sent_at TEXT,

  status TEXT NOT NULL DEFAULT 'pending',

  FOREIGN KEY(user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================
-- سجل إرسال الإشعارات
-- =========================

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  notification_id INTEGER,

  provider TEXT NOT NULL,

  external_id TEXT,

  status TEXT NOT NULL,

  response TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(notification_id)
    REFERENCES notifications(id)
    ON DELETE CASCADE
);


-- =========================
-- Telegram
-- =========================

CREATE TABLE IF NOT EXISTS telegram_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  circle_id INTEGER,

  chat_id TEXT NOT NULL UNIQUE,

  chat_name TEXT,

  active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL
);


-- =========================
-- التسجيلات الصوتية
-- =========================

CREATE TABLE IF NOT EXISTS audio_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER,

  circle_id INTEGER,

  quran_record_id INTEGER,

  file_url TEXT NOT NULL,

  duration_seconds INTEGER,

  status TEXT NOT NULL DEFAULT 'uploaded',

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE SET NULL,

  FOREIGN KEY(circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY(quran_record_id)
    REFERENCES quran_records(id)
    ON DELETE SET NULL
);


-- =========================
-- النسخ الاحتياطية
-- =========================

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  type TEXT NOT NULL,

  file_url TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  notes TEXT,

  FOREIGN KEY(created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================
-- إعدادات المنصة
-- =========================

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,

  value TEXT NOT NULL,

  is_secret INTEGER NOT NULL DEFAULT 0,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================
-- سجل النشاط والتعديلات
-- =========================

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER,

  action TEXT NOT NULL,

  entity_type TEXT,

  entity_id INTEGER,

  details TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(user_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================
-- فهارس لتحسين الأداء
-- =========================

CREATE INDEX IF NOT EXISTS idx_students_teacher
ON students(teacher_id);

CREATE INDEX IF NOT EXISTS idx_circle_members_circle
ON circle_members(circle_id);

CREATE INDEX IF NOT EXISTS idx_circle_members_student
ON circle_members(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_student
ON attendance(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_session
ON attendance(session_id);

CREATE INDEX IF NOT EXISTS idx_q
