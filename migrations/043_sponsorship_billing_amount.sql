ALTER TABLE billing_cycles
ADD COLUMN sponsored_amount REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_billing_cycles_sponsored_amount
ON billing_cycles(sponsored_amount);
