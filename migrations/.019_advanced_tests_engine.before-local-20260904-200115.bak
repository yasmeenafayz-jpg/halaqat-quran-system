-- =========================================================
-- الأوَّابين
-- 019_advanced_tests_engine.sql
-- محرك الاختبارات المتقدم
-- =========================================================

-- قوالب الاختبارات
CREATE TABLE IF NOT EXISTS test_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,
  test_type TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'quran',

  description TEXT,

  question_count INTEGER NOT NULL DEFAULT 10
    CHECK (question_count > 0),

  duration_minutes INTEGER
    CHECK (
      duration_minutes IS NULL
      OR duration_minutes > 0
    ),

  passing_percentage REAL NOT NULL DEFAULT 70
    CHECK (
      passing_percentage >= 0
      AND passing_percentage <= 100
    ),

  configuration_json TEXT,

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),

  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

-- محاولات الاختبارات
CREATE TABLE IF NOT EXISTS test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,
  teacher_id INTEGER,
  session_id INTEGER,

  legacy_test_id INTEGER,

  template_id INTEGER,

  test_type TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'quran',

  title TEXT NOT NULL,

  source TEXT NOT NULL DEFAULT 'academy'
    CHECK (
      source IN (
        'academy',
        'smart',
        'manual',
        'external_supplement'
      )
    ),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'in_progress',
        'submitted',
        'graded',
        'cancelled'
      )
    ),

  attempt_number INTEGER NOT NULL DEFAULT 1
    CHECK (attempt_number > 0),

  previous_attempt_id INTEGER,

  generation_reason TEXT,
  generation_metadata_json TEXT,

  score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 100,
  percentage REAL NOT NULL DEFAULT 0,

  started_at TEXT,
  submitted_at TEXT,
  graded_at TEXT,

  graded_by INTEGER,

  teacher_note TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (legacy_test_id)
    REFERENCES tests(id)
    ON DELETE SET NULL,

  FOREIGN KEY (template_id)
    REFERENCES test_templates(id)
    ON DELETE SET NULL,

  FOREIGN KEY (previous_attempt_id)
    REFERENCES test_attempts(id)
    ON DELETE SET NULL,

  FOREIGN KEY (graded_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

-- أسئلة كل محاولة
CREATE TABLE IF NOT EXISTS test_attempt_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,

  question_order INTEGER NOT NULL
    CHECK (question_order > 0),

  points REAL NOT NULL DEFAULT 1
    CHECK (points >= 0),

  generated_reason TEXT,

  progress_reference_id INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (attempt_id)
    REFERENCES test_attempts(id)
    ON DELETE CASCADE,

  FOREIGN KEY (question_id)
    REFERENCES question_bank(id)
    ON DELETE RESTRICT,

  FOREIGN KEY (progress_reference_id)
    REFERENCES quran_progress(id)
    ON DELETE SET NULL,

  UNIQUE (attempt_id, question_order),
  UNIQUE (attempt_id, question_id)
);

-- إجابات الطالب
CREATE TABLE IF NOT EXISTS test_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attempt_question_id INTEGER NOT NULL,

  answer_text TEXT,
  selected_option TEXT,

  is_correct INTEGER,
  score REAL NOT NULL DEFAULT 0,

  feedback TEXT,

  graded_by INTEGER,
  answered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  graded_at TEXT,

  FOREIGN KEY (attempt_question_id)
    REFERENCES test_attempt_questions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (graded_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  UNIQUE (attempt_question_id)
);

-- أخطاء الطالب
CREATE TABLE IF NOT EXISTS test_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attempt_question_id INTEGER NOT NULL,

  error_category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (
      severity IN (
        'low',
        'medium',
        'high',
        'critical'
      )
    ),

  surah_number INTEGER,
  ayah_number INTEGER,

  word_reference TEXT,
  letter_reference TEXT,
  harakah_reference TEXT,

  expected_text TEXT,
  actual_text TEXT,

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (attempt_question_id)
    REFERENCES test_attempt_questions(id)
    ON DELETE CASCADE,

  CHECK (
    surah_number IS NULL
    OR (
      surah_number >= 1
      AND surah_number <= 114
    )
  ),

  CHECK (
    ayah_number IS NULL
    OR ayah_number > 0
  )
);

-- درجات معايير التقييم
CREATE TABLE IF NOT EXISTS test_rubric_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  attempt_id INTEGER NOT NULL,

  criterion TEXT NOT NULL,

  score REAL NOT NULL DEFAULT 0
    CHECK (score >= 0),

  max_score REAL NOT NULL DEFAULT 100
    CHECK (max_score > 0),

  percentage REAL NOT NULL DEFAULT 0
    CHECK (
      percentage >= 0
      AND percentage <= 100
    ),

  notes TEXT,

  graded_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (attempt_id)
    REFERENCES test_attempts(id)
    ON DELETE CASCADE,

  FOREIGN KEY (graded_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  UNIQUE (attempt_id, criterion)
);

-- مؤشرات الأداء والاستعلامات الذكية
CREATE INDEX IF NOT EXISTS idx_test_templates_type
ON test_templates(test_type, subject_type, is_active);

CREATE INDEX IF NOT EXISTS idx_test_attempts_student
ON test_attempts(student_id, created_at);

CREATE INDEX IF NOT EXISTS idx_test_attempts_teacher
ON test_attempts(teacher_id, created_at);

CREATE INDEX IF NOT EXISTS idx_test_attempts_status
ON test_attempts(status);

CREATE INDEX IF NOT EXISTS idx_test_attempts_type
ON test_attempts(test_type, subject_type);

CREATE INDEX IF NOT EXISTS idx_test_attempts_previous
ON test_attempts(previous_attempt_id);

CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt
ON test_attempt_questions(attempt_id, question_order);

CREATE INDEX IF NOT EXISTS idx_attempt_questions_question
ON test_attempt_questions(question_id);

CREATE INDEX IF NOT EXISTS idx_attempt_questions_progress
ON test_attempt_questions(progress_reference_id);

CREATE INDEX IF NOT EXISTS idx_test_answers_question
ON test_answers(attempt_question_id);

CREATE INDEX IF NOT EXISTS idx_test_errors_attempt_question
ON test_errors(attempt_question_id);

CREATE INDEX IF NOT EXISTS idx_test_errors_category
ON test_errors(error_category, severity);

CREATE INDEX IF NOT EXISTS idx_test_errors_quran_location
ON test_errors(surah_number, ayah_number);

CREATE INDEX IF NOT EXISTS idx_test_rubric_attempt
ON test_rubric_scores(attempt_id, criterion);
