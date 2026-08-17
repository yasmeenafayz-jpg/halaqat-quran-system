-- =========================================================
-- الأوَّابين - نظام المواعيد والتقويم والتنبيهات
-- Migration 002
-- =========================================================

PRAGMA foreign_keys = ON;

-- =========================================================
-- Calendar Schedules
-- =========================================================

CREATE TABLE IF NOT EXISTS calendar_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  circle_id INTEGER NOT NULL,

  title TEXT NOT NULL,

  recurrence_type TEXT NOT NULL
    CHECK (
      recurrence_type IN (
        'once',
        'daily',
        'weekly',
        'monthly',
        'yearly'
      )
    ),

  start_date TEXT NOT NULL,
  end_date TEXT,

  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,

  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',

  -- للأسبوعي: 0 الأحد ... 6 السبت
  weekdays TEXT,

  -- لليومي/الأسبوعي/الشهري/السنوي
  recurrence_interval INTEGER NOT NULL DEFAULT 1,

  -- يوم الشهر عند التكرار الشهري
  day_of_month INTEGER,

  -- الشهر عند التكرار السنوي
  month_of_year INTEGER,

  meeting_link TEXT,
  meeting_provider TEXT,

  notes TEXT,

  active INTEGER NOT NULL DEFAULT 1,

  created_by INTEGER,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
);

-- =========================================================
-- Calendar Events
-- مواعيد فعلية مولدة من الجدول المتكرر
-- =========================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  schedule_id INTEGER NOT NULL,

  circle_id INTEGER NOT NULL,

  session_id INTEGER,

  event_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,

  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',

  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (
      status IN (
        'scheduled',
        'completed',
        'cancelled',
        'rescheduled'
      )
    ),

  meeting_link TEXT,
  meeting_provider TEXT,

  teacher_notified INTEGER NOT NULL DEFAULT 0,
  students_notified INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(schedule_id, event_date, start_time),

  FOREIGN KEY (schedule_id)
    REFERENCES calendar_schedules(id)
    ON DELETE CASCADE,

  FOREIGN KEY (circle_id)
    REFERENCES circles(id)
    ON DELETE CASCADE,

  FOREIGN KEY (session_id)
    REFERENCES sessions(id)
    ON DELETE SET NULL
);

-- =========================================================
-- Calendar Reminders
-- =========================================================

CREATE TABLE IF NOT EXISTS calendar_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  schedule_id INTEGER,

  event_id INTEGER,

  user_id INTEGER,

  minutes_before INTEGER NOT NULL DEFAULT 30,

  channel TEXT NOT NULL
    CHECK (
      channel IN (
        'in_app',
        'push',
        'telegram',
        'email',
        'calendar'
      )
    ),

  enabled INTEGER NOT NULL DEFAULT 1,

  sent_at TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (schedule_id)
    REFERENCES calendar_schedules(id)
    ON DELETE CASCADE,

  FOREIGN KEY (event_id)
    REFERENCES calendar_events(id)
    ON DELETE CASCADE,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

-- =========================================================
-- Calendar Subscriptions
-- ربط المستخدم بتقويمه
-- =========================================================

CREATE TABLE IF NOT EXISTS calendar_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER NOT NULL,

  provider TEXT NOT NULL
    CHECK (
      provider IN (
        'google',
        'apple',
        'outlook',
        'device',
        'ics'
      )
    ),

  calendar_name TEXT,

  external_calendar_id TEXT,

  subscription_url TEXT,

  active INTEGER NOT NULL DEFAULT 1,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE
);

-- =========================================================
-- Notification Log
-- سجل جميع التنبيهات
-- =========================================================

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id INTEGER,

  event_id INTEGER,

  notification_type TEXT NOT NULL,

  channel TEXT NOT NULL,

  title TEXT,

  message TEXT,

  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (
      status IN (
        'pending',
        'sent',
        'failed',
        'cancelled'
      )
    ),

  error_message TEXT,

  FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE SET NULL,

  FOREIGN KEY (event_id)
    REFERENCES calendar_events(id)
    ON DELETE SET NULL
);

-- =========================================================
-- Indexes
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_calendar_schedules_circle
ON calendar_schedules(circle_id);

CREATE INDEX IF NOT EXISTS idx_calendar_schedules_dates
ON calendar_schedules(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date
ON calendar_events(event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_circle
ON calendar_events(circle_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_status
ON calendar_events(status);

CREATE INDEX IF NOT EXISTS idx_calendar_reminders_event
ON calendar_reminders(event_id);

CREATE INDEX IF NOT EXISTS idx_calendar_reminders_user
ON calendar_reminders(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_log_user
ON notification_log(user_id);

CREATE INDEX IF NOT EXISTS idx_notification_log_event
ON notification_log(event_id);
