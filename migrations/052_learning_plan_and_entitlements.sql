PRAGMA foreign_keys = ON;

-- =========================================================
-- 1. STUDENT LEARNING PLANS
-- =========================================================

CREATE TABLE IF NOT EXISTS student_learning_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  path_id INTEGER,
  level_id INTEGER,

  title TEXT NOT NULL,
  goal TEXT,

  start_date TEXT NOT NULL,
  target_end_date TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'active',
        'paused',
        'completed',
        'cancelled'
      )
    ),

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS
  idx_student_learning_plans_student
ON student_learning_plans(student_id);

CREATE INDEX IF NOT EXISTS
  idx_student_learning_plans_status
ON student_learning_plans(status);

CREATE INDEX IF NOT EXISTS
  idx_student_learning_plans_path
ON student_learning_plans(path_id);

CREATE INDEX IF NOT EXISTS
  idx_student_learning_plans_level
ON student_learning_plans(level_id);


-- =========================================================
-- 2. LEARNING PLAN GOALS
-- =========================================================

CREATE TABLE IF NOT EXISTS student_learning_plan_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  plan_id INTEGER NOT NULL,

  goal_type TEXT NOT NULL
    CHECK (
      goal_type IN (
        'memorization',
        'review',
        'memorization_review',
        'tamkeen',
        'cumulative_recitation',
        'tajweed',
        'test',
        'attendance',
        'skill',
        'custom'
      )
    ),

  title TEXT NOT NULL,
  description TEXT,

  surah_number INTEGER,
  surah_name TEXT,

  from_ayah INTEGER,
  to_ayah INTEGER,

  target_value REAL,
  target_unit TEXT,

  due_date TEXT,

  progress_value REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'in_progress',
        'completed',
        'skipped',
        'cancelled'
      )
    ),

  notes TEXT,

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (plan_id)
    REFERENCES student_learning_plans(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (
    from_ayah IS NULL
    OR from_ayah > 0
  ),

  CHECK (
    to_ayah IS NULL
    OR to_ayah >= from_ayah
  )
);

CREATE INDEX IF NOT EXISTS
  idx_learning_plan_goals_plan
ON student_learning_plan_goals(plan_id);

CREATE INDEX IF NOT EXISTS
  idx_learning_plan_goals_status
ON student_learning_plan_goals(status);

CREATE INDEX IF NOT EXISTS
  idx_learning_plan_goals_due_date
ON student_learning_plan_goals(due_date);

CREATE INDEX IF NOT EXISTS
  idx_learning_plan_goals_surah
ON student_learning_plan_goals(surah_number);


-- =========================================================
-- 3. STUDENT ENTITLEMENTS
-- =========================================================
--
-- This table represents what the student is entitled to use.
-- It does NOT replace subscriptions, packages, sponsorships,
-- or individual bookings.
--
-- source_type:
--   subscription
--   individual_booking
--   sponsorship
--   manual
--
-- quantity = total available units
-- used_quantity = calculated/maintained usage counter
-- remaining quantity must never become negative.
-- =========================================================

CREATE TABLE IF NOT EXISTS student_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  source_type TEXT NOT NULL
    CHECK (
      source_type IN (
        'subscription',
        'individual_booking',
        'sponsorship',
        'manual'
      )
    ),

  source_id INTEGER,

  entitlement_type TEXT NOT NULL
    CHECK (
      entitlement_type IN (
        'session',
        'minute',
        'class',
        'level',
        'month',
        'custom'
      )
    ),

  title TEXT NOT NULL,

  quantity REAL NOT NULL DEFAULT 0,
  used_quantity REAL NOT NULL DEFAULT 0,

  duration_minutes INTEGER,

  valid_from TEXT,
  valid_until TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'pending',
        'active',
        'exhausted',
        'expired',
        'cancelled'
      )
    ),

  notes TEXT,

  created_by INTEGER,
  updated_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (updated_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (quantity >= 0),

  CHECK (used_quantity >= 0),

  CHECK (used_quantity <= quantity),

  CHECK (
    duration_minutes IS NULL
    OR duration_minutes > 0
  )
);

CREATE INDEX IF NOT EXISTS
  idx_student_entitlements_student
ON student_entitlements(student_id);

CREATE INDEX IF NOT EXISTS
  idx_student_entitlements_status
ON student_entitlements(status);

CREATE INDEX IF NOT EXISTS
  idx_student_entitlements_source
ON student_entitlements(source_type, source_id);

CREATE INDEX IF NOT EXISTS
  idx_student_entitlements_validity
ON student_entitlements(valid_from, valid_until);


-- =========================================================
-- 4. ENTITLEMENT USAGE LEDGER
-- =========================================================
--
-- Every actual consumption is recorded here.
-- This is the authoritative audit trail for usage.
-- =========================================================

CREATE TABLE IF NOT EXISTS student_entitlement_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  entitlement_id INTEGER NOT NULL,

  student_id INTEGER NOT NULL,

  usage_type TEXT NOT NULL
    CHECK (
      usage_type IN (
        'session',
        'minute',
        'class',
        'level',
        'month',
        'manual',
        'refund'
      )
    ),

  quantity REAL NOT NULL,

  reference_type TEXT,

  reference_id INTEGER,

  session_id INTEGER,
  booking_id INTEGER,

  notes TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (entitlement_id)
    REFERENCES student_entitlements(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_entitlement
ON student_entitlement_usage(entitlement_id);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_student
ON student_entitlement_usage(student_id);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_reference
ON student_entitlement_usage(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_session
ON student_entitlement_usage(session_id);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_booking
ON student_entitlement_usage(booking_id);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_created_at
ON student_entitlement_usage(created_at);


-- =========================================================
-- 5. UNIQUE USAGE GUARD
-- =========================================================
--
-- Prevent the same entitlement from being consumed twice
-- for the same concrete booking/session reference.
--
-- NULL values remain allowed for manual usage.
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_entitlement_usage_booking
ON student_entitlement_usage(
  entitlement_id,
  booking_id
)
WHERE booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_entitlement_usage_session
ON student_entitlement_usage(
  entitlement_id,
  session_id
)
WHERE session_id IS NOT NULL;


-- =========================================================
-- 6. PLAN / ENTITLEMENT LOOKUP INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS
  idx_learning_plan_student_status
ON student_learning_plans(
  student_id,
  status
);

CREATE INDEX IF NOT EXISTS
  idx_entitlements_student_active
ON student_entitlements(
  student_id,
  status,
  valid_until
);

CREATE INDEX IF NOT EXISTS
  idx_entitlement_usage_student_created
ON student_entitlement_usage(
  student_id,
  created_at
);
