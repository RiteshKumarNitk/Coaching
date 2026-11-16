-- Instalment schedule for a student invoice. Payments still post against the invoice;
-- the schedule says how the balance is expected to arrive and is paid down in order.

CREATE TABLE IF NOT EXISTS fee_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_fee_id uuid NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 24),
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_fee_id, seq)
);

CREATE INDEX IF NOT EXISTS fee_installments_fee_idx ON fee_installments (student_fee_id, seq);

-- Accounts created with a generated/temporary password must set their own before
-- they can use the workspace.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
