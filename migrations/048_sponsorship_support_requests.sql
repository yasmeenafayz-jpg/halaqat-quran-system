CREATE TABLE IF NOT EXISTS sponsorship_support_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'educational_support'
    CHECK (request_type = 'educational_support'),
  requested_scope TEXT NOT NULL DEFAULT 'subscription'
    CHECK (requested_scope IN ('circle','subscription','level','other')),
  requested_amount REAL,
  requested_months INTEGER,
  reason TEXT NOT NULL,
  commitment_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (
      status IN (
        'pending_review',
        'needs_info',
        'approved',
        'partially_approved',
        'waiting_funding',
        'rejected',
        'closed'
      )
    ),
  approved_amount REAL,
  approved_months INTEGER,
  eligibility_review_until TEXT,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (requested_amount IS NULL OR requested_amount >= 0),
  CHECK (requested_months IS NULL OR requested_months > 0),
  CHECK (approved_amount IS NULL OR approved_amount >= 0),
  CHECK (approved_months IS NULL OR approved_months > 0)
);

CREATE INDEX IF NOT EXISTS idx_support_requests_student
ON sponsorship_support_requests(student_id);

CREATE INDEX IF NOT EXISTS idx_support_requests_status
ON sponsorship_support_requests(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_support_requests_active_student
ON sponsorship_support_requests(student_id)
WHERE status IN (
  'pending_review',
  'needs_info',
  'approved',
  'partially_approved',
  'waiting_funding'
);
