PRAGMA foreign_keys = ON;

-- =========================================================
-- الأوَّابين
-- 006_professional_scheduling_and_billing.sql
-- المواعيد الفردية + الطلبات + الحجوزات + المالية الشهرية
-- =========================================================


-- =========================================================
-- 1. أوقات المعلمة المتاحة
-- =========================================================

CREATE TABLE IF NOT EXISTS teacher_availability_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  teacher_id INTEGER NOT NULL,

  weekday INTEGER NOT NULL
    CHECK (weekday BETWEEN 0 AND 6),

  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,

  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',

  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN (
      'available',
      'blocked',
      'inactive'
    )),

  valid_from TEXT,
  valid_until TEXT,

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE,

  CHECK (start_time < end_time),

  CHECK (
    valid_from IS NULL
    OR valid_until IS NULL
    OR valid_from <= valid_until
  )
);

CREATE INDEX IF NOT EXISTS idx_teacher_availability_teacher
ON teacher_availability_slots(teacher_id);

CREATE INDEX IF NOT EXISTS idx_teacher_availability_weekday
ON teacher_availability_slots(weekday);

CREATE INDEX IF NOT EXISTS idx_teacher_availability_status
ON teacher_availability_slots(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_availability_slot
ON teacher_availability_slots(
  teacher_id,
  weekday,
  start_time,
  end_time
);


-- =========================================================
-- 2. طلبات المواعيد الفردية
-- =========================================================

CREATE TABLE IF NOT EXISTS individual_schedule_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,

  availability_slot_id INTEGER,

  circle_id INTEGER,
  subscription_id INTEGER,

  requested_date TEXT NOT NULL,
  requested_start_time TEXT NOT NULL,
  requested_end_time TEXT NOT NULL,

  requested_by INTEGER,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'accepted',
      'rejected',
      'cancelled',
      'expired'
    )),

  teacher_response_note TEXT,
  student_note TEXT,

  decided_at TEXT,
  decided_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE,

  FOREIGN KEY (availability_slot_id)
    REFERENCES teacher_availability_slots(id)
    ON DELETE SET NULL,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (requested_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (decided_by)
    REFERENCES users(id)
    ON DELETE SET NULL,

  CHECK (requested_start_time < requested_end_time)
);

CREATE INDEX IF NOT EXISTS idx_individual_requests_student
ON individual_schedule_requests(student_id);

CREATE INDEX IF NOT EXISTS idx_individual_requests_teacher
ON individual_schedule_requests(teacher_id);

CREATE INDEX IF NOT EXISTS idx_individual_requests_date
ON individual_schedule_requests(requested_date);

CREATE INDEX IF NOT EXISTS idx_individual_requests_status
ON individual_schedule_requests(status);


-- =========================================================
-- 3. منع تكرار طلب معلق لنفس الموعد
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_individual_request
ON individual_schedule_requests(
  teacher_id,
  requested_date,
  requested_start_time,
  requested_end_time
)
WHERE status = 'pending';


-- =========================================================
-- 4. الحجوزات الفردية المؤكدة
-- =========================================================

CREATE TABLE IF NOT EXISTS individual_schedule_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  request_id INTEGER NOT NULL UNIQUE,

  student_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,

  circle_id INTEGER,
  subscription_id INTEGER,

  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,

  session_id INTEGER,

  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN (
      'confirmed',
      'completed',
      'cancelled',
      'rescheduled'
    )),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (request_id)
    REFERENCES individual_schedule_requests(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL,

  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_individual_bookings_teacher_date
ON individual_schedule_bookings(
  teacher_id,
  booking_date
);

CREATE INDEX IF NOT EXISTS idx_individual_bookings_student_date
ON individual_schedule_bookings(
  student_id,
  booking_date
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_individual_booking
ON individual_schedule_bookings(
  teacher_id,
  booking_date,
  start_time,
  end_time
)
WHERE status IN ('confirmed', 'completed');


-- =========================================================
-- 5. الدورة المالية الشهرية
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,
  subscription_id INTEGER,

  billing_month TEXT NOT NULL,

  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,

  currency TEXT NOT NULL DEFAULT 'EGP',

  planned_sessions INTEGER NOT NULL DEFAULT 0,
  scheduled_sessions INTEGER NOT NULL DEFAULT 0,
  completed_sessions INTEGER NOT NULL DEFAULT 0,
  cancelled_sessions INTEGER NOT NULL DEFAULT 0,
  chargeable_sessions INTEGER NOT NULL DEFAULT 0,

  package_amount REAL NOT NULL DEFAULT 0,
  session_amount REAL NOT NULL DEFAULT 0,

  discount_amount REAL NOT NULL DEFAULT 0,
  exemption_amount REAL NOT NULL DEFAULT 0,
  fine_amount REAL NOT NULL DEFAULT 0,

  total_amount REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open',
      'issued',
      'partially_paid',
      'paid',
      'overdue',
      'cancelled'
    )),

  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  CHECK (billing_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),

  CHECK (period_start <= period_end),

  CHECK (planned_sessions >= 0),
  CHECK (scheduled_sessions >= 0),
  CHECK (completed_sessions >= 0),
  CHECK (cancelled_sessions >= 0),
  CHECK (chargeable_sessions >= 0),

  CHECK (package_amount >= 0),
  CHECK (session_amount >= 0),
  CHECK (discount_amount >= 0),
  CHECK (exemption_amount >= 0),
  CHECK (fine_amount >= 0),
  CHECK (total_amount >= 0),
  CHECK (paid_amount >= 0),
  CHECK (remaining_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_cycle_student_subscription_month
ON billing_cycles(
  student_id,
  subscription_id,
  billing_month
);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_student
ON billing_cycles(student_id);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_subscription
ON billing_cycles(subscription_id);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_month
ON billing_cycles(billing_month);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_status
ON billing_cycles(status);


-- =========================================================
-- 6. بنود الفاتورة الشهرية
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_cycle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  billing_cycle_id INTEGER NOT NULL,

  item_type TEXT NOT NULL
    CHECK (item_type IN (
      'package',
      'session',
      'discount',
      'exemption',
      'fine',
      'adjustment'
    )),

  description TEXT NOT NULL,

  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,

  reference_type TEXT,
  reference_id INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE CASCADE,

  CHECK (quantity >= 0),
  CHECK (unit_price >= 0),
  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_billing_items_cycle
ON billing_cycle_items(billing_cycle_id);


-- =========================================================
-- 7. توزيع المدفوعات على الدورة الشهرية
-- =========================================================

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  payment_id INTEGER NOT NULL,
  billing_cycle_id INTEGER NOT NULL,

  amount REAL NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (payment_id)
    REFERENCES payments(id)
    ON DELETE CASCADE,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE CASCADE,

  CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_cycle
ON payment_allocations(
  payment_id,
  billing_cycle_id
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_cycle
ON payment_allocations(billing_cycle_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment
ON payment_allocations(payment_id);


-- =========================================================
-- 8. الجلسات الداخلة في الحساب الشهري
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_session_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  billing_cycle_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,

  session_date TEXT NOT NULL,

  chargeable INTEGER NOT NULL DEFAULT 1
    CHECK (chargeable IN (0, 1)),

  amount REAL NOT NULL DEFAULT 0,

  reason TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  UNIQUE(
    billing_cycle_id,
    session_id,
    student_id
  ),

  CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_billing_sessions_cycle
ON billing_session_items(billing_cycle_id);

CREATE INDEX IF NOT EXISTS idx_billing_sessions_student
ON billing_session_items(student_id);

CREATE INDEX IF NOT EXISTS idx_billing_sessions_date
ON billing_session_items(session_date);


-- =========================================================
-- 9. فهارس الأداء
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_student_circle_status
ON subscriptions(
  student_id,
  circle_id,
  status
);

CREATE INDEX IF NOT EXISTS idx_circles_individual_teacher
ON circles(
  teacher_id,
  circle_type,
  status
);


-- =========================================================
-- نهاية Migration 006
-- =========================================================
