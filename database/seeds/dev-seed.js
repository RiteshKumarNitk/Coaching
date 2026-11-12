/**
 * Development seed. NEVER run against the production branch.
 *
 *   pnpm db:seed
 *
 * Creates one super admin, two admins, three teachers, eight students, two
 * courses, two batches, schedules, attendance, fees, payments, announcements,
 * lessons, assignments and a completed + an upcoming examination.
 * All accounts share the password printed at the end (or SEED_ADMIN_PASSWORD).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";
import { generatePassword, hashPassword } from "@coaching/auth";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
  console.error("[seed] Refusing to seed with NODE_ENV=production. Re-run with --force only on a disposable branch.");
  process.exit(1);
}

const db = await createDatabase();

async function addUser(tx, { email, fullName, phone = null, role, password }) {
  const { rows } = await tx.query(
    `INSERT INTO users (email, password_hash, full_name, phone)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, hashPassword(password), fullName, phone]
  );
  const id = rows[0].id;
  await tx.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [id, role]);
  return id;
}

const students = [
  { name: "Aarav Sharma", email: "aarav.sharma@student.local", enrollment: "ENR-2026-001", phone: "9810012001", gender: "male", batch: "JEE" },
  { name: "Diya Patel", email: "diya.patel@student.local", enrollment: "ENR-2026-002", phone: "9810012002", gender: "female", batch: "JEE" },
  { name: "Kabir Singh", email: "kabir.singh@student.local", enrollment: "ENR-2026-003", phone: "9810012003", gender: "male", batch: "JEE" },
  { name: "Ananya Rao", email: "ananya.rao@student.local", enrollment: "ENR-2026-004", phone: "9810012004", gender: "female", batch: "JEE" },
  { name: "Rohan Mehta", email: "rohan.mehta@student.local", enrollment: "ENR-2026-005", phone: "9810012005", gender: "male", batch: "JEE" },
  { name: "Ishita Nair", email: "ishita.nair@student.local", enrollment: "ENR-2026-006", phone: "9810012006", gender: "female", batch: "NEET" },
  { name: "Vivaan Gupta", email: "vivaan.gupta@student.local", enrollment: "ENR-2026-007", phone: "9810012007", gender: "male", batch: "NEET" },
  { name: "Saanvi Joshi", email: "saanvi.joshi@student.local", enrollment: "ENR-2026-008", phone: "9810012008", gender: "female", batch: "NEET" }
];

const devPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || generatePassword(16);

try {
  const existing = await db.one("SELECT id FROM courses WHERE lower(code) = 'jee-2027'");
  if (existing) {
    console.log("[seed] Development seed already applied — nothing to do.");
    await db.close();
    process.exit(0);
  }

  const summary = await db.transaction(async (tx) => {
    const superAdminId = await addUser(tx, {
      email: process.env.SEED_ADMIN_EMAIL?.trim() || "admin@coaching.local",
      fullName: "Institute Owner",
      role: "super_admin",
      password: devPassword
    });

    await addUser(tx, { email: "office@coaching.local", fullName: "Priya Menon", role: "admin", password: devPassword });

    const teachers = {};
    teachers.physics = await addUser(tx, {
      email: "meera.iyer@coaching.local",
      fullName: "Dr. Meera Iyer",
      phone: "9820011001",
      role: "teacher",
      password: devPassword
    });
    teachers.maths = await addUser(tx, {
      email: "rahul.verma@coaching.local",
      fullName: "Rahul Verma",
      phone: "9820011002",
      role: "teacher",
      password: devPassword
    });
    teachers.biology = await addUser(tx, {
      email: "farah.khan@coaching.local",
      fullName: "Farah Khan",
      phone: "9820011003",
      role: "teacher",
      password: devPassword
    });

    await tx.query(
      `INSERT INTO teacher_profiles (user_id, employee_code, qualification, specialization, joining_date)
       VALUES ($1, 'T-1001', 'M.Sc. Physics, Ph.D.', 'Physics', '2023-06-01'),
              ($2, 'T-1002', 'M.Sc. Mathematics', 'Mathematics', '2023-07-15'),
              ($3, 'T-1003', 'M.Sc. Botany', 'Biology', '2024-01-10')`,
      [teachers.physics, teachers.maths, teachers.biology]
    );

    const courses = {};
    for (const course of [
      { key: "jee", code: "JEE-2027", name: "JEE Main + Advanced 2027", months: 24, description: "Two-year classroom programme for engineering entrance preparation." },
      { key: "neet", code: "NEET-2027", name: "NEET UG 2027", months: 24, description: "Two-year classroom programme for medical entrance preparation." }
    ]) {
      const { rows } = await tx.query(
        `INSERT INTO courses (code, name, description, duration_months, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [course.code, course.name, course.description, course.months, superAdminId]
      );
      courses[course.key] = rows[0].id;
    }

    const subjects = {};
    for (const subject of [
      { key: "physics", code: "PHY", name: "Physics" },
      { key: "chemistry", code: "CHE", name: "Chemistry" },
      { key: "maths", code: "MAT", name: "Mathematics" },
      { key: "biology", code: "BIO", name: "Biology" }
    ]) {
      const { rows } = await tx.query(
        `INSERT INTO subjects (code, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [subject.code, subject.name, superAdminId]
      );
      subjects[subject.key] = rows[0].id;
    }

    await tx.query(
      `INSERT INTO course_subjects (course_id, subject_id, semester) VALUES
         ($1, $3, 1), ($1, $4, 1), ($1, $5, 1),
         ($2, $3, 1), ($2, $4, 1), ($2, $6, 1)`,
      [courses.jee, courses.neet, subjects.physics, subjects.chemistry, subjects.maths, subjects.biology]
    );

    const batches = {};
    for (const batch of [
      { key: "jee", course: courses.jee, code: "JEE-27-A", name: "JEE 2027 — Morning A", start: "2026-06-01", end: "2028-03-31", capacity: 40 },
      { key: "neet", course: courses.neet, code: "NEET-27-A", name: "NEET 2027 — Morning A", start: "2026-06-01", end: "2028-03-31", capacity: 35 }
    ]) {
      const { rows } = await tx.query(
        `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity, schedule_note, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING id`,
        [batch.course, batch.code, batch.name, batch.start, batch.end, batch.capacity, "Mon–Sat, 07:00–10:15", superAdminId]
      );
      batches[batch.key] = rows[0].id;
    }

    await tx.query(
      `INSERT INTO batch_subjects (batch_id, subject_id) VALUES
         ($1, $3), ($1, $4), ($1, $5), ($2, $3), ($2, $4), ($2, $6)`,
      [batches.jee, batches.neet, subjects.physics, subjects.chemistry, subjects.maths, subjects.biology]
    );

    await tx.query(
      `INSERT INTO batch_teachers (batch_id, teacher_id, subject_id, is_primary, assigned_by) VALUES
         ($1, $3, $5, true, $8), ($1, $4, $6, false, $8),
         ($2, $3, $5, true, $8), ($2, $7, $6, false, $8)`,
      [
        batches.jee,
        batches.neet,
        teachers.physics,
        teachers.maths,
        subjects.physics,
        subjects.maths,
        teachers.biology,
        superAdminId
      ]
    );

    // Monday(1) .. Saturday(6) schedule rows.
    for (const day of [1, 2, 3, 4, 5, 6]) {
      await tx.query(
        `INSERT INTO batch_schedules (batch_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
         VALUES ($1, $3, $5, $7, '07:00', '08:30', 'Room 101'),
                ($2, $4, $6, $7, '08:45', '10:15', 'Room 102')`,
        [batches.jee, batches.neet, subjects.physics, subjects.biology, teachers.physics, teachers.biology, day]
      );
    }

    const studentIds = [];
    let admissionIndex = 0;
    for (const student of students) {
      const userId = await addUser(tx, {
        email: student.email,
        fullName: student.name,
        phone: student.phone,
        role: "student",
        password: devPassword
      });
      const daysAgo = [160, 150, 120, 95, 60, 40, 20, 6][admissionIndex];
      const admissionDate = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
      await tx.query(
        `INSERT INTO student_profiles (user_id, enrollment_no, admission_date, date_of_birth, gender, city, state)
         VALUES ($1, $2, $3, $4, $5, 'Indore', 'Madhya Pradesh')`,
        [userId, student.enrollment, admissionDate, student.gender === "male" ? "2009-04-12" : "2009-09-23", student.gender]
      );
      await tx.query(
        `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary)
         VALUES ($1, $2, 'father', $3, true)`,
        [userId, `${student.name.split(" ")[1]} Guardian`, `9810099${String(admissionIndex + 1).padStart(3, "0")}`]
      );
      const batchKey = student.batch.toLowerCase();
      await tx.query(
        `INSERT INTO enrollments (student_id, batch_id, course_id, enrolled_at, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, batches[batchKey], batches[batchKey] === batches.jee ? courses.jee : courses.neet, `${admissionDate}T09:00:00Z`, superAdminId]
      );
      studentIds.push({ ...student, id: userId, batchId: batches[batchKey] });
      admissionIndex += 1;
    }

    // Attendance for the last 21 days (Sundays excluded), deterministic pattern.
    let dayIndex = 0;
    for (let offset = 20; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 86_400_000);
      if (date.getDay() === 0) continue;
      const sessionDate = date.toISOString().slice(0, 10);
      for (const [studentIndex, student] of studentIds.entries()) {
        const seed = dayIndex * 7 + studentIndex * 3;
        const status = seed % 13 === 0 ? "absent" : seed % 19 === 0 ? "late" : "present";
        await tx.query(
          `INSERT INTO attendance (batch_id, student_id, session_date, status, marked_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [student.batchId, student.id, sessionDate, status, teachers.physics]
        );
      }
      dayIndex += 1;
    }

    // Fee structures and dues.
    const feeStructures = {};
    for (const [key, courseId] of Object.entries(courses)) {
      const { rows } = await tx.query(
        `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments, created_by)
         VALUES ($1, $2, '2026-27', 45000, 3, $3) RETURNING id`,
        [courseId, key === "jee" ? "JEE 2027 Tuition" : "NEET 2027 Tuition", superAdminId]
      );
      feeStructures[key] = rows[0].id;
    }

    let paymentSeq = 0;
    for (const [index, student] of studentIds.entries()) {
      const key = student.batch.toLowerCase();
      const net = 45000;
      const { rows } = await tx.query(
        `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, due_date, status, created_by)
         VALUES ($1, $2, $3, 0, $3, $4, $5, $6) RETURNING id`,
        [
          student.id,
          feeStructures[key],
          net,
          new Date(Date.now() + (index % 3 === 0 ? -10 : 20) * 86_400_000).toISOString().slice(0, 10),
          "pending",
          superAdminId
        ]
      );
      const feeId = rows[0].id;
      const paid = index < 2 ? 45000 : index < 5 ? 15000 : 0;
      if (paid > 0) {
        paymentSeq += 1;
        await tx.query(
          `INSERT INTO payments (receipt_no, student_fee_id, student_id, amount, method, reference, recorded_by)
           VALUES ($1, $2, $3, $4, 'upi', $5, $6)`,
          [
            `RCPT-2026-${String(paymentSeq).padStart(4, "0")}`,
            feeId,
            student.id,
            paid,
            `UPI-${1000 + paymentSeq}`,
            superAdminId
          ]
        );
        await tx.query("UPDATE student_fees SET status = $2 WHERE id = $1", [feeId, paid >= net ? "paid" : "partial"]);
      }
    }

    // Lessons (YouTube ids are intentionally empty: paste real unlisted ids in the UI).
    for (const [order, title] of ["Kinematics — Lecture 1", "Newton's Laws — Lecture 2", "Work, Energy and Power"].entries()) {
      await tx.query(
        `INSERT INTO lessons (batch_id, subject_id, title, description, chapter, sort_order, status, published_at, created_by)
         VALUES ($1, $2, $3, $4, 'Mechanics', $5, 'published', now() - make_interval(days => $5), $6)`,
        [batches.jee, subjects.physics, title, "Classroom recording. Add the unlisted YouTube video id to publish the player.", order + 1, teachers.physics]
      );
    }

    // Assignment with two submissions so the teacher dashboard has real content.
    const { rows: assignmentRows } = await tx.query(
      `INSERT INTO assignments (batch_id, subject_id, title, instructions, due_at, max_marks, created_by)
       VALUES ($1, $2, 'Rotational Motion — Problem Set 3', 'Solve questions 1–12 from the worksheet.', now() + interval '2 days', 20, $3)
       RETURNING id`,
      [batches.jee, subjects.physics, teachers.physics]
    );
    for (const student of studentIds.slice(0, 2)) {
      await tx.query(
        `INSERT INTO assignment_submissions (assignment_id, student_id, content_text, status)
         VALUES ($1, $2, 'Submitted handwritten solutions (scanned copy in Drive).', 'submitted')`,
        [assignmentRows[0].id, student.id]
      );
    }

    // Completed exam with protected answer keys + attempts + published results.
    const { rows: examRows } = await tx.query(
      `INSERT INTO exams (batch_id, subject_id, title, instructions, exam_type, starts_at, ends_at, duration_minutes,
                          total_marks, pass_marks, status, results_published, results_published_at, created_by)
       VALUES ($1, $2, 'Physics Unit Test 1 — Mechanics',
               'Attempt all questions. Each correct answer carries 4 marks; no negative marking.',
               'mcq', now() - interval '10 days', now() - interval '9 days', 45, 12, 5, 'closed', true, now() - interval '8 days', $3)
       RETURNING id`,
      [batches.jee, subjects.physics, teachers.physics]
    );
    const completedExamId = examRows[0].id;

    const questionBank = [
      {
        text: "A body moves with constant velocity. What is its acceleration?",
        options: ["Zero", "9.8 m/s²", "Constant but non-zero", "Increasing"],
        correct: 0
      },
      {
        text: "The SI unit of momentum is:",
        options: ["kg·m/s²", "kg·m/s", "N·m", "J/s"],
        correct: 1
      },
      {
        text: "Work done by a force perpendicular to displacement is:",
        options: ["Maximum", "Negative", "Zero", "Equal to force"],
        correct: 2
      }
    ];

    const questionIds = [];
    for (const [order, question] of questionBank.entries()) {
      const { rows } = await tx.query(
        `INSERT INTO exam_questions (exam_id, question_type, question_text, marks, sort_order)
         VALUES ($1, 'mcq', $2, 4, $3) RETURNING id`,
        [completedExamId, question.text, order + 1]
      );
      const questionId = rows[0].id;
      questionIds.push(questionId);
      const optionIds = [];
      for (const [optionOrder, option] of question.options.entries()) {
        const { rows: optionRows } = await tx.query(
          `INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, $2, $3) RETURNING id`,
          [questionId, option, optionOrder + 1]
        );
        optionIds.push(optionRows[0].id);
      }
      await tx.query(
        `INSERT INTO exam_answer_keys (question_id, correct_option_id, updated_by) VALUES ($1, $2, $3)`,
        [questionId, optionIds[question.correct], teachers.physics]
      );
    }

    for (const [index, student] of studentIds.slice(0, 3).entries()) {
      const { rows } = await tx.query(
        `INSERT INTO exam_attempts (exam_id, student_id, started_at, expires_at, submitted_at, status, score)
         VALUES ($1, $2, now() - interval '10 days', now() - interval '10 days' + interval '45 minutes',
                 now() - interval '10 days' + interval '40 minutes', 'evaluated', $3)
         RETURNING id`,
        [completedExamId, student.id, [12, 8, 4][index]]
      );
      const attemptId = rows[0].id;
      for (const [qIndex, questionId] of questionIds.entries()) {
        // Must read through the open transaction: a pooled connection cannot see
        // rows that have not been committed yet.
        const { rows: keyRows } = await tx.query(
          "SELECT correct_option_id FROM exam_answer_keys WHERE question_id = $1",
          [questionId]
        );
        const correctOptionId = keyRows[0]?.correct_option_id ?? null;
        const answers = [
          ["correct", "correct", "correct"],
          ["correct", "wrong", "correct"],
          ["wrong", "correct", "wrong"]
        ][index];
        const picked = answers[qIndex] === "correct" ? correctOptionId : null;
        await tx.query(
          `INSERT INTO exam_responses (attempt_id, question_id, selected_option_id, awarded_marks, evaluated_by, evaluated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [attemptId, questionId, picked, answers[qIndex] === "correct" ? 4 : 0, teachers.physics]
        );
      }
      const obtained = [12, 8, 4][index];
      await tx.query(
        `INSERT INTO exam_results (exam_id, attempt_id, student_id, obtained_marks, total_marks, percentage, status, published_at, published_by)
         VALUES ($1, $2, $3, $4, 12, $5, $6, now() - interval '8 days', $7)`,
        [completedExamId, attemptId, student.id, obtained, (obtained / 12) * 100, obtained >= 5 ? "pass" : "fail", teachers.physics]
      );
    }

    // Upcoming exams (no attempts yet).
    for (const exam of [
      { batch: batches.jee, subject: subjects.chemistry, title: "Chemistry Unit Test 2 — Bonding", days: 4 },
      { batch: batches.neet, subject: subjects.biology, title: "Biology Weekly Test — Cell Structure", days: 2 }
    ]) {
      const { rows } = await tx.query(
        `INSERT INTO exams (batch_id, subject_id, title, instructions, exam_type, starts_at, ends_at, duration_minutes,
                            total_marks, pass_marks, status, created_by)
         VALUES ($1, $2, $3, 'Syllabus covered until the previous class.', 'mcq',
                 now() + ($4 || ' days')::interval, now() + ($4 || ' days')::interval + interval '1 day',
                 60, 20, 8, 'scheduled', $5)
         RETURNING id`,
        [exam.batch, exam.subject, exam.title, exam.days, teachers.physics]
      );
      await tx.query(
        `INSERT INTO exam_questions (exam_id, question_type, question_text, marks, sort_order)
         VALUES ($1, 'mcq', 'Sample question — add the real question paper from the teacher dashboard.', 4, 1)`,
        [rows[0].id]
      );
    }

    await tx.query(
      `INSERT INTO announcements (title, body, audience, role_code, is_pinned, published_at, created_by) VALUES
         ('Unit Test 2 schedule released',
          'The Chemistry Unit Test 2 for JEE 2027 batches is scheduled this week. Check the Tests tab for timing and syllabus.',
          'all', NULL, true, now() - interval '1 day', $1),
         ('Fee instalment reminder',
          'The second instalment for the 2026-27 session is due this month. Visit the office for a receipt.',
          'role', 'student', false, now() - interval '3 days', $2)`,
      [superAdminId, superAdminId]
    );

    await tx.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       VALUES ($1, 'exam', 'New test scheduled', 'Chemistry Unit Test 2 has been scheduled.', '/student'),
              ($1, 'announcement', 'Unit Test 2 schedule released', 'Check the Tests tab for details.', '/student')`,
      [studentIds[0].id]
    );

    await tx.query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'seed.dev_data_created', 'system', null, '{"source":"dev-seed"}'::jsonb)`,
      [superAdminId, "admin@coaching.local"]
    );

    return { students: studentIds.length, batches: Object.keys(batches).length, exams: 3 };
  });

  console.log("[seed] Development data created.");
  console.log(`[seed] students=${summary.students} batches=${summary.batches} exams=${summary.exams}`);
  console.log("[seed] Sign-in accounts (development only):");
  console.log(`  super admin : ${process.env.SEED_ADMIN_EMAIL?.trim() || "admin@coaching.local"}`);
  console.log("  admin       : office@coaching.local");
  console.log("  teacher     : meera.iyer@coaching.local");
  console.log("  student     : aarav.sharma@student.local");
  console.log(`  password    : ${devPassword}`);
  console.log("[seed] Change or delete these accounts before any real deployment.");
} catch (error) {
  console.error("[seed] failed:", error.message);
  if (error.detail) console.error("[seed] detail:", error.detail);
  process.exitCode = 1;
} finally {
  await db.close();
}
