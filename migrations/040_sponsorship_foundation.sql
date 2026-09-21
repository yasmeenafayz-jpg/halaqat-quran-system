/*
 * الأوَّابين
 * Sponsorship / Kafala Foundation
 *
 * الكفالة مصدر تمويل لاستحقاقات الطلاب،
 * وليست نظام فوترة مستقل.
 *
 * يمكن أن تغطي:
 * 1) طالبًا محددًا
 * 2) عددًا من المقاعد
 * 3) عددًا من الأشهر
 * 4) مستوى كاملًا
 */

CREATE TABLE IF NOT EXISTS sponsorships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sponsor_user_id INTEGER,

  sponsor_name TEXT NOT NULL,
  sponsor_phone TEXT,
  sponsor_email TEXT,

  title TEXT,
  notes TEXT,

  scope_type TEXT NOT NULL
    CHECK (
      scope_type IN (
        'student',
        'seats',
        'months',
        'level'
      )
    ),

  target_student_id INTEGER,
  target_level_id INTEGER,

  allocated_seats INTEGER,
  allocated_months INTEGER,

  total_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,

  currency TEXT NOT NULL DEFAULT 'EGP',

  start_date TEXT,
  end_date TEXT,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'pending',
        'active',
        'paused',
        'completed',
        'cancelled',
        'expired'
      )
    ),

  is_anonymous INTEGER NOT NULL DEFAULT 0
    CHECK (is_anonymous IN (0,1)),

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsor_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (target_student_id)
    REFERENCES students(id)
    ON DELETE SET NULL,

  FOREIGN KEY (target_level_id)
    REFERENCES quran_levels(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (total_amount >= 0),
  CHECK (remaining_amount >= 0),

  CHECK (
    allocated_seats IS NULL
    OR allocated_seats > 0
  ),

  CHECK (
    allocated_months IS NULL
    OR allocated_months > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_sponsorships_status
ON sponsorships(status);

CREATE INDEX IF NOT EXISTS idx_sponsorships_student
ON sponsorships(target_student_id);

CREATE INDEX IF NOT EXISTS idx_sponsorships_level
ON sponsorships(target_level_id);

CREATE INDEX IF NOT EXISTS idx_sponsorships_dates
ON sponsorships(start_date, end_date);


-- =========================================================
-- المستفيدون من الكفالة
-- =========================================================

CREATE TABLE IF NOT EXISTS sponsorship_beneficiaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sponsorship_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,

  allocated_months INTEGER,
  allocated_amount REAL NOT NULL DEFAULT 0,

  used_months INTEGER NOT NULL DEFAULT 0,
  used_amount REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'paused',
        'completed',
        'cancelled'
      )
    ),

  started_at TEXT,
  ended_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsorship_id)
    REFERENCES sponsorships(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  UNIQUE (
    sponsorship_id,
    student_id
  ),

  CHECK (
    allocated_months IS NULL
    OR allocated_months > 0
  ),

  CHECK (allocated_amount >= 0),
  CHECK (used_months >= 0),
  CHECK (used_amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_beneficiaries_student
ON sponsorship_beneficiaries(
  student_id,
  status
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_beneficiaries_sponsorship
ON sponsorship_beneficiaries(
  sponsorship_id,
  status
);


-- =========================================================
-- توزيع الكفالة على الاستحقاقات الفعلية
-- =========================================================
--
-- هذا الجدول يربط أموال الكفالة بالفاتورة الشهرية
-- الفعلية للطالب.
--

CREATE TABLE IF NOT EXISTS sponsorship_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sponsorship_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,

  subscription_id INTEGER,
  billing_cycle_id INTEGER,

  allocated_amount REAL NOT NULL DEFAULT 0,
  used_amount REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'allocated'
    CHECK (
      status IN (
        'allocated',
        'partially_used',
        'used',
        'cancelled'
      )
    ),

  notes TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsorship_id)
    REFERENCES sponsorships(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (allocated_amount >= 0),
  CHECK (used_amount >= 0),
  CHECK (used_amount <= allocated_amount)
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_allocations_sponsorship
ON sponsorship_allocations(
  sponsorship_id,
  status
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_allocations_student
ON sponsorship_allocations(
  student_id,
  status
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_allocations_subscription
ON sponsorship_allocations(subscription_id);

CREATE INDEX IF NOT EXISTS idx_sponsorship_allocations_billing_cycle
ON sponsorship_allocations(billing_cycle_id);


-- =========================================================
-- مدفوعات الكفالة
-- =========================================================
--
-- payments هو سجل الدفع المالي الحقيقي.
-- هذا الجدول يربط الدفع بالكفالة فقط.
--

CREATE TABLE IF NOT EXISTS sponsorship_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sponsorship_id INTEGER NOT NULL,
  payment_id INTEGER,

  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'completed',
        'cancelled',
        'refunded'
      )
    ),

  paid_at TEXT,

  notes TEXT,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsorship_id)
    REFERENCES sponsorships(id)
    ON DELETE CASCADE,

  FOREIGN KEY (payment_id)
    REFERENCES payments(id)
    ON DELETE SET NULL,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_payments_sponsorship
ON sponsorship_payments(
  sponsorship_id,
  status
);

CREATE INDEX IF NOT EXISTS idx_sponsorship_payments_payment
ON sponsorship_payments(payment_id);
