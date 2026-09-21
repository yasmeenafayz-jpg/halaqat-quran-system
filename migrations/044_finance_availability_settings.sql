INSERT OR IGNORE INTO system_settings
(
  setting_key,
  setting_value,
  value_type,
  scope_type,
  scope_id,
  description,
  is_sensitive,
  is_editable
)
VALUES
(
  'academy.sponsorship_seats_open',
  '1',
  'boolean',
  'global',
  NULL,
  'إتاحة فتح أو إغلاق مقاعد الكفالة الجديدة.',
  0,
  1
),
(
  'academy.individual_booking_open',
  '1',
  'boolean',
  'global',
  NULL,
  'إتاحة فتح أو إغلاق الحجز للحصص الفردية الجديدة.',
  0,
  1
);
