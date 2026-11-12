-- 0002_academics.sql
-- Courses, subjects, people profiles, batches, schedules and enrollments.

CREATE TABLE courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  duration_months integer NOT NULL DEFAULT 12 CHECK (duration_months BETWEEN 1 AND 72),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX courses_code_lower_key ON courses (lower(code));
CREATE INDEX courses_status_idx ON courses (status);

CREATE TABLE subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX subjects_code_lower_key ON subjects (lower(code));

CREATE TABLE course_subjects (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  semester integer CHECK (semester IS NULL OR semester BETWEEN 1 AND 12),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, subject_id)
);

CREATE INDEX course_subjects_subject_idx ON course_subjects (subject_id);

CREATE TABLE student_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enrollment_no text NOT NULL,
  admission_date date,
  date_of_birth date,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  address text,
  city text,
  state text,
  pincode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_of_birth IS NULL OR date_of_birth < current_date)
);

CREATE UNIQUE INDEX student_profiles_enrollment_key ON student_profiles (lower(enrollment_no));
CREATE INDEX student_profiles_admission_idx ON student_profiles (admission_date DESC);

CREATE TABLE guardian_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  relation text NOT NULL DEFAULT 'guardian' CHECK (relation IN ('father', 'mother', 'guardian', 'other')),
  phone text,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guardian_profiles_student_idx ON guardian_profiles (student_id);
CREATE UNIQUE INDEX guardian_profiles_one_primary ON guardian_profiles (student_id) WHERE is_primary;

CREATE TABLE teacher_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_code text NOT NULL,
  qualification text,
  specialization text,
  joining_date date,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX teacher_profiles_employee_key ON teacher_profiles (lower(employee_code));

CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  schedule_note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);

CREATE UNIQUE INDEX batches_code_lower_key ON batches (lower(code));
CREATE INDEX batches_course_idx ON batches (course_id, status);

CREATE TABLE batch_subjects (
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, subject_id)
);

CREATE TABLE batch_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  is_primary boolean NOT NULL DEFAULT false,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX batch_teachers_unique ON batch_teachers (batch_id, teacher_id, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX batch_teachers_teacher_idx ON batch_teachers (teacher_id);

CREATE TABLE batch_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id uuid REFERENCES teacher_profiles(user_id) ON DELETE SET NULL,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday (matches EXTRACT(DOW))
  start_time time NOT NULL,
  end_time time NOT NULL,
  room text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX batch_schedules_batch_idx ON batch_schedules (batch_id, day_of_week);
CREATE INDEX batch_schedules_teacher_idx ON batch_schedules (teacher_id, day_of_week);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dropped')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX enrollments_student_batch_key ON enrollments (student_id, batch_id);
CREATE INDEX enrollments_batch_idx ON enrollments (batch_id, status);
CREATE INDEX enrollments_course_idx ON enrollments (course_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses', 'subjects', 'student_profiles', 'guardian_profiles', 'teacher_profiles', 'batches'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
