-- =========================================================
-- 046_sponsorship_months_guard.sql
-- الأوَّابين
-- منع تجاوز الشهور المخصصة للمستفيد من الكفالة
-- =========================================================

CREATE TRIGGER IF NOT EXISTS trg_sponsorship_beneficiary_months_insert
BEFORE INSERT ON sponsorship_beneficiaries
FOR EACH ROW
WHEN
  NEW.allocated_months IS NOT NULL
  AND COALESCE(NEW.used_months, 0) > NEW.allocated_months
BEGIN
  SELECT RAISE(
    ABORT,
    'SPONSORSHIP_MONTHS_EXCEEDED'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_sponsorship_beneficiary_months_update
BEFORE UPDATE OF used_months, allocated_months
ON sponsorship_beneficiaries
FOR EACH ROW
WHEN
  NEW.allocated_months IS NOT NULL
  AND COALESCE(NEW.used_months, 0) > NEW.allocated_months
BEGIN
  SELECT RAISE(
    ABORT,
    'SPONSORSHIP_MONTHS_EXCEEDED'
  );
END;
