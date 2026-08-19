PRAGMA foreign_keys = ON;

-- =========================================
-- 004 OPERATIONS
-- الأوَّابين - الاشتراكات والجدولة والمالية
-- =========================================

-- اشتراكات الطلاب
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  package_id INTEGER NOT NULL,
  circle_id INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'trial',
        'active',
        'expired',
        'paused',
        'cancelled'
      )
    ),
  trial_ends_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (package_id)
    REFERENCES packages(id)
    ON DELETE RESTRICT,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_student
ON subscriptions(student_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
ON subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_dates
ON subscriptions(start_date, end_date);


-- قواعد تسجيل الحلقات
CREATE TABLE IF NOT EXISTS enrollment_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER,
  circle_id INTEGER,
  rule_type TEXT NOT NULL,
  rule_value TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (package_id)
    REFERENCES packages(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enrollment_rules_package
ON enrollment_rules(package_id);

CREATE INDEX IF NOT EXISTS idx_enrollment_rules_circle
ON enrollment_rules(circle_id);


-- الاجتماعات التعريفية
CREATE TABLE IF NOT EXISTS introductory_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 20,
  meeting_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (
      status IN (
        'scheduled',
        'attended',
        'missed',
        'accepted',
        'rejected',
        'cancelled'
      )
    ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intro_meetings_date
ON introductory_meetings(scheduled_at);


-- جدول المواعيد المتكررة
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER,
  teacher_id INTEGER,
  weekday INTEGER NOT NULL
    CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_schedules_weekday
ON recurring_schedules(weekday);


-- سجل تغيير المواعيد
CREATE TABLE IF NOT EXISTS schedule_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  old_date TEXT,
  old_start_time TEXT,
  old_end_time TEXT,
  new_date TEXT,
  new_start_time TEXT,
  new_end_time TEXT,
  reason TEXT,
  changed_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE CASCADE,

  FOREIGN KEY (changed_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- المدفوعات
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  subscription_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  payment_method TEXT NOT NULL
    CHECK (
      payment_method IN (
        'cash',
        'bank_transfer',
        'mobile_wallet',
        'card',
        'online',
        'other'
      )
    ),
  transaction_reference TEXT,
  payer_phone TEXT,
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (
      status IN (
        'pending',
        'completed',
        'failed',
        'refunded'
      )
    ),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_student
ON payments(student_id);

CREATE INDEX IF NOT EXISTS idx_payments_date
ON payments(paid_at);


-- إعفاءات الدفع
CREATE TABLE IF NOT EXISTS payment_exemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  subscription_id INTEGER,
  amount REAL,
  reason TEXT,
  approved_by INTEGER,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'expired',
        'cancelled'
      )
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (subscription_id)
    REFERENCES subscriptions(id)
    ON DELETE SET NULL,

  FOREIGN KEY (approved_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- المصروفات
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  expense_date TEXT NOT NULL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date
ON expenses(expense_date);


-- رواتب ومستحقات المعلمات
CREATE TABLE IF NOT EXISTS teacher_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'approved',
        'paid',
        'cancelled'
      )
    ),
  paid_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (teacher_id)
    REFERENCES teachers(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_teacher_payments_teacher
ON teacher_payments(teacher_id);


-- غرامات الحلقات الجماعية
CREATE TABLE IF NOT EXISTS fines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,
  attendance_id INTEGER,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EGP',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'paid',
        'waived',
        'cancelled'
      )
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (attendance_id)
    REFERENCES attendance(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fines_student
ON fines(student_id);

CREATE INDEX IF NOT EXISTS idx_fines_circle
ON fines(circle_id);


-- قواعد الغرامات
CREATE TABLE IF NOT EXISTS fine_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER,
  absence_count INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE
);


-- التنبيهات
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  student_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'in_app'
    CHECK (
      channel IN (
        'in_app',
        'telegram',
        'whatsapp',
        'email'
      )
    ),
  scheduled_at TEXT,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'sent',
        'failed',
        'cancelled'
      )
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_status
ON notifications(status);

CREATE INDEX IF NOT EXISTS idx_notifications_scheduled
ON notifications(scheduled_at);


-- قوالب الرسائل
CREATE TABLE IF NOT EXISTS message_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- سجل الرسائل
CREATE TABLE IF NOT EXISTS message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  student_id INTEGER,
  template_id INTEGER,
  channel TEXT NOT NULL,
  recipient TEXT,
  message TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'sent',
        'delivered',
        'failed'
      )
    ),
  sent_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE SET NULL,

  FOREIGN KEY (template_id)
    REFERENCES message_templates(id)
    ON DELETE SET NULL
);


-- بيانات التكاملات
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  public_config TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- طلبات التسجيل في الحلقات
CREATE TABLE IF NOT EXISTS enrollment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  circle_id INTEGER NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'new'
    CHECK (
      request_type IN (
        'new',
        'transfer',
        'renewal'
      )
    ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'introductory',
        'accepted',
        'rejected',
        'cancelled'
      )
    ),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  decided_by INTEGER,
  notes TEXT,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (decided_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- النسخ الاحتياطية
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL,
  file_name TEXT,
  storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'completed',
        'failed'
      )
    ),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);


-- عمليات الاستيراد والتصدير
CREATE TABLE IF NOT EXISTS data_import_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type TEXT NOT NULL
    CHECK (
      operation_type IN (
        'import',
        'export'
      )
    ),
  entity_type TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'processing',
        'completed',
        'failed'
      )
    ),
  records_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

-- =========================================
-- نهاية 004
-- =========================================
