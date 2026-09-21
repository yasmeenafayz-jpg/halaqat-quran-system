-- Atomic guard for sponsorship billing application.
-- The billing cycle and allocation are updated before the usage row
-- is inserted in the same D1 batch. If either update did not produce
-- the expected state, abort the INSERT so the entire batch is rolled back.

CREATE TRIGGER IF NOT EXISTS trg_sponsorship_billing_atomic_guard
BEFORE INSERT ON sponsorship_billing_usage
FOR EACH ROW
WHEN NEW.status = 'applied'
BEGIN

  SELECT RAISE(
    ABORT,
    'SPONSORSHIP_BILLING_STATE_MISMATCH'
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM billing_cycles bc
    WHERE bc.id = NEW.billing_cycle_id
      AND bc.student_id = NEW.student_id
      AND bc.status <> 'cancelled'
      AND ABS(
        COALESCE(bc.sponsored_amount, 0)
        -
        (
          COALESCE(
            (
              SELECT SUM(u.amount)
              FROM sponsorship_billing_usage u
              WHERE u.billing_cycle_id = NEW.billing_cycle_id
                AND u.status = 'applied'
            ),
            0
          )
          + NEW.amount
        )
      ) <= 0.01
  );

  SELECT RAISE(
    ABORT,
    'SPONSORSHIP_ALLOCATION_STATE_MISMATCH'
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM sponsorship_allocations sa
    WHERE sa.id = NEW.sponsorship_allocation_id
      AND sa.sponsorship_id = NEW.sponsorship_id
      AND sa.student_id = NEW.student_id
      AND sa.billing_cycle_id = NEW.billing_cycle_id
      AND sa.status <> 'cancelled'
      AND ABS(
        COALESCE(sa.used_amount, 0)
        -
        (
          COALESCE(
            (
              SELECT SUM(u.amount)
              FROM sponsorship_billing_usage u
              WHERE u.sponsorship_allocation_id = NEW.sponsorship_allocation_id
                AND u.status = 'applied'
            ),
            0
          )
          + NEW.amount
        )
      ) <= 0.01
  );

END;
