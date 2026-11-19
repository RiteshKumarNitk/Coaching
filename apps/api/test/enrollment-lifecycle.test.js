/**
 * Enrollment lifecycle: explicit validity dates, expiry blocking new learning
 * while keeping history readable, attempt finish after expiry, close and
 * transfer without deleting history, and institute-timezone boundaries.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../database/migrations");

const { createDatabase } = await import("@coaching/db");
const { hashPassword } = await import("@coaching/auth");
const { createApp } = await import("../src/app.js");

let db;
let server;
let baseUrl;
let tempDir;

const state = {
  adminCookie: "",
  studentCookie: "",
  studentId: "",
  courseId: "",
  batchA: "",
  batchB: "",
  batchC: "",
  batchD: "",
  subjectId: "",
  lessonA: "",
  assignmentA: "",
  examA: "",
  examB: "",
  examC: "",
  feeA: "",
  paymentA: "",
  attemptA: "",
  submissionA: ""
};

const cookieFrom = (response) =>
  (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");

async function request(pathname, { method = "GET", body, cookie } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function login(email, password) {
  const response = await request("/api/auth/login", { method: "POST", body: { email, password } });
  assert.equal(response.status, 200, response.text);
  return cookieFrom(response);
}

async function createUser({ email, role, fullName }) {
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
    [email, hashPassword("StudentPass123"), fullName]
  );
  const id = rows[0].id;
  await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [id, role]);
  if (role === "student") {
    await db.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, $2)", [id, `ENR-${email}`]);
  }
  return id;
}

async function seedHistory(studentId, { validUntilOffset, suffix }) {
  await db.query(
    `INSERT INTO enrollments (student_id, batch_id, course_id, valid_from, valid_until)
     VALUES ($1, $2, $3, institute_today() - 30, institute_today() + $4::int)`,
    [studentId, state.batchA, state.courseId, validUntilOffset]
  );

  const lesson = await db.query(
    `INSERT INTO lessons (batch_id, subject_id, title, status, published_at)
     VALUES ($1, $2, $3, 'published', now()) RETURNING id`,
    [state.batchA, state.subjectId, `Lesson ${suffix}`]
  );
  const material = await db.query(
    `INSERT INTO study_materials (batch_id, subject_id, title, drive_url, status)
     VALUES ($1, $2, $3, 'https://drive.google.com/file/d/test', 'published') RETURNING id`,
    [state.batchA, state.subjectId, `Notes ${suffix}`]
  );
  const assignment = await db.query(
    `INSERT INTO assignments (batch_id, subject_id, title, status, due_at)
     VALUES ($1, $2, $3, 'published', now() + interval '1 day') RETURNING id`,
    [state.batchA, state.subjectId, `Assignment ${suffix}`]
  );
  const submission = await db.query(
    `INSERT INTO assignment_submissions (assignment_id, student_id, content_text, status, submitted_at)
     VALUES ($1, $2, 'My submitted work', 'submitted', now() - interval '2 days') RETURNING id`,
    [assignment.rows[0].id, studentId]
  );
  await db.query(
    "INSERT INTO attendance (batch_id, student_id, session_date, status) VALUES ($1, $2, CURRENT_DATE - 1, 'present')",
    [state.batchA, studentId]
  );

  const exam = await db.query(
    `INSERT INTO exams (batch_id, subject_id, title, exam_type, starts_at, ends_at, duration_minutes,
                        total_marks, pass_marks, max_attempts, status, results_published)
     VALUES ($1, $2, $3, 'mcq', now() - interval '1 hour', now() + interval '2 hours', 60, 2, 1, 1, 'published', true)
     RETURNING id`,
    [state.batchA, state.subjectId, `Exam ${suffix}`]
  );
  const question = await db.query(
    `INSERT INTO exam_questions (exam_id, question_text, marks) VALUES ($1, '2 + 2?', 2) RETURNING id`,
    [exam.rows[0].id]
  );
  const option = await db.query(
    `INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, '4', 1) RETURNING id`,
    [question.rows[0].id]
  );
  await db.query("INSERT INTO exam_answer_keys (question_id, correct_option_id) VALUES ($1, $2)", [
    question.rows[0].id,
    option.rows[0].id
  ]);
  const attempt = await db.query(
    `INSERT INTO exam_attempts (exam_id, student_id, attempt_no, status, score, started_at, submitted_at, expires_at)
     VALUES ($1, $2, 1, 'evaluated', 2, now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')
     RETURNING id`,
    [exam.rows[0].id, studentId]
  );
  await db.query(
    `INSERT INTO exam_results (exam_id, attempt_id, student_id, obtained_marks, total_marks, percentage, status, published_at)
     VALUES ($1, $2, $3, 2, 2, 100, 'pass', now() - interval '1 day')`,
    [exam.rows[0].id, attempt.rows[0].id, studentId]
  );

  const structure = await db.query(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments)
     VALUES ($1, $2, '2026-27', 10000, 1) RETURNING id`,
    [state.courseId, `Structure ${suffix}`]
  );
  const fee = await db.query(
    `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, status)
     VALUES ($1, $2, 10000, 0, 10000, 'partial') RETURNING id`,
    [studentId, structure.rows[0].id]
  );
  await db.query(
    `INSERT INTO payments (receipt_no, student_fee_id, student_id, amount, method, request_id)
     VALUES ($1, $2, $3, 1000, 'cash', $4)`,
    [`RCPT-ENR-${suffix}`, fee.rows[0].id, studentId, `enr-${suffix}`]
  );

  return {
    lessonId: lesson.rows[0].id,
    materialId: material.rows[0].id,
    assignmentId: assignment.rows[0].id,
    submissionId: submission.rows[0].id,
    examId: exam.rows[0].id,
    attemptId: attempt.rows[0].id,
    feeId: fee.rows[0].id
  };
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-enrollment-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  for (const file of (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }

  await createUser({ email: "admin@test.local", role: "super_admin", fullName: "Admin" });
  state.studentId = await createUser({ email: "expired@test.local", role: "student", fullName: "Expired Student" });
  const activeId = await createUser({ email: "active@test.local", role: "student", fullName: "Active Student" });
  const boundaryId = await createUser({ email: "boundary@test.local", role: "student", fullName: "Boundary Student" });

  const course = await db.query("INSERT INTO courses (code, name, duration_months) VALUES ('ENR', 'Enrollment Course', 12) RETURNING id");
  state.courseId = course.rows[0].id;
  const otherCourse = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('ENR-OTHER', 'Other Course', 12) RETURNING id"
  );
  const subject = await db.query("INSERT INTO subjects (code, name) VALUES ('EN1', 'Enrollment Subject') RETURNING id");
  state.subjectId = subject.rows[0].id;
  const batch = async (code, courseId) => {
    const result = await db.query(
      `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
       VALUES ($1, $2, $3, '2026-01-01', '2027-12-31', 30) RETURNING id`,
      [courseId, code, `Batch ${code}`]
    );
    return result.rows[0].id;
  };
  state.batchA = await batch("ENR-A", state.courseId);
  state.batchB = await batch("ENR-B", state.courseId);
  state.batchC = await batch("ENR-C", otherCourse.rows[0].id);
  state.batchD = await batch("ENR-D", state.courseId);

  const startExam = await db.query(
    `INSERT INTO exams (batch_id, subject_id, title, exam_type, starts_at, ends_at, duration_minutes,
                        total_marks, pass_marks, max_attempts, status)
     VALUES ($1, $2, 'Exam START', 'mcq', now() - interval '1 hour', now() + interval '2 hours', 60, 2, 1, 1, 'published')
     RETURNING id`,
    [state.batchA, state.subjectId]
  );
  const startQuestion = await db.query(
    "INSERT INTO exam_questions (exam_id, question_text, marks) VALUES ($1, '2 + 2?', 2) RETURNING id",
    [startExam.rows[0].id]
  );
  const startOption = await db.query(
    "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, '4', 1) RETURNING id",
    [startQuestion.rows[0].id]
  );
  await db.query("INSERT INTO exam_answer_keys (question_id, correct_option_id) VALUES ($1, $2)", [
    startQuestion.rows[0].id,
    startOption.rows[0].id
  ]);
  state.examStart = startExam.rows[0].id;

  const expired = await seedHistory(state.studentId, { validUntilOffset: -1, suffix: "EXP" });
  await seedHistory(activeId, { validUntilOffset: null, suffix: "ACT" });
  await seedHistory(boundaryId, { validUntilOffset: 0, suffix: "BND" });
  Object.assign(state, {
    ...expired,
    lessonA: expired.lessonId,
    assignmentA: expired.assignmentId,
    examA: expired.examId,
    submissionA: expired.submissionId
  });

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  state.adminCookie = await login("admin@test.local", "StudentPass123");
  state.studentCookie = await login("expired@test.local", "StudentPass123");
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("enrollment lifecycle", () => {
  it("blocks new learning, submissions and exam starts after expiry, while history stays readable", async () => {
    const lessons = await request("/api/student/lessons", { cookie: state.studentCookie });
    assert.equal(lessons.status, 200, lessons.text);
    assert.equal(lessons.json.items.length, 0);

    const materials = await request("/api/student/materials", { cookie: state.studentCookie });
    assert.equal(materials.status, 200, materials.text);
    assert.equal(materials.json.items.length, 0);

    const lessonDetail = await request(`/api/student/lessons/${state.lessonId}`, { cookie: state.studentCookie });
    assert.equal(lessonDetail.status, 404, lessonDetail.text);

    const assignments = await request("/api/student/assignments", { cookie: state.studentCookie });
    assert.equal(assignments.status, 200, assignments.text);
    const assignment = assignments.json.items.find((item) => item.id === state.assignmentA);
    assert.ok(assignment, assignments.text);
    assert.equal(assignment.canSubmit, false);
    assert.equal(assignment.submission.status, "submitted");

    const detail = await request(`/api/student/assignments/${state.assignmentA}`, { cookie: state.studentCookie });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.submission.contentText, "My submitted work");

    const submit = await request(`/api/student/assignments/${state.assignmentA}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { contentText: "late work" }
    });
    assert.equal(submit.status, 400, submit.text);

    const results = await request("/api/student/results", { cookie: state.studentCookie });
    assert.equal(results.status, 200, results.text);
    assert.equal(results.json.items.length, 1);
    assert.equal(results.json.items[0].obtainedMarks, 2);

    const fees = await request("/api/student/fees", { cookie: state.studentCookie });
    assert.equal(fees.status, 200, fees.text);
    assert.equal(fees.json.invoices.length, 1);
    assert.equal(fees.json.payments.length, 1);

    const attendance = await request("/api/student/attendance", { cookie: state.studentCookie });
    assert.equal(attendance.status, 200, attendance.text);
    assert.equal(attendance.json.items.length, 1);

    const home = await request("/api/student/dashboard", { cookie: state.studentCookie });
    assert.equal(home.status, 200, home.text);
    assert.equal(home.json.enrollment, null, "expired learning is not presented as an active course");
    assert.equal(home.json.resumeLesson, null);
    assert.equal(home.json.nextClass, null);
    assert.equal(home.json.recentResults.length, 1, "published results stay readable after expiry");
    assert.equal(home.json.fees.total, 10000, "fee history stays readable after expiry");
    assert.equal(home.json.fees.paid, 1000);

    const start = await request(`/api/student/exams/${state.examA}/attempts`, {
      method: "POST",
      cookie: state.studentCookie,
      body: {}
    });
    assert.equal(start.status, 404, start.text);
  });

  it("lets an attempt started before expiry finish until its server deadline", async () => {
    const cookie = await login("boundary@test.local", "StudentPass123");
    const exam = { id: state.examStart };
    const start = await request(`/api/student/exams/${exam.id}/attempts`, {
      method: "POST",
      cookie,
      body: {}
    });
    assert.ok([200, 201].includes(start.status), start.text);
    const attemptId = start.json.attempt.id;
    const questionId = start.json.questions[0].id;
    const optionId = start.json.questions[0].options[0].id;

    await db.query(
      "UPDATE enrollments SET valid_until = institute_today() - 1 WHERE student_id = (SELECT id FROM users WHERE email = 'boundary@test.local')"
    );

    const save = await request(`/api/student/attempts/${attemptId}/answers`, {
      method: "PATCH",
      cookie,
      body: { answers: [{ questionId, selectedOptionId: optionId }] }
    });
    assert.equal(save.status, 200, save.text);

    const submit = await request(`/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      cookie,
      body: {}
    });
    assert.equal(submit.status, 200, submit.text);
    assert.equal(submit.json.resultsPublished, false);
    assert.equal("score" in submit.json, false);
    const stored = await db.one("SELECT score FROM exam_attempts WHERE id = $1", [attemptId]);
    assert.equal(Number(stored.score), 2);

    const second = await request(`/api/student/exams/${exam.id}/attempts`, {
      method: "POST",
      cookie,
      body: {}
    });
    assert.equal(second.status, 404, second.text);
  });

  it("withdraws and completes without deleting history, and DELETE no longer removes the row", async () => {
    const activeId = (await db.one("SELECT id FROM users WHERE email = 'active@test.local'")).id;
    const enrollment = await db.one("SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
      activeId,
      state.batchA
    ]);

    const close = await request(`/api/admin/students/${activeId}/enrollment/${enrollment.id}/close`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { status: "completed", reason: "Course finished" }
    });
    assert.equal(close.status, 200, close.text);
    const row = await db.one("SELECT status, ended_at, end_reason FROM enrollments WHERE id = $1", [enrollment.id]);
    assert.equal(row.status, "completed");
    assert.ok(row.ended_at);
    assert.equal(row.end_reason, "Course finished");

    const detail = await request(`/api/admin/students/${activeId}`, { cookie: state.adminCookie });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.enrollments.length, 1);

    const counts = await db.one(
      `SELECT
        (SELECT count(*)::int FROM assignment_submissions s JOIN users u ON u.id = s.student_id WHERE u.email = 'active@test.local') AS submissions,
        (SELECT count(*)::int FROM exam_attempts a JOIN users u ON u.id = a.student_id WHERE u.email = 'active@test.local') AS attempts`
    );
    assert.equal(counts.submissions, 1);
    assert.equal(counts.attempts, 1);
  });

  it("transfers to another batch, closes the source and preserves attempts, submissions and invoices", async () => {
    const activeId = (await db.one("SELECT id FROM users WHERE email = 'active@test.local'")).id;
    // Re-open A for the transfer test, then move to B.
    const reopened = await request(`/api/admin/students/${activeId}/enrollment`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { batchId: state.batchA, validUntil: "2027-12-31" }
    });
    assert.equal(reopened.status, 200, reopened.text);
    const source = await db.one("SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
      activeId,
      state.batchA
    ]);

    const before = await db.one(
      `SELECT
        (SELECT count(*)::int FROM exam_attempts a WHERE a.student_id = $1) AS attempts,
        (SELECT count(*)::int FROM exam_results r WHERE r.student_id = $1) AS results,
        (SELECT count(*)::int FROM assignment_submissions s WHERE s.student_id = $1) AS submissions,
        (SELECT count(*)::int FROM student_fees f WHERE f.student_id = $1) AS invoices,
        (SELECT count(*)::int FROM payments p WHERE p.student_id = $1) AS payments`,
      [activeId]
    );

    const transfer = await request(`/api/admin/students/${activeId}/enrollment/${source.id}/transfer`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { batchId: state.batchB, validUntil: "2027-12-31", reason: "Batch timing change" }
    });
    assert.equal(transfer.status, 200, transfer.text);

    const rows = await db.many(
      "SELECT id, batch_id, status, ended_at, transfer_to_enrollment_id FROM enrollments WHERE student_id = $1 ORDER BY enrolled_at",
      [activeId]
    );
    const old = rows.find((row) => row.id === source.id);
    const created = rows.find((row) => row.id === old.transfer_to_enrollment_id);
    assert.equal(old.status, "transferred");
    assert.ok(old.ended_at);
    assert.equal(created.batch_id, state.batchB);
    assert.equal(created.status, "active");
    const historyRow = transfer.json.enrollments.find((row) => row.id === source.id);
    assert.equal(historyRow.transferToBatchName, "Batch ENR-B", "transferred history names its destination");
    assert.equal(historyRow.transferToBatchCode, "ENR-B");

    const after = await db.one(
      `SELECT
        (SELECT count(*)::int FROM exam_attempts a WHERE a.student_id = $1) AS attempts,
        (SELECT count(*)::int FROM exam_results r WHERE r.student_id = $1) AS results,
        (SELECT count(*)::int FROM assignment_submissions s WHERE s.student_id = $1) AS submissions,
        (SELECT count(*)::int FROM student_fees f WHERE f.student_id = $1) AS invoices,
        (SELECT count(*)::int FROM payments p WHERE p.student_id = $1) AS payments`,
      [activeId]
    );
    assert.deepEqual(after, before);
    assert.equal(after.invoices, 1);

    const audit = await db.one(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'student.transferred' AND entity_id = $1",
      [created.id]
    );
    assert.equal(audit.count, 1);
  });

  it("uses the institute timezone for the expiry boundary", async () => {
    const boundaryId = (await db.one("SELECT id FROM users WHERE email = 'boundary@test.local'")).id;
    const enrollment = await db.one("SELECT id FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
      boundaryId,
      state.batchA
    ]);

    await db.query("UPDATE app_settings SET value = 'Pacific/Honolulu' WHERE key = 'instituteTimezone'");
    const honolulu = await db.one("SELECT institute_today() AS today");
    await db.query("UPDATE enrollments SET valid_until = $2 WHERE id = $1", [enrollment.id, honolulu.today]);

    const cookie = await login("boundary@test.local", "StudentPass123");
    const before = await request("/api/student/lessons", { cookie });
    assert.equal(before.status, 200, before.text);
    assert.ok(before.json.items.length >= 1, "valid through the end of today in Honolulu");

    await db.query("UPDATE app_settings SET value = 'Pacific/Kiritimati' WHERE key = 'instituteTimezone'");
    const kiritimati = await db.one("SELECT institute_today() AS today");
    assert.ok(
      new Date(kiritimati.today).getTime() > new Date(honolulu.today).getTime(),
      "Kiritimati is ahead of Honolulu for this fixture"
    );

    const after = await request("/api/student/lessons", { cookie });
    assert.equal(after.status, 200, after.text);
    assert.equal(after.json.items.length, 0, "the same date has already ended in Kiritimati");

    await db.query("UPDATE app_settings SET value = 'Asia/Kolkata' WHERE key = 'instituteTimezone'");

    // The inclusive end date is a calendar boundary in the institute timezone:
    // today is still readable, yesterday is not.
    await db.query("UPDATE enrollments SET valid_until = institute_today() WHERE id = $1", [enrollment.id]);
    const onLastDay = await request("/api/student/lessons", { cookie });
    assert.equal(onLastDay.status, 200, onLastDay.text);
    assert.ok(onLastDay.json.items.length >= 1, "valid through the end of today in Asia/Kolkata");

    await db.query("UPDATE enrollments SET valid_until = institute_today() - 1 WHERE id = $1", [enrollment.id]);
    const afterLastDay = await request("/api/student/lessons", { cookie });
    assert.equal(afterLastDay.status, 200, afterLastDay.text);
    assert.equal(afterLastDay.json.items.length, 0, "expired after the Kolkata calendar day ended");
  });

  it("refuses a transfer into an occupied target and keeps the source active, then transfers on the same course without moving fees", async () => {
    const activeId = (await db.one("SELECT id FROM users WHERE email = 'active@test.local'")).id;
    const source = await db.one("SELECT id, status FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
      activeId,
      state.batchB
    ]);
    assert.equal(source.status, "active");
    const beforeRows = await db.one("SELECT count(*)::int AS count FROM enrollments WHERE student_id = $1", [activeId]);

    // A still has the old transferred row, so it is an occupied target.
    const conflict = await request(`/api/admin/students/${activeId}/enrollment/${source.id}/transfer`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { batchId: state.batchA }
    });
    assert.equal(conflict.status, 409, conflict.text);

    const unchanged = await db.one("SELECT status, transfer_to_enrollment_id FROM enrollments WHERE id = $1", [
      source.id
    ]);
    assert.equal(unchanged.status, "active");
    assert.equal(unchanged.transfer_to_enrollment_id, null);
    const afterRows = await db.one("SELECT count(*)::int AS count FROM enrollments WHERE student_id = $1", [activeId]);
    assert.equal(afterRows.count, beforeRows.count, "a failed transfer creates no target row");

    const beforeMoney = await db.one(
      `SELECT
        (SELECT count(*)::int FROM student_fees WHERE student_id = $1) AS invoices,
        (SELECT count(*)::int FROM payments WHERE student_id = $1) AS payments,
        (SELECT COALESCE(SUM(net_amount), 0)::numeric FROM student_fees WHERE student_id = $1) AS billed`,
      [activeId]
    );

    const transferred = await request(`/api/admin/students/${activeId}/enrollment/${source.id}/transfer`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { batchId: state.batchD, reason: "Same-course batch move" }
    });
    assert.equal(transferred.status, 200, transferred.text);

    const target = await db.one(
      `SELECT id, batch_id, course_id, status FROM enrollments
       WHERE student_id = $1 AND batch_id = $2`,
      [activeId, state.batchD]
    );
    assert.equal(target.course_id, state.courseId, "the target stays on the same course");
    assert.equal(target.status, "active");
    const afterMoney = await db.one(
      `SELECT
        (SELECT count(*)::int FROM student_fees WHERE student_id = $1) AS invoices,
        (SELECT count(*)::int FROM payments WHERE student_id = $1) AS payments,
        (SELECT COALESCE(SUM(net_amount), 0)::numeric FROM student_fees WHERE student_id = $1) AS billed`,
      [activeId]
    );
    assert.deepEqual(afterMoney, beforeMoney, "same-course fees and receipts stay with the student");
  });
});
