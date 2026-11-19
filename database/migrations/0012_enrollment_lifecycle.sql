-- Explicit enrollment validity and lifecycle history.
--
-- Dates are institute-local calendar dates. `valid_until` is inclusive: access
-- remains open through the end of that day in the institute timezone, and closes
-- at the next local midnight. NULL valid_from/valid_until means "no boundary"
-- for legacy rows and open-ended enrolments.

INSERT INTO app_settings (key, value)
VALUES ('instituteTimezone', 'Asia/Kolkata')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION institute_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    NULLIF((SELECT value FROM app_settings WHERE key = 'instituteTimezone'), ''),
    'Asia/Kolkata'
  ))::date
$$;

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS end_reason text,
  ADD COLUMN IF NOT EXISTS transfer_to_enrollment_id uuid REFERENCES enrollments(id) ON DELETE SET NULL;

-- Existing enrolments stay open-ended, but gain a start date in institute time.
UPDATE enrollments
SET valid_from = (enrolled_at AT TIME ZONE COALESCE(
  NULLIF((SELECT value FROM app_settings WHERE key = 'instituteTimezone'), ''),
  'Asia/Kolkata'
))::date
WHERE valid_from IS NULL;

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('active', 'completed', 'dropped', 'transferred'));

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_validity_check;
ALTER TABLE enrollments
  ADD CONSTRAINT enrollments_validity_check
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from);

CREATE INDEX IF NOT EXISTS enrollments_validity_idx
  ON enrollments (student_id, status, valid_from, valid_until);
