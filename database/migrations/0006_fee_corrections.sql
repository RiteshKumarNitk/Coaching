-- Fee corrections: a receipt recorded by mistake can be voided without deleting it,
-- and a fee can be waived (scholarship, staff ward) with a reason on the record.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS void_reason text;

CREATE INDEX IF NOT EXISTS payments_live_idx ON payments (student_fee_id) WHERE voided_at IS NULL;

ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS waived_at timestamptz;
ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS waived_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE student_fees ADD COLUMN IF NOT EXISTS waiver_reason text;
