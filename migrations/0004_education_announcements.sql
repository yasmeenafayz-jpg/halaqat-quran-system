PRAGMA foreign_keys = ON;

-- =========================================
-- المسار الدراسي للطالب
-- =========================================

ALTER TABLE students
ADD COLUMN education_track TEXT NOT NULL DEFAULT 'general';

ALTER TABLE students
ADD COLUMN gender TEXT;

ALTER TABLE students
ADD COLUMN birth_date TEXT;


-- =========================================
-- بيانات الطالب الأزهري
-- =========================================

CREATE TABLE IF NOT EXISTS azhari_student_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL UNIQUE,

  stage TEXT,
  grade TEXT,

  azhar_region TEXT,
  institute_name TEXT,

  academic_year TEXT,
  section TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);


CREATE INDEX IF NOT EXISTS idx_students_education_track
ON students(education_track);


-- =========================================
-- الإعلانات
-- =========================================

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,
  body TEXT NOT NULL,

  image_url TEXT,

  target_type TEXT NOT NULL DEFAULT 'all',
  target_id INTEGER,

  pinned INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'published',

  publish_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================================
-- قراءة الإعلانات
-- =========================================

CREATE TABLE IF NOT EXISTS announcement_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  announcement_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(announcement_id, user_id),

  FOREIGN KEY(announcement_id)
    REFERENCES announcements(id)
    ON DELETE CASCADE,

  FOREIGN KEY(user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =========================================
-- قناة Telegram للإعلانات
-- =========================================

CREATE TABLE IF NOT EXISTS telegram_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,
  username TEXT,

  chat_id TEXT NOT NULL UNIQUE,

  purpose TEXT NOT NULL DEFAULT 'announcements',

  active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- المنشورات المرسلة إلى Telegram
-- =========================================

CREATE TABLE IF NOT EXISTS telegram_announcement_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  announcement_id INTEGER NOT NULL,
  telegram_channel_id INTEGER NOT NULL,

  external_message_id TEXT,

  status TEXT NOT NULL DEFAULT 'pending',

  response TEXT,

  sent_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(
    announcement_id,
    telegram_channel_id
  ),

  FOREIGN KEY(announcement_id)
    REFERENCES announcements(id)
    ON DELETE CASCADE,

  FOREIGN KEY(telegram_channel_id)
    REFERENCES telegram_channels(id)
    ON DELETE CASCADE
);


-- =========================================
-- الفهارس
-- =========================================

CREATE INDEX IF NOT EXISTS idx_announcements_publish
ON announcements(
  status,
  publish_at,
  expires_at
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
ON announcement_reads(
  user_id,
  announcement_id
);
