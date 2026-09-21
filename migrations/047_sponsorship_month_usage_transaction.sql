-- =========================================================
-- 047_sponsorship_month_usage_transaction.sql
-- الأوَّابين
-- حجز شهر الكفالة داخل نفس transaction الخاصة بتسجيل الاستخدام
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_sponsorship_usage_month_guard
BEFORE INSERT ON sponsorship_billing_usage
FOR EACH ROW
WHEN
  NEW.status = 'applied'
  AND EXISTS (
    SELECT 1
    FROM sponsorships s
    WHERE s.id = NEW.sponsorship_id
      AND LOWER(COALESCE(s.scope_type, '')) = 'months'
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'SPONSORSHIP_MONTHS_EXHAUSTED'
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM sponsorship_beneficiaries sb
    WHERE sb.sponsorship_id = NEW.sponsorship_id
      AND sb.student_id = NEW.student_id
      AND sb.status = 'active'
      AND (
        sb.allocated_months IS NULL
        OR COALESCE(sb.used_months, 0) < sb.allocated_months
      )
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_sponsorship_usage_month_reserve
AFTER INSERT ON sponsorship_billing_usage
FOR EACH ROW
WHEN
  NEW.status = 'applied'
  AND EXISTS (
    SELECT 1
    FROM sponsorships s
    WHERE s.id = NEW.sponsorship_id
      AND LOWER(COALESCE(s.scope_type, '')) = 'months'
  )
BEGIN
  UPDATE sponsorship_beneficiaries
  SET
    used_months = COALESCE(used_months, 0) + 1,
    updated_at = CURRENT_TIMESTAMP
  WHERE sponsorship_id = NEW.sponsorship_id
    AND student_id = NEW.student_id
    AND status = 'active'
    AND (
      allocated_months IS NULL
      OR COALESCE(used_months, 0) < allocated_months
    );
END;
