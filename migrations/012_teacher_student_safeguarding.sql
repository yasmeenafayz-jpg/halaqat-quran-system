-- =========================================================
-- الأوَّابين — Teacher / Student Safeguarding Rules
-- Migration 012
-- =========================================================

CREATE TABLE IF NOT EXISTS academy_safeguarding_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO academy_safeguarding_rules
  (rule_key, enabled, description)
VALUES
  (
    'teacher_no_private_student_contact',
    1,
    'المعلم ممنوع من التواصل الخاص المباشر مع الطالب خارج قنوات الأكاديمية الرسمية.'
  ),
  (
    'teacher_no_student_off_platform_transfer',
    1,
    'المعلم ممنوع من نقل أو استقطاب الطالب خارج أكاديمية الأوَّابين.'
  ),
  (
    'teacher_no_student_contact_data',
    1,
    'لا يجوز للمعلم الوصول إلى هاتف أو بريد الطالب أو ولي أمره أو بيانات الاتصال الشخصية.'
  ),
  (
    'teacher_no_student_management',
    1,
    'لا يجوز للمعلم إنشاء أو تعديل ملف الطالب أو بيانات حسابه من واجهة إدارة الطلاب.'
  );
