-- Idempotency for fee payments: a client-generated key per payment action.
-- Reusing the same key and the same details returns the original receipt;
-- reusing it with different details is rejected. Existing rows stay NULL.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_request_id_key
  ON payments (request_id)
  WHERE request_id IS NOT NULL;
