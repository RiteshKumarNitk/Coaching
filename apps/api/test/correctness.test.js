/**
 * Correctness milestone: payment idempotency and exam integrity/reliability.
 *
 * Covers concurrent duplicate payments, changed-payload retries, overpayment,
 * parallel starts/submits, paper edits during active attempts, autosaves after
 * submission and grading recovery after a simulated crash.
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
  studentACookie: "",
  studentBCookie: "",
  guardianCookie: "",
  teacherACookie: "",
  teacherBCookie: "",
  studentAId: "",
  studentBId: "",
  courseId: "",
  batchId: ""
};

async function createUser({ email, password, role, fullName }) {
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
    [email, hashPassword(password), fullName]
  );
  const id = rows[0].id;
  await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [id, role]);
  if (role === "student") {
    await db.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, $2)", [id, `ENR-${email}`]);
  }
  if (role === "teacher") {
    await db.query("INSERT INTO teacher_profiles (user_id, employee_code) VALUES ($1, $2)", [id, `EMP-${email}`]);
  }
  return id;
}

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

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-correctness-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }

  state.studentAId = await createUser({ email: "a@test.local", password: "StudentPass123", role: "student", fullName: "Student A" });
  state.studentBId = await createUser({ email: "b@test.local", password: "StudentPass123", role: "student", fullName: "Student B" });
  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });
  const guardianId = await createUser({
    email: "guardian@test.local",
    password: "GuardianPass123",
    role: "guardian",
    fullName: "Student A Guardian"
  });
  await db.query(
    `INSERT INTO guardian_profiles (student_id, user_id, name, relation, email)
     VALUES ($1, $2, 'Student A Guardian', 'father', 'guardian@test.local')`,
    [state.studentAId, guardianId]
  );
  const teacherA = await createUser({ email: "teacher.a@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher A" });
  await createUser({ email: "teacher.b@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher B" });

  const course = await db.query("INSERT INTO courses (code, name, duration_months) VALUES ('COR-1', 'Correctness', 12) RETURNING id");
  state.courseId = course.rows[0].id;
  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'COR-B1', 'Correctness Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [state.courseId]
  );
  state.batchId = batch.rows[0].id;
  for (const studentId of [state.studentAId, state.studentBId]) {
    await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
      studentId,
      state.batchId,
      state.courseId
    ]);
  }
  await db.query("INSERT INTO batch_teachers (batch_id, teacher_id) VALUES ($1, $2)", [state.batchId, teacherA]);

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  state.adminCookie = await login("admin@test.local", "AdminPass123");
  state.studentACookie = await login("a@test.local", "StudentPass123");
  state.studentBCookie = await login("b@test.local", "StudentPass123");
  state.guardianCookie = await login("guardian@test.local", "GuardianPass123");
  state.teacherACookie = await login("teacher.a@test.local", "TeacherPass123");
  state.teacherBCookie = await login("teacher.b@test.local", "TeacherPass123");
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

let structureSeq = 0;
async function makeFee(studentId, totalAmount) {
  structureSeq += 1;
  const structure = await request("/api/admin/fees/structures", {
    method: "POST",
    cookie: state.adminCookie,
    body: {
      courseId: state.courseId,
      name: `Structure ${structureSeq}`,
      academicYear: `2026-${String(27 + structureSeq)}`,
      totalAmount,
      installments: 1
    }
  });
  assert.equal(structure.status, 201, structure.text);
  const fee = await request("/api/admin/fees/assign", {
    method: "POST",
    cookie: state.adminCookie,
    body: { studentId, feeStructureId: structure.json.id }
  });
  assert.equal(fee.status, 201, fee.text);
  return fee.json.id;
}

let examSeq = 0;
async function makeExam({ studentCookieForStart } = {}) {
  examSeq += 1;
  const created = await request("/api/admin/exams", {
    method: "POST",
    cookie: state.adminCookie,
    body: {
      batchId: state.batchId,
      title: `Correctness Exam ${examSeq}`,
      examType: "mcq",
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 7200_000).toISOString(),
      durationMinutes: 60,
      passMarks: 1,
      maxAttempts: 1,
      shuffleQuestions: false,
      status: "published"
    }
  });
  assert.equal(created.status, 201, created.text);
  const examId = created.json.exam.id;

  const added = await request(`/api/admin/exams/${examId}/questions`, {
    method: "POST",
    cookie: state.adminCookie,
    body: {
      questionType: "mcq",
      questionText: "2 + 2 = ?",
      marks: 2,
      negativeMarks: 0,
      options: [
        { text: "4", isCorrect: true },
        { text: "5", isCorrect: false }
      ]
    }
  });
  assert.equal(added.status, 201, added.text);
  const question = added.json.questions[0];
  const correct = question.options.find((option) => option.id === question.correctOptionId);
  const wrong = question.options.find((option) => option.id !== question.correctOptionId);

  let attempt = null;
  if (studentCookieForStart) {
    const started = await request(`/api/student/exams/${examId}/attempts`, {
      method: "POST",
      cookie: studentCookieForStart,
      body: {}
    });
    assert.ok([200, 201].includes(started.status), started.text);
    attempt = started.json.attempt;
  }
  return { examId, questionId: question.id, correctOptionId: correct.id, wrongOptionId: wrong.id, attempt };
}

describe("payment idempotency", () => {
  it("replays the original receipt, rejects a changed payload, keeps summaries current and reverses a void", async () => {
    const feeId = await makeFee(state.studentAId, 10_000);
    const otherFeeId = await makeFee(state.studentBId, 5_000);
    const requestId = "pay-key-replay-0001";
    const body = { amount: 1000, method: "cash", reference: "CASH-1", requestId };
    const before = await request("/api/admin/fees/dues?page=1&pageSize=100", { cookie: state.adminCookie });
    assert.equal(before.status, 200, before.text);

    const first = await request(`/api/admin/fees/${feeId}/payments`, { method: "POST", cookie: state.adminCookie, body });
    assert.equal(first.status, 201, first.text);

    const replay = await request(`/api/admin/fees/${feeId}/payments`, { method: "POST", cookie: state.adminCookie, body });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.json.id, first.json.id);
    assert.equal(replay.json.receiptNo, first.json.receiptNo);
    assert.equal(replay.json.paidAmount, 1000);
    assert.equal(replay.json.replayed, true);

    const afterReplay = await request("/api/admin/fees/dues?page=1&pageSize=100", { cookie: state.adminCookie });
    assert.equal(afterReplay.status, 200, afterReplay.text);
    assert.equal(afterReplay.json.summary.collected - before.json.summary.collected, 1000);
    assert.equal(before.json.summary.pending - afterReplay.json.summary.pending, 1000);
    const paidInvoice = afterReplay.json.items.find((row) => row.id === feeId);
    assert.equal(paidInvoice.paidAmount, 1000);
    assert.equal(paidInvoice.pendingAmount, 9000);
    assert.equal(paidInvoice.status, "partial");

    const changedAmount = await request(`/api/admin/fees/${feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { ...body, amount: 1200 }
    });
    assert.equal(changedAmount.status, 409);

    const changedMethod = await request(`/api/admin/fees/${feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { ...body, method: "upi" }
    });
    assert.equal(changedMethod.status, 409);

    const otherInvoice = await request(`/api/admin/fees/${otherFeeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body
    });
    assert.equal(otherInvoice.status, 409);

    const overpay = await request(`/api/admin/fees/${feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { amount: 99_999, method: "cash", requestId: "pay-key-overpay-01" }
    });
    assert.equal(overpay.status, 400);

    const count = await db.one("SELECT count(*)::int AS count FROM payments WHERE student_fee_id = $1", [feeId]);
    assert.equal(count.count, 1);
    const pending = await db.one("SELECT status FROM student_fees WHERE id = $1", [feeId]);
    assert.equal(pending.status, "partial");

    const voided = await request(`/api/admin/fees/payments/${first.json.id}/void`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "Cheque bounced in the drill" }
    });
    assert.equal(voided.status, 200, voided.text);
    assert.equal(voided.json.paidAmount, 0);
    assert.equal(voided.json.pendingAmount, 10_000);

    const afterVoid = await request("/api/admin/fees/dues?page=1&pageSize=100", { cookie: state.adminCookie });
    assert.equal(afterVoid.status, 200, afterVoid.text);
    assert.equal(afterVoid.json.summary.collected, before.json.summary.collected);
    assert.equal(afterVoid.json.summary.pending, before.json.summary.pending);
    const reopened = afterVoid.json.items.find((row) => row.id === feeId);
    assert.equal(reopened.paidAmount, 0);
    assert.equal(reopened.pendingAmount, 10_000);
    assert.equal(reopened.status, "pending");

    const receipts = await request("/api/admin/fees/payments?page=1&pageSize=100", { cookie: state.adminCookie });
    assert.equal(receipts.status, 200, receipts.text);
    assert.ok(receipts.json.items.find((row) => row.id === first.json.id)?.voidedAt);
  });

  it("creates exactly one receipt for parallel retries with the same key", async () => {
    const feeId = await makeFee(state.studentAId, 5000);
    const body = { amount: 500, method: "upi", reference: "UPI-9", requestId: "pay-key-parallel-001" };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(`/api/admin/fees/${feeId}/payments`, { method: "POST", cookie: state.adminCookie, body })
      )
    );
    for (const response of responses) assert.ok([200, 201].includes(response.status), response.text);
    assert.equal(new Set(responses.map((response) => response.json.id)).size, 1);
    const rows = await db.one("SELECT count(*)::int AS count, sum(amount)::numeric AS total FROM payments WHERE student_fee_id = $1", [feeId]);
    assert.equal(rows.count, 1);
    assert.equal(Number(rows.total), 500);
  });

  it("keeps the invoice lock so two different keys cannot overpay together", async () => {
    const feeId = await makeFee(state.studentBId, 3000);
    const responses = await Promise.all([
      request(`/api/admin/fees/${feeId}/payments`, {
        method: "POST",
        cookie: state.adminCookie,
        body: { amount: 3000, method: "cash", requestId: "pay-key-race-a-01" }
      }),
      request(`/api/admin/fees/${feeId}/payments`, {
        method: "POST",
        cookie: state.adminCookie,
        body: { amount: 3000, method: "cash", requestId: "pay-key-race-b-01" }
      })
    ]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 400]);
    const rows = await db.one("SELECT count(*)::int AS count, sum(amount)::numeric AS total FROM payments WHERE student_fee_id = $1", [feeId]);
    assert.equal(rows.count, 1);
    assert.equal(Number(rows.total), 3000);
  });
});

describe("exam integrity", () => {
  it("freezes questions, keys, timing and marking once an attempt exists, and duplicates the paper", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });

    const add = await request(`/api/admin/exams/${exam.examId}/questions`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { questionText: "New question", marks: 1, options: [{ text: "A", isCorrect: true }, { text: "B" }] }
    });
    assert.equal(add.status, 409, add.text);

    const edit = await request(`/api/admin/questions/${exam.questionId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { questionText: "Changed under the student", options: [{ text: "6", isCorrect: true }, { text: "7" }] }
    });
    assert.equal(edit.status, 409, edit.text);

    const remove = await request(`/api/admin/questions/${exam.questionId}`, {
      method: "DELETE",
      cookie: state.adminCookie
    });
    assert.equal(remove.status, 409, remove.text);

    const retime = await request(`/api/admin/exams/${exam.examId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { durationMinutes: 20, passMarks: 0 }
    });
    assert.equal(retime.status, 409, retime.text);

    const rename = await request(`/api/admin/exams/${exam.examId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { title: "Renamed after start" }
    });
    assert.equal(rename.status, 200, rename.text);

    // Re-sending the unchanged timing/marking (a full edit form) is not a change.
    const samePaper = await request(`/api/admin/exams/${exam.examId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { durationMinutes: 60, passMarks: 1, maxAttempts: 1 }
    });
    assert.equal(samePaper.status, 200, samePaper.text);

    const duplicated = await request(`/api/admin/exams/${exam.examId}/duplicate`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {}
    });
    assert.equal(duplicated.status, 201, duplicated.text);
    assert.equal(duplicated.json.exam.status, "draft");
    assert.equal(duplicated.json.exam.resultsPublished, false);
    assert.equal(duplicated.json.questions.length, 1);
    const copied = duplicated.json.questions[0];
    assert.equal(copied.questionText, "2 + 2 = ?");
    assert.ok(copied.correctOptionId);
    assert.notEqual(copied.correctOptionId, exam.correctOptionId);

    const editCopy = await request(`/api/admin/questions/${copied.id}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { questionText: "2 + 3 = ?" }
    });
    assert.equal(editCopy.status, 200, editCopy.text);
  });
});

describe("exam reliability", () => {
  it("returns one attempt for parallel starts", async () => {
    const exam = await makeExam();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(`/api/student/exams/${exam.examId}/attempts`, { method: "POST", cookie: state.studentBCookie, body: {} })
      )
    );
    for (const response of responses) assert.ok([200, 201].includes(response.status), response.text);
    assert.equal(new Set(responses.map((response) => response.json.attempt.id)).size, 1);
    const rows = await db.one("SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1", [exam.examId]);
    assert.equal(rows.count, 1);
  });

  it("returns the same graded result for parallel and repeated submits, and refuses later autosaves", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });
    const attemptId = exam.attempt.id;

    const saved = await request(`/api/student/attempts/${attemptId}/answers`, {
      method: "PATCH",
      cookie: state.studentACookie,
      body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.correctOptionId }] }
    });
    assert.equal(saved.status, 200, saved.text);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(`/api/student/attempts/${attemptId}/submit`, { method: "POST", cookie: state.studentACookie, body: {} })
      )
    );
    for (const response of responses) assert.equal(response.status, 200, response.text);
    assert.equal(new Set(responses.map((response) => response.json.attemptId)).size, 1);
    for (const response of responses) {
      assert.equal(response.json.resultsPublished, false);
      assert.equal("score" in response.json, false);
    }
    const storedScore = await db.one("SELECT score FROM exam_attempts WHERE id = $1", [attemptId]);
    assert.equal(Number(storedScore.score), 2);

    const repeated = await request(`/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      cookie: state.studentACookie,
      body: {}
    });
    assert.equal(repeated.status, 200, repeated.text);
    assert.equal(repeated.json.resultsPublished, false);
    assert.equal("score" in repeated.json, false);

    const lateSave = await request(`/api/student/attempts/${attemptId}/answers`, {
      method: "PATCH",
      cookie: state.studentACookie,
      body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.wrongOptionId }] }
    });
    assert.equal(lateSave.status, 400, lateSave.text);

    const detail = await request(`/api/student/attempts/${attemptId}`, { cookie: state.studentACookie });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.attempt.resultsPublished, false);
    assert.equal(detail.json.attempt.score, null);
    assert.equal(detail.json.responses[0].selectedOptionId, exam.correctOptionId);
    assert.equal("awardedMarks" in detail.json.responses[0], false);

    const results = await db.one("SELECT count(*)::int AS count FROM exam_results WHERE exam_id = $1", [exam.examId]);
    assert.equal(results.count, 1);
  });

  it("serialises the first attempt start against a question edit", async () => {
    for (let round = 0; round < 4; round += 1) {
      const exam = await makeExam();
      const [edit, start] = await Promise.all([
        request(`/api/admin/exams/${exam.examId}/questions`, {
          method: "POST",
          cookie: state.adminCookie,
          body: {
            questionText: `Race question ${round}`,
            marks: 1,
            options: [
              { text: "A", isCorrect: true },
              { text: "B" }
            ]
          }
        }),
        request(`/api/student/exams/${exam.examId}/attempts`, {
          method: "POST",
          cookie: state.studentBCookie,
          body: {}
        })
      ]);
      assert.ok([200, 201].includes(start.status), start.text);
      assert.ok([201, 409].includes(edit.status), edit.text);

      const questionCount = await db.one("SELECT count(*)::int AS count FROM exam_questions WHERE exam_id = $1", [
        exam.examId
      ]);
      assert.ok([1, 2].includes(questionCount.count), String(questionCount.count));
      const attempt = await request(`/api/student/attempts/${start.json.attempt.id}`, {
        cookie: state.studentBCookie
      });
      assert.equal(attempt.json.questions.length, questionCount.count, "the attempt sees a whole paper");
      if (questionCount.count === 2) assert.equal(edit.status, 201);
      if (questionCount.count === 1) assert.equal(edit.status, 409);
    }
  });

  it("returns a definitive expiry code and grades the attempt when the server closes it", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });
    await db.query("UPDATE exam_attempts SET expires_at = now() - interval '1 second' WHERE id = $1", [
      exam.attempt.id
    ]);

    const save = await request(`/api/student/attempts/${exam.attempt.id}/answers`, {
      method: "PATCH",
      cookie: state.studentACookie,
      body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.correctOptionId }] }
    });
    assert.equal(save.status, 400, save.text);
    assert.equal(save.json.error.code, "attempt_expired", "the client must be able to stop retrying");

    const reconciled = await request(`/api/student/attempts/${exam.attempt.id}`, {
      cookie: state.studentACookie
    });
    assert.equal(reconciled.status, 200, reconciled.text);
    assert.equal(reconciled.json.attempt.status, "evaluated");
    assert.equal(reconciled.json.attempt.remainingSeconds, 0);
    assert.equal(reconciled.json.attempt.resultsPublished, false);
    assert.equal(reconciled.json.attempt.score, null);

    const stored = await db.one("SELECT score FROM exam_attempts WHERE id = $1", [exam.attempt.id]);
    assert.notEqual(stored.score, null, "expiry still grades the answers already saved");
  });

  it("serialises answer saving against submission", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });
    const attemptId = exam.attempt.id;
    const [save, submit] = await Promise.all([
      request(`/api/student/attempts/${attemptId}/answers`, {
        method: "PATCH",
        cookie: state.studentACookie,
        body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.correctOptionId }] }
      }),
      request(`/api/student/attempts/${attemptId}/submit`, {
        method: "POST",
        cookie: state.studentACookie,
        body: {}
      })
    ]);
    assert.equal(submit.status, 200, submit.text);
    assert.ok([200, 400].includes(save.status), save.text);

    const response = await db.one(
      "SELECT selected_option_id FROM exam_responses WHERE attempt_id = $1 AND question_id = $2",
      [attemptId, exam.questionId]
    );
    assert.equal(submit.json.resultsPublished, false);
    assert.equal("score" in submit.json, false);
    const stored = await db.one("SELECT score FROM exam_attempts WHERE id = $1", [attemptId]);
    if (save.status === 200) {
      assert.equal(response.selected_option_id, exam.correctOptionId);
      assert.equal(Number(stored.score), 2);
    } else {
      assert.equal(response?.selected_option_id ?? null, null);
      assert.equal(Number(stored.score), 0);
    }
  });

  it("refuses duplicate for a teacher outside the source batch", async () => {
    const exam = await makeExam();
    const outsider = await request(`/api/teacher/exams/${exam.examId}/duplicate`, {
      method: "POST",
      cookie: state.teacherBCookie,
      body: {}
    });
    assert.equal(outsider.status, 404, outsider.text);

    const assigned = await request(`/api/teacher/exams/${exam.examId}/duplicate`, {
      method: "POST",
      cookie: state.teacherACookie,
      body: {}
    });
    assert.equal(assigned.status, 201, assigned.text);
    assert.equal(assigned.json.exam.status, "draft");
  });

  it("recovers a crash between submission and grading", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });
    await request(`/api/student/attempts/${exam.attempt.id}/answers`, {
      method: "PATCH",
      cookie: state.studentACookie,
      body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.correctOptionId }] }
    });

    // Simulate the process dying after the status claimed submission but before grading.
    await db.query("UPDATE exam_attempts SET status = 'submitted', submitted_at = now(), score = NULL WHERE id = $1", [
      exam.attempt.id
    ]);

    const recovered = await request(`/api/student/attempts/${exam.attempt.id}`, { cookie: state.studentACookie });
    assert.equal(recovered.status, 200, recovered.text);
    assert.equal(recovered.json.attempt.status, "evaluated");
    assert.equal(recovered.json.attempt.resultsPublished, false);
    assert.equal(recovered.json.attempt.score, null);

    const result = await db.one("SELECT obtained_marks FROM exam_results WHERE attempt_id = $1", [exam.attempt.id]);
    assert.equal(Number(result.obtained_marks), 2);
  });
});

describe("results publication visibility", () => {
  it("hides scores from every student surface until publication, and hides them again after re-evaluation", async () => {
    const exam = await makeExam({ studentCookieForStart: state.studentACookie });
    const attemptId = exam.attempt.id;

    const saved = await request(`/api/student/attempts/${attemptId}/answers`, {
      method: "PATCH",
      cookie: state.studentACookie,
      body: { answers: [{ questionId: exam.questionId, selectedOptionId: exam.correctOptionId }] }
    });
    assert.equal(saved.status, 200, saved.text);

    const submitted = await request(`/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      cookie: state.studentACookie,
      body: {}
    });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.json.resultsPublished, false);
    for (const field of ["score", "totalMarks", "percentage", "status", "resultStatus"]) {
      assert.equal(field in submitted.json, false, `${field} must stay hidden before publication`);
    }

    const retried = await request(`/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      cookie: state.studentACookie,
      body: {}
    });
    assert.equal(retried.status, 200, retried.text);
    assert.equal(retried.json.resultsPublished, false);
    assert.equal("score" in retried.json, false);

    const detail = await request(`/api/student/attempts/${attemptId}`, { cookie: state.studentACookie });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.attempt.resultsPublished, false);
    assert.equal(detail.json.attempt.score, null);
    for (const question of detail.json.questions) {
      assert.equal("correctOptionId" in question, false);
      assert.equal("modelAnswer" in question, false);
      assert.equal("explanation" in question, false);
      for (const option of question.options) assert.equal("isCorrect" in option, false);
    }
    for (const response of detail.json.responses) assert.equal("awardedMarks" in response, false);

    const hiddenResults = await request("/api/student/results", { cookie: state.studentACookie });
    assert.equal(hiddenResults.status, 200, hiddenResults.text);
    assert.equal(hiddenResults.json.total, 0);

    const hiddenGuardian = await request(`/api/guardian/children/${state.studentAId}/results`, {
      cookie: state.guardianCookie
    });
    assert.equal(hiddenGuardian.status, 200, hiddenGuardian.text);
    assert.equal(hiddenGuardian.json.total, 0);

    const staff = await request(`/api/admin/exams/${exam.examId}`, { cookie: state.adminCookie });
    assert.equal(staff.status, 200, staff.text);
    assert.equal(staff.json.attempts[0].score, 2, "authorized staff keep score access");
    assert.equal(staff.json.questions[0].correctOptionId, exam.correctOptionId);

    const publish = await request(`/api/admin/exams/${exam.examId}/publish-results`, {
      method: "POST",
      cookie: state.adminCookie
    });
    assert.equal(publish.status, 200, publish.text);
    assert.equal(publish.json.exam.resultsPublished, true);

    const publishedDetail = await request(`/api/student/attempts/${attemptId}`, { cookie: state.studentACookie });
    assert.equal(publishedDetail.json.attempt.resultsPublished, true);
    assert.equal(publishedDetail.json.attempt.score, 2);

    const publishedResults = await request("/api/student/results", { cookie: state.studentACookie });
    assert.equal(publishedResults.json.total, 1);
    assert.equal(publishedResults.json.items[0].obtainedMarks, 2);

    const publishedGuardian = await request(`/api/guardian/children/${state.studentAId}/results`, {
      cookie: state.guardianCookie
    });
    assert.equal(publishedGuardian.json.total, 1);

    const publishedRetry = await request(`/api/student/attempts/${attemptId}/submit`, {
      method: "POST",
      cookie: state.studentACookie,
      body: {}
    });
    assert.equal(publishedRetry.json.resultsPublished, true);
    assert.equal(publishedRetry.json.score, 2);

    const responses = await request(`/api/teacher/attempts/${attemptId}/responses`, {
      cookie: state.teacherACookie
    });
    assert.equal(responses.status, 200, responses.text);
    const reEvaluated = await request(`/api/teacher/responses/${responses.json.responses[0].id}`, {
      method: "PATCH",
      cookie: state.teacherACookie,
      body: { awardedMarks: 0 }
    });
    assert.equal(reEvaluated.status, 200, reEvaluated.text);

    const flags = await db.one(
      `SELECT e.results_published, r.published_at FROM exams e
       JOIN exam_results r ON r.exam_id = e.id WHERE e.id = $1`,
      [exam.examId]
    );
    assert.equal(flags.results_published, false);
    assert.equal(flags.published_at, null);

    const hiddenAgain = await request(`/api/student/attempts/${attemptId}`, { cookie: state.studentACookie });
    assert.equal(hiddenAgain.json.attempt.resultsPublished, false);
    assert.equal(hiddenAgain.json.attempt.score, null);

    const resultsAgain = await request("/api/student/results", { cookie: state.studentACookie });
    assert.equal(resultsAgain.json.total, 0);
    const guardianAgain = await request(`/api/guardian/children/${state.studentAId}/results`, {
      cookie: state.guardianCookie
    });
    assert.equal(guardianAgain.json.total, 0);
  });
});
