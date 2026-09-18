PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS motivation_challenge_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  idempotency_key TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (challenge_id)
    REFERENCES motivation_challenges(id)
    ON DELETE CASCADE,

  FOREIGN KEY (student_id)
    REFERENCES students(id)
    ON DELETE CASCADE,

  CHECK (value > 0),

  UNIQUE(challenge_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_motivation_challenge_events_student
ON motivation_challenge_events(student_id, created_at);

CREATE INDEX IF NOT EXISTS idx_motivation_challenge_events_challenge
ON motivation_challenge_events(challenge_id, created_at);

CREATE INDEX IF NOT EXISTS idx_motivation_challenge_events_source
ON motivation_challenge_events(source_type, source_id);

INSERT OR IGNORE INTO achievement_definitions
  (code, name, description, achievement_type, criteria_json, icon, is_active)
VALUES
(
  'first_attendance',
  'أول خطوة',
  'أول حضور فعلي لجلسة تعليمية.',
  'attendance',
  '{"event_type":"attendance","event_count":1}',
  '🌱',
  1
),
(
  'attendance_7',
  'خطوات ثابتة',
  'إكمال 7 مرات حضور.',
  'attendance',
  '{"event_type":"attendance","event_count":7}',
  '⭐',
  1
),
(
  'wird_7',
  'رفيقة الورد',
  'إكمال الورد اليومي 7 مرات.',
  'consistency',
  '{"event_type":"wird_completion","event_count":7}',
  '📖',
  1
),
(
  'buddy_7',
  'صحبة على الطاعة',
  'إكمال 7 متابعات ناجحة مع الرفيقة.',
  'behavior',
  '{"event_type":"buddy_followup","event_count":7}',
  '🤝',
  1
),
(
  'quran_progress_10',
  'خطوات في القرآن',
  'إكمال 10 أنشطة موثقة في تقدم القرآن.',
  'progress',
  '{"quran_progress_count":10}',
  '🌿',
  1
),
(
  'test_5',
  'طالبة مجتهدة',
  'إكمال 5 اختبارات.',
  'test',
  '{"event_type":"test","event_count":5}',
  '🏆',
  1
);
