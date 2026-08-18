PRAGMA foreign_keys = ON;

-- =========================================================
-- 0005_final_features.sql
-- إضافات نظام الأوَّابين
-- =========================================================


-- =========================================================
-- 1) دور المشرفة وولي الأمر
-- =========================================================

INSERT OR IGNORE INTO roles (code, name)
VALUES ('supervisor', 'المشرفة');

INSERT OR IGNORE INTO roles (code, name)
VALUES ('guardian', 'ولي الأمر');


-- =========================================================
-- 2) أولياء الأمور
-- =========================================================

CREATE TABLE IF NOT EXISTS guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- =========================================================
-- 3) ربط ولي الأمر بالطلاب
-- =========================================================

CREATE TABLE IF NOT EXISTS guardian_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guardian_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  relationship TEXT DEFAULT 'ولي أمر',
  is_primary INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(guardian_id, student_id),

  FOREIGN KEY(guardian_id)
    REFERENCES guardians(id)
    ON DELETE CASCADE,

  FOREIGN KEY(student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);


-- =========================================================
-- 4) المشرفات
-- =========================================================

CREATE TABLE IF NOT EXISTS supervisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,

  FOREIGN KEY(user_id)
    REFERENCES users(id)
    ON DELETE
