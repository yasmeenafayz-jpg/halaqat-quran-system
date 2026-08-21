PRAGMA foreign_keys = ON;

-- =========================================================
-- 009_professional_academy_foundation.sql
-- مشروع الأوَّابين
-- الأساس الموحد للخصائص الاحترافية
-- =========================================================

-- =========================================================
-- 1) إعدادات الأكاديمية
-- =========================================================

CREATE TABLE IF NOT EXISTS academy_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT,

  value_type TEXT NOT NULL DEFAULT 'text'
    CHECK (value_type IN ('text','number','boolean','json')),

  description TEXT,

  is_public INTEGER NOT NULL DEFAULT 0
    CHECK (is_public IN (0,1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_academy_settings_key
ON academy_settings(setting_key);


-- =========================================================
-- 2) الفترات الدراسية / الدورات
-- =========================================================

CREATE TABLE IF NOT EXISTS academic_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  name TEXT NOT NULL,

  term_type TEXT NOT NULL DEFAULT 'term'
    CHECK (
      term_type IN (
        'year',
        'term',
        'course',
        'summer',
        'ramadan',
        'custom'
      )
    ),

  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (
      status IN (
        'planned',
        'active',
        'closed',
        'archived'
      )
    ),

  notes TEXT,

  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_academic_terms_dates
ON academic_terms(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_academic_terms_status
ON academic_terms(status);


-- =========================================================
-- 3) مهام الإدارة والمعلمات
-- =========================================================

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,
  description TEXT,

  task_type TEXT NOT NULL DEFAULT 'general'
    CHECK (
      task_type IN (
        'general',
        'academic',
        'administrative',
        'financial',
        'follow_up',
        'technical'
      )
    ),

  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (
      priority IN (
        'low',
        'normal',
        'high',
        'urgent'
      )
    ),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'in_progress',
        'completed',
        'cancelled'
      )
    ),

  assigned_to INTEGER,
  created_by INTEGER,

  due_at TEXT,
  completed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (assigned_to)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned
ON tasks(assigned_to, status);

CREATE INDEX IF NOT EXISTS idx_tasks_due
ON tasks(due_at, status);


-- =========================================================
-- 4) الواجبات
-- =========================================================

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  title TEXT NOT NULL,
  description TEXT,

  subject_type TEXT NOT NULL DEFAULT 'quran'
    CHECK (
      subject_type IN (
        'quran',
        'noorani_qaida',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah',
        'other'
      )
    ),

  session_id INTEGER,
  teacher_id INTEGER,
  student_id INTEGER,
  circle_id INTEGER,

  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at TEXT,

  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (
      status IN (
        'assigned',
        'submitted',
        'reviewed',
        'late',
        'cancelled'
      )
    ),

  score REAL,
  teacher_feedback TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_assignments_student
ON assignments(student_id, status);

CREATE INDEX IF NOT EXISTS idx_assignments_teacher
ON assignments(teacher_id, status);

CREATE INDEX IF NOT EXISTS idx_assignments_due
ON assignments(due_at, status);


-- =========================================================
-- 5) بنك الأسئلة
-- =========================================================

CREATE TABLE IF NOT EXISTS question_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  subject_type TEXT NOT NULL DEFAULT 'quran'
    CHECK (
      subject_type IN (
        'quran',
        'tajweed',
        'tafsir',
        'fiqh',
        'hadith',
        'sirah',
        'noorani_qaida',
        'other'
      )
    ),

  question_type TEXT NOT NULL
    CHECK (
      question_type IN (
        'multiple_choice',
        'true_false',
        'short_answer',
        'essay',
        'oral',
        'memorization'
      )
    ),

  difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (
      difficulty IN (
        'easy',
        'medium',
        'hard'
      )
    ),

  question_text TEXT NOT NULL,

  options_json TEXT,
  correct_answer TEXT,
  explanation TEXT,

  surah_number INTEGER,
  ayah_start INTEGER,
  ayah_end INTEGER,

  level_id INTEGER,

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),

  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_question_bank_subject
ON question_bank(subject_type, difficulty);

CREATE INDEX IF NOT EXISTS idx_question_bank_quran
ON question_bank(surah_number, ayah_start, ayah_end);

CREATE INDEX IF NOT EXISTS idx_question_bank_level
ON question_bank(level_id);


-- =========================================================
-- 6) الإنجازات والشارات
-- =========================================================

CREATE TABLE IF NOT EXISTS achievement_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,

  achievement_type TEXT NOT NULL DEFAULT 'progress'
    CHECK (
      achievement_type IN (
        'progress',
        'attendance',
        'memorization',
        'review',
        'test',
        'behavior',
        'consistency',
        'custom'
      )
    ),

  criteria_json TEXT,

  icon TEXT,

  is_active INTEGER NOT NULL DEFAULT 1
    CHECK (is_active IN (0,1)),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS student_achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,
  achievement_id INTEGER NOT NULL,

  awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  awarded_by INTEGER,

  notes TEXT,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (achievement_id)
    REFERENCES achievement_definitions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (awarded_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  UNIQUE(student_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_student_achievements_student
ON student_achievements(student_id, awarded_at);


-- =========================================================
-- 7) الشهادات
-- =========================================================

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  certificate_number TEXT NOT NULL UNIQUE,

  student_id INTEGER NOT NULL,

  certificate_type TEXT NOT NULL
    CHECK (
      certificate_type IN (
        'surah',
        'juz',
        'level',
        'course',
        'program',
        'custom'
      )
    ),

  title TEXT NOT NULL,

  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  achievement_id INTEGER,

  verification_token TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (
      status IN (
        'valid',
        'revoked',
        'expired'
      )
    ),

  issued_by INTEGER,

  metadata_json TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (achievement_id)
    REFERENCES achievement_definitions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (issued_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_certificates_student
ON certificates(student_id);

CREATE INDEX IF NOT EXISTS idx_certificates_verify
ON certificates(verification_token);

CREATE INDEX IF NOT EXISTS idx_certificates_number
ON certificates(certificate_number);


-- =========================================================
-- 8) الموافقات الإلكترونية
-- =========================================================

CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER,

  student_id INTEGER,

  consent_type TEXT NOT NULL,

  document_version TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (
      status IN (
        'accepted',
        'rejected',
        'withdrawn'
      )
    ),

  accepted_at TEXT,

  ip_address TEXT,
  user_agent TEXT,

  metadata_json TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consent_user
ON consent_records(user_id, consent_type);

CREATE INDEX IF NOT EXISTS idx_consent_student
ON consent_records(student_id, consent_type);


-- =========================================================
-- 9) السلوك والحوادث
-- =========================================================

CREATE TABLE IF NOT EXISTS behavior_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,
  teacher_id INTEGER,

  incident_type TEXT NOT NULL
    CHECK (
      incident_type IN (
        'positive',
        'warning',
        'absence',
        'lateness',
        'behavior',
        'academic',
        'other'
      )
    ),

  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (
      severity IN (
        'low',
        'medium',
        'high',
        'critical'
      )
    ),

  title TEXT NOT NULL,
  description TEXT,

  action_taken TEXT,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (
      status IN (
        'open',
        'follow_up',
        'resolved',
        'dismissed'
      )
    ),

  incident_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_behavior_student
ON behavior_incidents(student_id, status);

CREATE INDEX IF NOT EXISTS idx_behavior_date
ON behavior_incidents(incident_at);


-- =========================================================
-- 10) إجازات المعلمات
-- =========================================================

CREATE TABLE IF NOT EXISTS teacher_leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  teacher_id INTEGER NOT NULL,

  leave_type TEXT NOT NULL DEFAULT 'personal'
    CHECK (
      leave_type IN (
        'annual',
        'sick',
        'personal',
        'emergency',
        'academic',
        'other'
      )
    ),

  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,

  reason TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'approved',
        'rejected',
        'cancelled'
      )
    ),

  reviewed_by INTEGER,
  reviewed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE,

  FOREIGN KEY (reviewed_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_teacher_leave_teacher
ON teacher_leave_requests(teacher_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_teacher_leave_status
ON teacher_leave_requests(status);


-- =========================================================
-- 11) ملفات ومستندات النظام
-- =========================================================

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  owner_user_id INTEGER,
  student_id INTEGER,
  teacher_id INTEGER,

  document_type TEXT NOT NULL DEFAULT 'other',

  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,

  mime_type TEXT,
  file_size INTEGER,

  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (
      visibility IN (
        'private',
        'admin',
        'teacher',
        'student',
        'guardian',
        'shared'
      )
    ),

  metadata_json TEXT,

  uploaded_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (owner_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE,

  FOREIGN KEY (uploaded_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_student
ON documents(student_id);

CREATE INDEX IF NOT EXISTS idx_documents_teacher
ON documents(teacher_id);

CREATE INDEX IF NOT EXISTS idx_documents_owner
ON documents(owner_user_id);


-- =========================================================
-- 12) موافقات الإجراءات الحساسة
-- =========================================================

CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  request_type TEXT NOT NULL,

  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,

  requested_by INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'approved',
        'rejected',
        'cancelled'
      )
    ),

  reason TEXT,

  reviewed_by INTEGER,
  reviewed_at TEXT,

  decision_notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (requested_by)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (reviewed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_status
ON approval_requests(status);

CREATE INDEX IF NOT EXISTS idx_approval_entity
ON approval_requests(entity_type, entity_id);


-- =========================================================
-- 13) الإجراءات التي تحتاج متابعة
-- =========================================================

CREATE TABLE IF NOT EXISTS action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  action_type TEXT NOT NULL,

  entity_type TEXT,
  entity_id INTEGER,

  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (
      priority IN (
        'low',
        'normal',
        'high',
        'urgent'
      )
    ),

  title TEXT NOT NULL,
  description TEXT,

  assigned_to INTEGER,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (
      status IN (
        'open',
        'in_progress',
        'completed',
        'dismissed'
      )
    ),

  due_at TEXT,
  completed_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (assigned_to)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_action_items_status
ON action_items(status, priority);

CREATE INDEX IF NOT EXISTS idx_action_items_entity
ON action_items(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_action_items_assigned
ON action_items(assigned_to, status);


-- =========================================================
-- 14) أرشفة منطقية مشتركة
-- =========================================================

CREATE TABLE IF NOT EXISTS deleted_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,

  deleted_by INTEGER,

  deletion_reason TEXT,

  snapshot_json TEXT,

  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  restored_at TEXT,
  restored_by INTEGER,

  FOREIGN KEY (deleted_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (restored_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_records_entity
ON deleted_records(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_deleted_records_deleted_at
ON deleted_records(deleted_at);


-- =========================================================
-- 15) سجل تغييرات احترافي موحد
-- =========================================================

CREATE TABLE IF NOT EXISTS entity_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,

  action TEXT NOT NULL
    CHECK (
      action IN (
        'create',
        'update',
        'delete',
        'restore',
        'approve',
        'reject',
        'status_change'
      )
    ),

  changed_by INTEGER,

  old_values_json TEXT,
  new_values_json TEXT,

  reason TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (changed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_change_entity
ON entity_change_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_change_user
ON entity_change_log(changed_by, created_at);

CREATE INDEX IF NOT EXISTS idx_entity_change_date
ON entity_change_log(created_at);


-- =========================================================
-- 16) إعدادات افتراضية أساسية
-- =========================================================

INSERT OR IGNORE INTO academy_settings
  (setting_key, setting_value, value_type, description)
VALUES
  (
    'default_timezone',
    'Africa/Cairo',
    'text',
    'المنطقة الزمنية الافتراضية للأكاديمية'
  ),
  (
    'default_currency',
    'EGP',
    'text',
    'العملة الافتراضية'
  ),
  (
    'enable_action_center',
    'true',
    'boolean',
    'تفعيل مركز يحتاج إجراء'
  ),
  (
    'enable_achievements',
    'true',
    'boolean',
    'تفعيل الإنجازات والشارات'
  ),
  (
    'enable_certificates',
    'true',
    'boolean',
    'تفعيل الشهادات'
  ),
  (
    'enable_assignments',
    'true',
    'boolean',
    'تفعيل الواجبات'
  ),
  (
    'enable_behavior_tracking',
    'true',
    'boolean',
    'تفعيل متابعة السلوك'
  ),
  (
    'enable_teacher_leave',
    'true',
    'boolean',
    'تفعيل طلبات إجازات المعلمات'
  );
