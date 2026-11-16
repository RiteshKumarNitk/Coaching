/**
 * Phase 5 examinations: exam creation, question bank with private answer keys,
 * secure student attempts, autosave, auto + manual evaluation, result publishing.
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
  teacherCookie: "",
  otherTeacherCookie: "",
  studentCookie: "",
  outsiderCookie: "",
  batchId: "",
  otherBatchId: "",
  subjectId: "",
  studentId: "",
  examId: "",
  mcqId: "",
  subjectiveId: "",
  wrongOptionId: "",
  attemptId: "",
  subjectiveResponseId: ""
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
  return request("/api/auth/login", { method: "POST", body: { email, password } });
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-exams-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction(async (tx) => tx.exec(sql));
  }

  state.studentId = await createUser({
    email: "student@test.local",
    password: "StudentPass123",
    role: "student",
    fullName: "Student One"
  });
  const outsiderId = await createUser({
    email: "outsider@test.local",
    password: "StudentPass123",
    role: "student",
    fullName: "Student Two"
  });
  const teacherId = await createUser({
    email: "teacher@test.local",
    password: "TeacherPass123",
    role: "teacher",
    fullName: "Teacher One"
  });
  await createUser({
    email: "other.teacher@test.local",
    password: "TeacherPass123",
    role: "teacher",
    fullName: "Teacher Two"
  });
  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });

  const course = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('EXM-1', 'Exam Course', 12) RETURNING id"
  );
  const courseId = course.rows[0].id;
  const subject = await db.query("INSERT INTO subjects (code, name) VALUES ('EX1', 'Exam Subject') RETURNING id");
  state.subjectId = subject.rows[0].id;
  await db.query("INSERT INTO course_subjects (course_id, subject_id) VALUES ($1, $2)", [courseId, state.subjectId]);

  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'EXM-B1', 'Exam Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [courseId]
  );
  state.batchId = batch.rows[0].id;
  await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2)", [state.batchId, state.subjectId]);
  const otherBatch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'EXM-B2', 'Other Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [courseId]
  );
  state.otherBatchId = otherBatch.rows[0].id;
  await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2)", [
    state.otherBatchId,
    state.subjectId
  ]);
  await db.query("INSERT INTO batch_teachers (batch_id, teacher_id, subject_id) VALUES ($1, $2, $3)", [
    state.batchId,
    teacherId,
    state.subjectId
  ]);
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    state.studentId,
    state.batchId,
    courseId
  ]);
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    outsiderId,
    state.batchId,
    courseId
  ]);
  // The outsider is enrolled in the same batch but on its own course enrolment row.

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("phase 5 examinations", () => {
  it("signs in admin, teachers and students", async () => {
    const admin = await login("admin@test.local", "AdminPass123");
    assert.equal(admin.status, 200);
    state.adminCookie = cookieFrom(admin);

    const teacher = await login("teacher@test.local", "TeacherPass123");
    state.teacherCookie = cookieFrom(teacher);

    const other = await login("other.teacher@test.local", "TeacherPass123");
    state.otherTeacherCookie = cookieFrom(other);

    const student = await login("student@test.local", "StudentPass123");
    state.studentCookie = cookieFrom(student);

    const outsider = await login("outsider@test.local", "StudentPass123");
    state.outsiderCookie = cookieFrom(outsider);
  });

  it("creates an exam and a question bank with a private key", async () => {
    const created = await request("/api/admin/exams", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        batchId: state.batchId,
        subjectId: state.subjectId,
        title: "Unit Test 1",
        examType: "mixed",
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 7200_000).toISOString(),
        durationMinutes: 60,
        passMarks: 2,
        maxAttempts: 2,
        shuffleQuestions: false,
        status: "published"
      }
    });
    assert.equal(created.status, 201, created.text);
    state.examId = created.json.exam.id;
    assert.equal(created.json.exam.status, "published");

    const mcq = await request(`/api/admin/exams/${state.examId}/questions`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        questionType: "mcq",
        questionText: "What is 2 + 2?",
        marks: 2,
        negativeMarks: 0.5,
        options: [
          { text: "3", isCorrect: false },
          { text: "4", isCorrect: true },
          { text: "5", isCorrect: false }
        ]
      }
    });
    assert.equal(mcq.status, 201, mcq.text);
    const mcqQuestion = mcq.json.questions.find((question) => question.questionType === "mcq");
    state.mcqId = mcqQuestion.id;
    state.wrongOptionId = mcqQuestion.options.find((option) => option.id !== mcqQuestion.correctOptionId).id;

    const subjective = await request(`/api/admin/exams/${state.examId}/questions`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        questionType: "subjective",
        questionText: "Explain Newton's second law.",
        marks: 5,
        modelAnswer: "F = ma"
      }
    });
    assert.equal(subjective.status, 201, subjective.text);
    state.subjectiveId = subjective.json.questions.find((question) => question.questionType === "subjective").id;
    assert.equal(subjective.json.exam.totalMarks, 7);

    const invalid = await request(`/api/admin/exams/${state.examId}/questions`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        questionType: "mcq",
        questionText: "Broken question",
        marks: 1,
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: true }
        ]
      }
    });
    assert.equal(invalid.status, 400);

    const otherTeacher = await request(`/api/teacher/exams/${state.examId}`, { cookie: state.otherTeacherCookie });
    assert.equal(otherTeacher.status, 404);

    const assigned = await request(`/api/teacher/exams/${state.examId}`, { cookie: state.teacherCookie });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.json.questions.length, 2);

    const teacherExamBody = {
      title: "Teacher draft",
      examType: "mcq",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 172_800_000).toISOString(),
      durationMinutes: 30,
      passMarks: 1,
      maxAttempts: 1,
      shuffleQuestions: false,
      status: "draft"
    };

    const ownBatch = await request("/api/teacher/exams", {
      method: "POST",
      cookie: state.teacherCookie,
      body: { ...teacherExamBody, batchId: state.batchId }
    });
    assert.equal(ownBatch.status, 201, ownBatch.text);
    assert.equal(ownBatch.json.exam.status, "draft");

    const foreignBatch = await request("/api/teacher/exams", {
      method: "POST",
      cookie: state.teacherCookie,
      body: { ...teacherExamBody, batchId: state.otherBatchId }
    });
    assert.equal(foreignBatch.status, 404, "teachers cannot create exams for other batches");

    const otherBatchExam = await request("/api/admin/exams", {
      method: "POST",
      cookie: state.adminCookie,
      body: { ...teacherExamBody, title: "Other batch draft", batchId: state.otherBatchId }
    });
    assert.equal(otherBatchExam.status, 201, otherBatchExam.text);

    const teacherList = await request("/api/teacher/exams", { cookie: state.teacherCookie });
    assert.equal(teacherList.status, 200);
    assert.ok(teacherList.json.items.some((exam) => exam.id === ownBatch.json.exam.id));
    assert.ok(!teacherList.json.items.some((exam) => exam.id === otherBatchExam.json.exam.id));
  });

  it("starts a secure attempt without leaking answer keys", async () => {
    const exams = await request("/api/student/exams", { cookie: state.studentCookie });
    assert.equal(exams.status, 200);
    assert.equal(exams.json.items.length, 1);
    assert.equal(exams.json.items[0].canStart, true);

    const started = await request(`/api/student/exams/${state.examId}/attempts`, {
      method: "POST",
      cookie: state.studentCookie
    });
    assert.equal(started.status, 201, started.text);
    state.attemptId = started.json.attempt.id;
    assert.equal(started.json.attempt.status, "in_progress");
    assert.ok(started.json.attempt.remainingSeconds > 0);
    for (const question of started.json.questions) {
      assert.equal(question.correctOptionId, undefined);
      assert.equal(question.modelAnswer, undefined);
    }
    assert.equal(started.json.questions.length, 2);

    const saved = await request(`/api/student/attempts/${state.attemptId}/answers`, {
      method: "PATCH",
      cookie: state.studentCookie,
      body: {
        answers: [
          { questionId: state.mcqId, selectedOptionId: state.wrongOptionId, markedForReview: false },
          { questionId: state.subjectiveId, answerText: "Force equals mass times acceleration." }
        ]
      }
    });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.saved, 2);

    const reload = await request(`/api/student/attempts/${state.attemptId}`, { cookie: state.studentCookie });
    assert.equal(reload.status, 200);
    assert.equal(reload.json.responses.length, 2);

    const foreign = await request(`/api/student/attempts/${state.attemptId}`, { cookie: state.outsiderCookie });
    assert.equal(foreign.status, 404);
  });

  it("auto-grades MCQs, waits for subjective evaluation, then publishes", async () => {
    const submitted = await request(`/api/student/attempts/${state.attemptId}/submit`, {
      method: "POST",
      cookie: state.studentCookie
    });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.json.pending, true);
    assert.equal(submitted.json.status, "submitted");

    const hidden = await request("/api/student/results", { cookie: state.studentCookie });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.json.total, 0);

    const responses = await request(`/api/teacher/attempts/${state.attemptId}/responses`, {
      cookie: state.teacherCookie
    });
    assert.equal(responses.status, 200);
    const subjective = responses.json.responses.find((row) => row.questionType === "subjective");
    state.subjectiveResponseId = subjective.id;

    const tooMany = await request(`/api/teacher/responses/${state.subjectiveResponseId}`, {
      method: "PATCH",
      cookie: state.teacherCookie,
      body: { awardedMarks: 9 }
    });
    assert.equal(tooMany.status, 400);

    const evaluated = await request(`/api/teacher/responses/${state.subjectiveResponseId}`, {
      method: "PATCH",
      cookie: state.teacherCookie,
      body: { awardedMarks: 4 }
    });
    assert.equal(evaluated.status, 200, evaluated.text);
    assert.equal(evaluated.json.status, "evaluated");
    assert.equal(evaluated.json.score, 3.5, "4 subjective marks minus 0.5 negative marking");

    const outcome = await request(`/api/admin/exams/${state.examId}`, { cookie: state.adminCookie });
    assert.equal(outcome.json.results.length, 1);
    assert.equal(outcome.json.results[0].status, "pass");
    assert.equal(outcome.json.results[0].publishedAt, null);

    const publish = await request(`/api/admin/exams/${state.examId}/publish-results`, {
      method: "POST",
      cookie: state.adminCookie
    });
    assert.equal(publish.status, 200, publish.text);
    assert.equal(publish.json.exam.resultsPublished, true);

    const results = await request("/api/student/results", { cookie: state.studentCookie });
    assert.equal(results.json.total, 1);
    assert.equal(results.json.items[0].obtainedMarks, 3.5);
    assert.equal(results.json.items[0].totalMarks, 7);

    const exams = await request("/api/student/exams", { cookie: state.studentCookie });
    assert.equal(exams.json.items[0].result.status, "pass");
    assert.equal(exams.json.items[0].canStart, true, "a second attempt is allowed");

    const studentOnAdmin = await request("/api/admin/exams", { cookie: state.studentCookie });
    assert.equal(studentOnAdmin.status, 403);
    const adminOnStudent = await request("/api/student/exams", { cookie: state.adminCookie });
    assert.equal(adminOnStudent.status, 403);
  });

  it("refuses to publish an empty exam and to delete one with attempts", async () => {
    const draft = await request("/api/admin/exams", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        batchId: state.batchId,
        title: "Empty exam",
        startsAt: new Date(Date.now() - 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        durationMinutes: 30,
        status: "draft"
      }
    });
    assert.equal(draft.status, 201, draft.text);

    const publishEmpty = await request(`/api/admin/exams/${draft.json.exam.id}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { status: "published" }
    });
    assert.equal(publishEmpty.status, 400, publishEmpty.text);

    const del = await request(`/api/admin/exams/${state.examId}`, {
      method: "DELETE",
      cookie: state.adminCookie
    });
    assert.equal(del.status, 409, del.text);
  });
});
