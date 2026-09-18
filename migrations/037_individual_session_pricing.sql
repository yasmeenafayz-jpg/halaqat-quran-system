CREATE TABLE IF NOT EXISTS individual_session_offerings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (price >= 0),
  CHECK (duration_minutes >= 1)
);

CREATE INDEX IF NOT EXISTS idx_individual_session_offerings_status
ON individual_session_offerings(status);

CREATE TABLE IF NOT EXISTS individual_booking_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE,
  student_id INTEGER NOT NULL,
  offering_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'paid',
      'cancelled',
      'waived',
      'sponsored'
    )),
  payment_id INTEGER,
  due_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (booking_id)
    REFERENCES individual_schedule_bookings(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (offering_id)
    REFERENCES individual_session_offerings(id)
    ON DELETE SET NULL,

  FOREIGN KEY (payment_id)
    REFERENCES payments(id)
    ON DELETE SET NULL,

  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_individual_booking_charges_student_status
ON individual_booking_charges(student_id, status);

CREATE INDEX IF NOT EXISTS idx_individual_booking_charges_payment
ON individual_booking_charges(payment_id);

ALTER TABLE individual_schedule_requests
ADD COLUMN offering_id INTEGER;

ALTER TABLE individual_schedule_bookings
ADD COLUMN offering_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_individual_requests_offering
ON individual_schedule_requests(offering_id);

CREATE INDEX IF NOT EXISTS idx_individual_bookings_offering
ON individual_schedule_bookings(offering_id);

ALTER TABLE payments
ADD COLUMN individual_booking_charge_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_individual_booking_charge
ON payments(individual_booking_charge_id)
WHERE individual_booking_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_individual_booking_charge
ON payments(individual_booking_charge_id);
