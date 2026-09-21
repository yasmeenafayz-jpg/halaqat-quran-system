-- =========================================================
-- 045_sponsorship_payment_unique.sql
-- الأوَّابين
-- منع استخدام نفس عملية الدفع في أكثر من كفالة
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS
uq_sponsorship_payments_payment_id
ON sponsorship_payments(payment_id)
WHERE payment_id IS NOT NULL
  AND status != 'cancelled';
