-- 0003_content.sql
-- Lectures (YouTube references), study material links, assignments and attendance.

CREATE TABLE lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  chapter text,
  youtube_video_id text CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lessons_batch_subject_idx ON lessons (batch_id, subject_id, sort_order);
CREATE INDEX lessons_published_idx ON lessons (batch_id, published_at DESC) WHERE status = 'published';

CREATE TABLE lesson_progress (
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  last_position_seconds integer NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0 AND last_position_seconds <= 86400),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, lesson_id)
);

CREATE TABLE study_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  description text,
  chapter text,
  kind text NOT NULL DEFAULT 'notes' CHECK (kind IN ('notes', 'assignment', 'reference', 'other')),
  drive_url text NOT NULL CHECK (drive_url ~* '^https://'),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX study_materials_batch_idx ON study_materials (batch_id, subject_id);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  title text NOT NULL,
  instructions text,
  due_at timestamptz,
  max_marks integer NOT NULL DEFAULT 10 CHECK (max_marks > 0),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'closed')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX assignments_batch_idx ON assignments (batch_id, due_at DESC);

CREATE TABLE assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  content_text text,
  file_url text CHECK (file_url IS NULL OR file_url ~* '^https://'),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'evaluated', 'late', 'returned')),
  marks_awarded numeric(6, 2) CHECK (marks_awarded IS NULL OR marks_awarded >= 0),
  feedback text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  evaluated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  evaluated_at timestamptz,
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX assignment_submissions_student_idx ON assignment_submissions (student_id, submitted_at DESC);

CREATE TABLE attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  session_date date NOT NULL,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late')),
  notes text,
  marked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, batch_id, session_date)
);

CREATE INDEX attendance_batch_date_idx ON attendance (batch_id, session_date DESC);
CREATE INDEX attendance_student_date_idx ON attendance (student_id, session_date DESC);
CREATE INDEX attendance_date_status_idx ON attendance (session_date, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lessons', 'study_materials', 'assignments', 'attendance'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
