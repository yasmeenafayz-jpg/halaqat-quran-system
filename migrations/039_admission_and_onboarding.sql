/*
 * الأوَّابين
 * Admission / Onboarding Foundation
 *
 * طلب الالتحاق منفصل عن students.
 * لا يتم اعتماد المستوى أو الحلقة من الطالب مباشرة.
 */

CREATE TABLE IF NOT EXISTS admission_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  applicant_user_id INTEGER,
  student_id INTEGER,

  full_name TEXT NOT NULL,
  gender TEXT,
  birth_date TEXT,
  country TEXT,
  city TEXT,
  language TEXT,

  phone TEXT,
  email TEXT,

  enrollment_type TEXT NOT NULL DEFAULT 'path'
    CHECK (
      enrollment_type IN (
        'group',
        'individual',
        'single_session',
        'path'
      )
    ),

  referral_source TEXT,
  referral_source_other TEXT,

  quran_memorized_amount TEXT,
  memorized_surahs TEXT,
  last_memorized_position TEXT,
  revision_amount TEXT,

  learning_goal TEXT,
  learning_goal_other TEXT,

  reading_level TEXT,
  tajweed_level TEXT,
  mushaf_reading_ability TEXT,
  noor_al_bayan_history TEXT,
  recitation_notes TEXT,

  preferred_days TEXT,
  preferred_times TEXT,
  weekly_frequency INTEGER,
  preferred_learning_mode TEXT,

  previous_enrollment TEXT,
  previous_teacher TEXT,

  admission_test_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      admission_test_status IN (
        'pending',
        'scheduled',
        'completed',
        'not_required'
      )
    ),

  admission_test_result TEXT,

  proposed_level_id INTEGER,
  proposed_circle_id INTEGER,

  decision_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      decision_status IN (
        'pending',
        'under_review',
        'accepted',
        'rejected',
        'waitlisted',
        'cancelled'
      )
    ),

  decision_notes TEXT,
  decided_by INTEGER,
  decided_at TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'converted',
        'cancelled'
      )
    ),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (applicant_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE SET NULL,

  FOREIGN KEY (proposed_level_id)
    REFERENCES quran_levels(id)
    ON DELETE SET NULL,

  FOREIGN KEY (proposed_circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (decided_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admission_applications_status
ON admission_applications(decision_status, status);

CREATE INDEX IF NOT EXISTS idx_admission_applications_student
ON admission_applications(student_id);

CREATE INDEX IF NOT EXISTS idx_admission_applications_user
ON admission_applications(applicant_user_id);

CREATE INDEX IF NOT EXISTS idx_admission_applications_created
ON admission_applications(created_at);

CREATE TABLE IF NOT EXISTS admission_application_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,

  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  notes TEXT,

  actor_user_id INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (application_id)
    REFERENCES admission_applications(id)
    ON DELETE CASCADE,

  FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admission_events_application
ON admission_application_events(application_id, created_at);
