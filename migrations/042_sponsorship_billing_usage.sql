-- =========================================================
-- 042_sponsorship_billing_usage.sql
-- الأوَّابين
-- ربط استخدام الكفالة بالدورات المالية
-- =========================================================

CREATE TABLE IF NOT EXISTS sponsorship_billing_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  sponsorship_id INTEGER NOT NULL,
  sponsorship_allocation_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  billing_cycle_id INTEGER NOT NULL,

  amount REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (
      status IN (
        'applied',
        'cancelled',
        'refunded'
      )
    ),

  notes TEXT,

  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsorship_id)
    REFERENCES sponsorships(id)
    ON DELETE CASCADE,

  FOREIGN KEY (sponsorship_allocation_id)
    REFERENCES sponsorship_allocations(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS
idx_sponsorship_billing_usage_sponsorship
ON sponsorship_billing_usage(
  sponsorship_id,
  status
);

CREATE INDEX IF NOT EXISTS
idx_sponsorship_billing_usage_allocation
ON sponsorship_billing_usage(
  sponsorship_allocation_id,
  status
);

CREATE INDEX IF NOT EXISTS
idx_sponsorship_billing_usage_student
ON sponsorship_billing_usage(
  student_id,
  status
);

CREATE INDEX IF NOT EXISTS
idx_sponsorship_billing_usage_cycle
ON sponsorship_billing_usage(
  billing_cycle_id,
  status
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sponsorship_usage_active
ON sponsorship_billing_usage(
  sponsorship_allocation_id,
  billing_cycle_id
)
WHERE status = 'applied';
