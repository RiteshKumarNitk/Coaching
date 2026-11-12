-- 0005_fees_and_comms.sql
-- Fee structures, student dues, offline payments, announcements, notifications.

CREATE TABLE fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name text NOT NULL,
  academic_year text NOT NULL,
  total_amount numeric(10, 2) NOT NULL CHECK (total_amount >= 0),
  installments integer NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 12),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, academic_year, name)
);

CREATE TABLE student_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  fee_structure_id uuid NOT NULL REFERENCES fee_structures(id) ON DELETE RESTRICT,
  total_amount numeric(10, 2) NOT NULL CHECK (total_amount >= 0),
  discount_amount numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_amount numeric(10, 2) NOT NULL CHECK (net_amount >= 0),
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'waived')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, fee_structure_id),
  CHECK (net_amount = total_amount - discount_amount)
);

CREATE INDEX student_fees_student_idx ON student_fees (student_id, status);
CREATE INDEX student_fees_status_due_idx ON student_fees (status, due_date);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL UNIQUE,
  student_fee_id uuid NOT NULL REFERENCES student_fees(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  notes text,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_student_idx ON payments (student_id, paid_at DESC);
CREATE INDEX payments_fee_idx ON payments (student_fee_id);
CREATE INDEX payments_paid_at_idx ON payments (paid_at DESC);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'role', 'course', 'batch')),
  role_code text REFERENCES roles(code) ON UPDATE CASCADE ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES batches(id) ON DELETE CASCADE,
  is_pinned boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (audience = 'all')
    OR (audience = 'role' AND role_code IS NOT NULL)
    OR (audience = 'course' AND course_id IS NOT NULL)
    OR (audience = 'batch' AND batch_id IS NOT NULL)
  )
);

CREATE INDEX announcements_batch_idx ON announcements (batch_id, published_at DESC);
CREATE INDEX announcements_published_idx ON announcements (published_at DESC) WHERE published_at IS NOT NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'system' CHECK (type IN ('announcement', 'exam', 'lecture', 'assignment', 'fee', 'system')),
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
