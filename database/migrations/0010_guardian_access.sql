-- Guardian portal: a guardian is an ordinary user (role `guardian`) linked to one or
-- more students through the existing guardian_profiles rows. Link rows are the only
-- source of authorization; the guardian's session id is compared against user_id.
ALTER TABLE guardian_profiles
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS guardian_profiles_user_student_key
  ON guardian_profiles (user_id, student_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS guardian_profiles_user_idx
  ON guardian_profiles (user_id)
  WHERE user_id IS NOT NULL;

INSERT INTO roles (code, name, description) VALUES
  ('guardian', 'Guardian', 'Read-only access to their child''s attendance, fees and published results')
ON CONFLICT (code) DO NOTHING;
