-- =========================================================
-- 024) Motivation & Gamification Foundation
-- الأوَّابين — نظام التشجيع والتحفيز
-- =========================================================

-- ---------------------------------------------------------
-- 1) سجل أحداث النقاط
-- المصدر الحقيقي لرصيد الطالب
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_point_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  event_type TEXT NOT NULL,

  source_type TEXT,
  source_id INTEGER,

  points REAL NOT NULL,

  reason TEXT NOT NULL,

  idempotency_key TEXT NOT NULL UNIQUE,

  metadata_json TEXT,

  awarded_by INTEGER,

  awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (awarded_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (points != 0)
);

CREATE INDEX IF NOT EXISTS idx_student_point_events_student
ON student_point_events(student_id, awarded_at);

CREATE INDEX IF NOT EXISTS idx_student_point_events_source
ON student_point_events(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_student_point_events_type
ON student_point_events(event_type, awarded_at);


-- ---------------------------------------------------------
-- 2) مستويات التشجيع
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS motivation_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  code TEXT NOT NULL UNIQUE,

  name TEXT NOT NULL,

  description TEXT,

  min_points REAL NOT NULL DEFAULT 0,

  icon TEXT,

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (min_points >= 0)
);

CREATE INDEX IF NOT EXISTS idx_motivation_levels_points
ON motivation_levels(min_points);


-- ---------------------------------------------------------
-- 3) المسابقات والتحديات
-- تصميم عام يسمح بمسابقات فردية أو جماعية
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS motivation_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  code TEXT NOT NULL UNIQUE,

  title TEXT NOT NULL,

  description TEXT,

  challenge_type TEXT NOT NULL DEFAULT 'progress'
    CHECK (
      challenge_type IN (
        'progress',
        'attendance',
        'memorization',
        'review',
        'test',
        'wird',
        'buddy',
        'consistency',
        'custom'
      )
    ),

  scope_type TEXT NOT NULL DEFAULT 'academy'
    CHECK (
      scope_type IN (
        'academy',
        'circle',
        'individual'
      )
    ),

  circle_id INTEGER,

  start_date TEXT NOT NULL,

  end_date TEXT NOT NULL,

  target_value REAL,

  reward_points REAL NOT NULL DEFAULT 0,

  criteria_json TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'scheduled',
        'active',
        'completed',
        'cancelled'
      )
    ),

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (end_date >= start_date),

  CHECK (reward_points >= 0)
);

CREATE INDEX IF NOT EXISTS idx_motivation_challenges_dates
ON motivation_challenges(start_date, end_date, status);

CREATE INDEX IF NOT EXISTS idx_motivation_challenges_circle
ON motivation_challenges(circle_id, status);


-- ---------------------------------------------------------
-- 4) مشاركة الطلاب في التحديات
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS motivation_challenge_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  challenge_id INTEGER NOT NULL,

  student_id INTEGER NOT NULL,

  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  progress_value REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'completed',
        'withdrawn',
        'disqualified'
      )
    ),

  completed_at TEXT,

  final_rank INTEGER,

  reward_points REAL NOT NULL DEFAULT 0,

  metadata_json TEXT,

  UNIQUE(challenge_id, student_id),

  FOREIGN KEY (challenge_id)
    REFERENCES motivation_challenges(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  CHECK (progress_value >= 0),

  CHECK (reward_points >= 0),

  CHECK (
    final_rank IS NULL
    OR final_rank >= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_motivation_participants_student
ON motivation_challenge_participants(student_id, status);

CREATE INDEX IF NOT EXISTS idx_motivation_participants_challenge
ON motivation_challenge_participants(challenge_id, progress_value);


-- ---------------------------------------------------------
-- 5) الصلاحيات
-- Admin لديه bypass موجود أصلًا في نظام المصادقة.
-- ---------------------------------------------------------

INSERT OR IGNORE INTO role_permissions
  (role, permission, enabled)
VALUES
  ('supervisor', 'achievements.read', 1),
  ('supervisor', 'achievements.write', 1),
  ('supervisor', 'motivation.read', 1),
  ('supervisor', 'motivation.write', 1),

  ('teacher', 'achievements.read', 1),
  ('teacher', 'achievements.write', 1),
  ('teacher', 'motivation.read', 1),

  ('student', 'achievements.read', 1),
  ('student', 'motivation.read', 1),

  ('guardian', 'achievements.read', 1),
  ('guardian', 'motivation.read', 1);


-- ---------------------------------------------------------
-- 6) مستويات أولية عامة
-- لا ترتبط بأي طالب ولا تمنح نقاطًا.
-- يمكن تعديلها لاحقًا من الإعدادات/الإدارة.
-- ---------------------------------------------------------

INSERT OR IGNORE INTO motivation_levels
  (code, name, description, min_points, icon, sort_order)
VALUES
  ('beginner', 'البداية المباركة',
   'بداية رحلة الاستمرار والإنجاز.', 0, '🌱', 1),

  ('consistent', 'المواظب',
   'استمرار منتظم في طريق التعلم.', 100, '⭐', 2),

  ('active', 'المجتهد',
   'تقدم واضح ومشاركة منتظمة.', 250, '🌟', 3),

  ('excellent', 'المتميز',
   'مستوى متميز في الالتزام والتقدم.', 500, '🏆', 4),

  ('outstanding', 'المتألق',
   'إنجازات متقدمة واستمرارية قوية.', 1000, '👑', 5);


-- =========================================================
-- END 024
-- =========================================================
