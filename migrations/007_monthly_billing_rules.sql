PRAGMA foreign_keys = ON;

-- =========================================================
-- الأوَّابين
-- 007_monthly_billing_rules.sql
-- قواعد الدورة المالية الشهرية الاحترافية
-- =========================================================

-- =========================================================
-- 1. إعدادات النظام المالية
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  billing_day INTEGER NOT NULL DEFAULT 1
    CHECK (billing_day BETWEEN 1 AND 28),

  default_due_day INTEGER NOT NULL DEFAULT 7
    CHECK (default_due_day BETWEEN 1 AND 28),

  currency TEXT NOT NULL DEFAULT 'EGP',

  count_scheduled_sessions INTEGER NOT NULL DEFAULT 1
    CHECK (count_scheduled_sessions IN (0, 1)),

  count_completed_sessions INTEGER NOT NULL DEFAULT 1
    CHECK (count_completed_sessions IN (0, 1)),

  count_cancelled_sessions INTEGER NOT NULL DEFAULT 0
    CHECK (count_cancelled_sessions IN (0, 1)),

  charge_cancelled_sessions INTEGER NOT NULL DEFAULT 0
    CHECK (charge_cancelled_sessions IN (0, 1)),

  create_cycle_automatically INTEGER NOT NULL DEFAULT 1
    CHECK (create_cycle_automatically IN (0, 1)),

  calculate_sessions_automatically INTEGER NOT NULL DEFAULT 1
    CHECK (calculate_sessions_automatically IN (0, 1)),

  issue_invoice_automatically INTEGER NOT NULL DEFAULT 1
    CHECK (issue_invoice_automatically IN (0, 1)),

  send_invoice_notification INTEGER NOT NULL DEFAULT 1
    CHECK (send_invoice_notification IN (0, 1)),

  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO billing_settings (
  id,
  billing_day,
  default_due_day,
  currency,
  count_scheduled_sessions,
  count_completed_sessions,
  count_cancelled_sessions,
  charge_cancelled_sessions,
  create_cycle_automatically,
  calculate_sessions_automatically,
  issue_invoice_automatically,
  send_invoice_notification,
  active
)
VALUES (
  1,
  1,
  7,
  'EGP',
  1,
  1,
  0,
  0,
  1,
  1,
  1,
  1,
  1
);

-- =========================================================
-- 2. إعدادات مالية خاصة بالطالب
-- =========================================================

CREATE TABLE IF NOT EXISTS student_billing_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL UNIQUE,

  billing_start_date TEXT,

  billing_day INTEGER NOT NULL DEFAULT 1
    CHECK (billing_day BETWEEN 1 AND 28),

  due_day INTEGER NOT NULL DEFAULT 7
    CHECK (due_day BETWEEN 1 AND 28),

  billing_mode TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_mode IN (
      'monthly',
      'per_session',
      'manual'
    )),

  count_from_new_month INTEGER NOT NULL DEFAULT 1
    CHECK (count_from_new_month IN (0, 1)),

  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),

  notes TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_billing_settings_student
ON student_billing_settings(student_id);

-- =========================================================
-- 3. تسجيل بداية المحاسبة للطالب
-- =========================================================

CREATE TABLE IF NOT EXISTS student_billing_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  student_id INTEGER NOT NULL,

  subscription_id INTEGER,

  billing_start_date TEXT NOT NULL,

  first_billing_month TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'active',
      'cancelled'
    )),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  CHECK (
    first_billing_month GLOB
    '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
  )
);

CREATE INDEX IF NOT EXISTS idx_student_billing_starts_student
ON student_billing_starts(student_id);

CREATE INDEX IF NOT EXISTS idx_student_billing_starts_month
ON student_billing_starts(first_billing_month);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student_billing_start
ON student_billing_starts(
  student_id,
  subscription_id
)
WHERE status = 'active';

-- =========================================================
-- 4. سجل عمليات دورة الفوترة
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_cycle_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  billing_month TEXT NOT NULL,

  run_type TEXT NOT NULL
    CHECK (run_type IN (
      'create_cycles',
      'calculate_sessions',
      'issue_invoices',
      'send_notifications',
      'close_cycles',
      'manual'
    )),

  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN (
      'started',
      'completed',
      'failed'
    )),

  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  completed_at TEXT,

  affected_students INTEGER NOT NULL DEFAULT 0,

  affected_cycles INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_cycle_runs_month
ON billing_cycle_runs(billing_month);

CREATE INDEX IF NOT EXISTS idx_billing_cycle_runs_status
ON billing_cycle_runs(status);

-- =========================================================
-- 5. ضمان عدم تكرار تشغيل نفس العملية لنفس الشهر
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_cycle_run_month_type
ON billing_cycle_runs(
  billing_month,
  run_type
);

-- =========================================================
-- 6. تحسين فهارس الدورة المالية
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_billing_cycles_student_month
ON billing_cycles(
  student_id,
  billing_month
);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_month_status
ON billing_cycles(
  billing_month,
  status
);

CREATE INDEX IF NOT EXISTS idx_billing_session_items_cycle_student
ON billing_session_items(
  billing_cycle_id,
  student_id
);

-- =========================================================
-- 7. سجل إشعارات الفواتير
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  billing_cycle_id INTEGER NOT NULL,

  recipient_user_id INTEGER,

  notification_type TEXT NOT NULL
    CHECK (notification_type IN (
      'invoice_issued',
      'payment_reminder',
      'payment_received',
      'overdue',
      'invoice_updated'
    )),

  channel TEXT NOT NULL
    CHECK (channel IN (
      'in_app',
      'telegram',
      'email',
      'sms'
    )),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'sent',
      'failed',
      'cancelled'
    )),

  message TEXT,

  sent_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (billing_cycle_id)
    REFERENCES billing_cycles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (recipient_user_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_notifications_cycle
ON billing_notifications(billing_cycle_id);

CREATE INDEX IF NOT EXISTS idx_billing_notifications_status
ON billing_notifications(status);

-- =========================================================
-- 8. View احترافية للدورة المالية الحالية
-- =========================================================

DROP VIEW IF EXISTS current_billing_cycles;

CREATE VIEW current_billing_cycles AS
SELECT
  bc.id,
  bc.student_id,
  bc.subscription_id,
  bc.billing_month,
  bc.period_start,
  bc.period_end,
  bc.currency,

  bc.planned_sessions,
  bc.scheduled_sessions,
  bc.completed_sessions,
  bc.cancelled_sessions,
  bc.chargeable_sessions,

  bc.package_amount,
  bc.session_amount,

  bc.discount_amount,
  bc.exemption_amount,
  bc.fine_amount,

  bc.total_amount,
  bc.paid_amount,
  bc.remaining_amount,

  bc.status,

  bc.issued_at,
  bc.due_at,
  bc.paid_at,

  bc.notes,

  bc.created_at,
  bc.updated_at

FROM billing_cycles bc
WHERE bc.billing_month =
      strftime('%Y-%m', 'now');

-- =========================================================
-- 9. View للجلسات المحتسبة في الشهر الحالي
-- =========================================================

DROP VIEW IF EXISTS current_billing_sessions;

CREATE VIEW current_billing_sessions AS
SELECT
  bsi.id,
  bsi.billing_cycle_id,
  bsi.session_id,
  bsi.student_id,
  bsi.session_date,
  bsi.chargeable,
  bsi.amount,
  bsi.reason,
  bsi.created_at

FROM billing_session_items bsi
WHERE bsi.session_date >=
      date('now', 'start of month')
  AND bsi.session_date <
      date('now', 'start of month', '+1 month');

-- =========================================================
-- 10. View للرصيد المالي الحالي
-- =========================================================

DROP VIEW IF EXISTS current_student_balances;

CREATE VIEW current_student_balances AS
SELECT
  bc.student_id,

  SUM(bc.total_amount) AS total_amount,

  SUM(bc.paid_amount) AS paid_amount,

  SUM(bc.remaining_amount) AS remaining_amount

FROM billing_cycles bc

WHERE bc.billing_month =
      strftime('%Y-%m', 'now')

GROUP BY
  bc.student_id;

-- =========================================================
-- 11. قواعد الشهر الجديد
-- =========================================================

CREATE TABLE IF NOT EXISTS billing_month_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  cycle_anchor TEXT NOT NULL DEFAULT 'first_day_of_month'
    CHECK (
      cycle_anchor IN (
        'first_day_of_month'
      )
    ),

  period_type TEXT NOT NULL DEFAULT 'calendar_month'
    CHECK (
      period_type IN (
        'calendar_month'
      )
    ),

  new_student_starts_next_month INTEGER NOT NULL DEFAULT 1
    CHECK (
      new_student_starts_next_month IN (0, 1)
    ),

  calculate_price_before_start INTEGER NOT NULL DEFAULT 0
    CHECK (
      calculate_price_before_start IN (0, 1)
    ),

  notify_student_before_cycle INTEGER NOT NULL DEFAULT 1
    CHECK (
      notify_student_before_cycle IN (0, 1)
    ),

  active INTEGER NOT NULL DEFAULT 1
    CHECK (
      active IN (0, 1)
    ),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO billing_month_rules (
  id,
  cycle_anchor,
  period_type,
  new_student_starts_next_month,
  calculate_price_before_start,
  notify_student_before_cycle,
  active
)
VALUES (
  1,
  'first_day_of_month',
  'calendar_month',
  1,
  0,
  1,
  1
);

-- =========================================================
-- نهاية Migration 007
-- =========================================================
