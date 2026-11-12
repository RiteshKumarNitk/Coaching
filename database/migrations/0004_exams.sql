-- 0004_exams.sql
-- Examinations, questions, protected answer keys, attempts, responses, results.

CREATE TABLE exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  instructions text,
  exam_type text NOT NULL DEFAULT 'mcq' CHECK (exam_type IN ('mcq', 'subjective', 'mixed')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  total_marks numeric(7, 2) NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  pass_marks numeric(7, 2) NOT NULL DEFAULT 0 CHECK (pass_marks >= 0),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 5),
  shuffle_questions boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'closed')),
  results_published boolean NOT NULL DEFAULT false,
  results_published_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (pass_marks <= total_marks)
);

CREATE INDEX exams_batch_starts_idx ON exams (batch_id, starts_at DESC);
CREATE INDEX exams_status_idx ON exams (status, starts_at);

CREATE TABLE exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_type text NOT NULL DEFAULT 'mcq' CHECK (question_type IN ('mcq', 'subjective')),
  question_text text NOT NULL,
  explanation text,
  marks numeric(6, 2) NOT NULL DEFAULT 1 CHECK (marks > 0),
  negative_marks numeric(6, 2) NOT NULL DEFAULT 0 CHECK (negative_marks >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exam_questions_exam_idx ON exam_questions (exam_id, sort_order);

CREATE TABLE exam_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX exam_options_question_idx ON exam_options (question_id, sort_order);

-- Answer keys live in a separate table so they can never leak through a
-- careless `SELECT *` on exam_questions/exam_options. Only evaluators and the
-- autograder read this table; it is never joined into a student response.
CREATE TABLE exam_answer_keys (
  question_id uuid PRIMARY KEY REFERENCES exam_questions(id) ON DELETE CASCADE,
  correct_option_id uuid REFERENCES exam_options(id) ON DELETE SET NULL,
  model_answer text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (correct_option_id IS NOT NULL OR model_answer IS NOT NULL)
);

CREATE TABLE exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 5),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'evaluated', 'expired')),
  score numeric(8, 2),
  UNIQUE (exam_id, student_id, attempt_no)
);

CREATE INDEX exam_attempts_student_idx ON exam_attempts (student_id, started_at DESC);
CREATE INDEX exam_attempts_exam_status_idx ON exam_attempts (exam_id, status);

CREATE TABLE exam_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  selected_option_id uuid REFERENCES exam_options(id) ON DELETE SET NULL,
  answer_text text,
  is_marked_for_review boolean NOT NULL DEFAULT false,
  awarded_marks numeric(6, 2) CHECK (awarded_marks IS NULL OR awarded_marks >= 0),
  evaluated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  evaluated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX exam_responses_attempt_idx ON exam_responses (attempt_id);

CREATE TABLE exam_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL UNIQUE REFERENCES exam_attempts(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  obtained_marks numeric(8, 2) NOT NULL DEFAULT 0,
  total_marks numeric(8, 2) NOT NULL DEFAULT 0,
  percentage numeric(5, 2) NOT NULL DEFAULT 0 CHECK (percentage BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail')),
  published_at timestamptz,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX exam_results_student_idx ON exam_results (student_id, created_at DESC);
CREATE INDEX exam_results_exam_idx ON exam_results (exam_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exams', 'exam_questions'] LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
