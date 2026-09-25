-- =========================================================
-- 053_individual_booking_entitlement_restore.sql
-- الأوَّابين
-- Protect individual booking entitlement restoration
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS
uq_entitlement_usage_individual_booking_restore
ON student_entitlement_usage (
  reference_type,
  reference_id
)
WHERE reference_type = 'individual_booking_restore'
  AND reference_id IS NOT NULL;
