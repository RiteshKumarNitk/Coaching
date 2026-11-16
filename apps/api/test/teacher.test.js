/**
 * Phase 3 teacher workspace: batch scoping, lectures, materials, assignments,
 * submission evaluation and attendance upserts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
// Empty (not deleted) so dotenv cannot inject the real Neon database.
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
  teacherCookie: "",
  otherTeacherCookie: "",
  studentCookie: "",
  adminCookie: "",
  batchId: "",
  subjectId: "",
  lessonId: "",
  assignmentId: "",
  studentId: ""
};

async function createUser({ email, password, role, fullName }) {
  const { rows } = await db.query(
    "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
    [email, hashPassword(password), fullName]
  );
  const id = rows[0].id;
  await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [id, role]);
  if (role === "teacher") {
    await db.query("INSERT INTO teacher_profiles (user_id, employee_code) VALUES ($1, $2)", [id, `EMP-${email}`]);
  }
  if (role === "student") {
    await db.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, $2)", [id, `ENR-${email}`]);
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-teacher-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction(async (tx) => tx.exec(sql));
  }

  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });
  await createUser({ email: "teacher@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher One" });
  await createUser({ email: "other.teacher@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher Two" });
  state.studentId = await createUser({
    email: "student@test.local",
    password: "StudentPass123",
    role: "student",
    fullName: "Student One"
  });

  const course = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('TCH-1', 'Teacher Course', 12) RETURNING id"
  );
  const courseId = course.rows[0].id;
  const subject = await db.query("INSERT INTO subjects (code, name) VALUES ('TS1', 'Test Subject') RETURNING id");
  state.subjectId = subject.rows[0].id;
  await db.query("INSERT INTO course_subjects (course_id, subject_id) VALUES ($1, $2)", [courseId, state.subjectId]);
  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'TCH-B1', 'Teacher Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [courseId]
  );
  state.batchId = batch.rows[0].id;
  await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2)", [state.batchId, state.subjectId]);
  await db.query(
    `INSERT INTO batch_teachers (batch_id, teacher_id, subject_id)
     SELECT $1, u.id, $2 FROM users u WHERE u.email = 'teacher@test.local'`,
    [state.batchId, state.subjectId]
  );
  await db.query(
    "INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)",
    [state.studentId, state.batchId, courseId]
  );

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

describe("phase 3 teacher workspace", () => {
  it("signs in the teacher, other teacher, student and admin", async () => {
    const teacher = await login("teacher@test.local", "TeacherPass123");
    assert.equal(teacher.status, 200);
    state.teacherCookie = cookieFrom(teacher);

    const other = await login("other.teacher@test.local", "TeacherPass123");
    state.otherTeacherCookie = cookieFrom(other);

    const student = await login("student@test.local", "StudentPass123");
    state.studentCookie = cookieFrom(student);

    const admin = await login("admin@test.local", "AdminPass123");
    state.adminCookie = cookieFrom(admin);
  });

  it("posts notices only to the teacher's own batch", async () => {
    const created = await request("/api/teacher/announcements", {
      method: "POST",
      cookie: state.teacherCookie,
      body: { title: "Physics test moved", body: "The Physics test moves to Friday.", batchId: state.batchId }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.audience, "batch");

    const list = await request("/api/teacher/announcements", { cookie: state.teacherCookie });
    assert.equal(list.status, 200);
    assert.ok(list.json.items.some((item) => item.id === created.json.id));

    const foreignBatch = await request("/api/teacher/announcements", {
      method: "POST",
      cookie: state.otherTeacherCookie,
      body: { title: "Not mine", body: "Should be refused.", batchId: state.batchId }
    });
    assert.equal(foreignBatch.status, 404);

    const asStudent = await request("/api/teacher/announcements", { cookie: state.studentCookie });
    assert.equal(asStudent.status, 403);
  });

  it("scopes batches to the signed-in teacher", async () => {
    const mine = await request("/api/teacher/batches", { cookie: state.teacherCookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.items.length, 1);
    assert.equal(mine.json.items[0].code, "TCH-B1");

    const other = await request("/api/teacher/batches", { cookie: state.otherTeacherCookie });
    assert.equal(other.status, 200);
    assert.equal(other.json.items.length, 0);

    const forbidden = await request(`/api/teacher/batches/${state.batchId}`, { cookie: state.otherTeacherCookie });
    assert.equal(forbidden.status, 404);

    const asStudent = await request("/api/teacher/batches", { cookie: state.studentCookie });
    assert.equal(asStudent.status, 403);

    const detail = await request(`/api/teacher/batches/${state.batchId}`, { cookie: state.teacherCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.students.length, 1);
    assert.equal(detail.json.subjects[0].name, "Test Subject");
  });

  it("creates, updates and deletes a lecture", async () => {
    const created = await request(`/api/teacher/batches/${state.batchId}/lessons`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: {
        subjectId: state.subjectId,
        title: "Kinematics — introduction",
        chapter: "Kinematics",
        youtubeVideoId: "dQw4w9WgXcQ",
        durationMinutes: 42,
        status: "published"
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.youtubeVideoId, "dQw4w9WgXcQ");
    state.lessonId = created.json.id;

    const list = await request(`/api/teacher/batches/${state.batchId}/lessons?page=1&pageSize=10`, {
      cookie: state.teacherCookie
    });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 1);
    assert.equal(list.json.items[0].subjectName, "Test Subject");

    const updated = await request(`/api/teacher/lessons/${state.lessonId}`, {
      method: "PATCH",
      cookie: state.teacherCookie,
      body: { title: "Kinematics — revised", status: "draft" }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.status, "draft");

    const wrongSubject = await request(`/api/teacher/batches/${state.batchId}/lessons`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: { subjectId: "00000000-0000-0000-0000-000000000000", title: "Bad lecture" }
    });
    assert.equal(wrongSubject.status, 400);

    const otherTeacherWrite = await request(`/api/teacher/lessons/${state.lessonId}`, {
      method: "PATCH",
      cookie: state.otherTeacherCookie,
      body: { title: "Hijacked" }
    });
    assert.equal(otherTeacherWrite.status, 404);

    const deleted = await request(`/api/teacher/lessons/${state.lessonId}`, {
      method: "DELETE",
      cookie: state.teacherCookie
    });
    assert.equal(deleted.status, 200);
    const afterDelete = await request(`/api/teacher/batches/${state.batchId}/lessons`, { cookie: state.teacherCookie });
    assert.equal(afterDelete.json.total, 0);
  });

  it("rejects non-https study material links", async () => {
    const bad = await request(`/api/teacher/batches/${state.batchId}/materials`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: { subjectId: state.subjectId, title: "Notes", driveUrl: "ftp://example.com/file.pdf" }
    });
    assert.equal(bad.status, 400);

    const good = await request(`/api/teacher/batches/${state.batchId}/materials`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: {
        subjectId: state.subjectId,
        title: "Chapter 3 notes",
        kind: "notes",
        driveUrl: "https://drive.google.com/file/d/abc/view"
      }
    });
    assert.equal(good.status, 201);

    const list = await request(`/api/teacher/batches/${state.batchId}/materials`, { cookie: state.teacherCookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 1);
    assert.equal(list.json.items[0].kind, "notes");
  });

  it("creates an assignment and evaluates a submission", async () => {
    const created = await request(`/api/teacher/batches/${state.batchId}/assignments`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: {
        subjectId: state.subjectId,
        title: "Problem set 1",
        instructions: "Solve questions 1-10",
        maxMarks: 20
      }
    });
    assert.equal(created.status, 201);
    state.assignmentId = created.json.id;

    const inserted = await db.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content_text)
       VALUES ($1, $2, 'My answers') RETURNING id`,
      [state.assignmentId, state.studentId]
    );
    const submissionId = inserted.rows[0].id;

    const detail = await request(`/api/teacher/assignments/${state.assignmentId}`, { cookie: state.teacherCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.submissions.length, 1);
    assert.equal(detail.json.submissions[0].status, "submitted");

    const tooMany = await request(`/api/teacher/submissions/${submissionId}`, {
      method: "PATCH",
      cookie: state.teacherCookie,
      body: { marksAwarded: 25 }
    });
    assert.equal(tooMany.status, 400);

    const evaluated = await request(`/api/teacher/submissions/${submissionId}`, {
      method: "PATCH",
      cookie: state.teacherCookie,
      body: { marksAwarded: 18, feedback: "Good work" }
    });
    assert.equal(evaluated.status, 200);

    const afterEval = await request(`/api/teacher/assignments/${state.assignmentId}`, { cookie: state.teacherCookie });
    assert.equal(afterEval.json.submissions[0].status, "evaluated");
    assert.equal(afterEval.json.submissions[0].marksAwarded, 18);
  });

  it("marks attendance and updates it on re-save", async () => {
    const saved = await request(`/api/teacher/batches/${state.batchId}/attendance`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: { date: "2026-11-12", records: [{ studentId: state.studentId, status: "present" }] }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.students[0].status, "present");

    const read = await request(`/api/teacher/batches/${state.batchId}/attendance?date=2026-11-12`, {
      cookie: state.teacherCookie
    });
    assert.equal(read.status, 200);
    assert.equal(read.json.markedCount, 1);

    const resaved = await request(`/api/teacher/batches/${state.batchId}/attendance`, {
      method: "POST",
      cookie: state.teacherCookie,
      body: { date: "2026-11-12", records: [{ studentId: state.studentId, status: "late", notes: "Bus delay" }] }
    });
    assert.equal(resaved.status, 200);
    assert.equal(resaved.json.students[0].status, "late");

    const rows = await db.query("SELECT count(*)::int AS count FROM attendance WHERE batch_id = $1", [state.batchId]);
    assert.equal(rows.rows[0].count, 1, "re-saving must upsert, not duplicate");

    const outsider = await request(`/api/teacher/batches/${state.batchId}/attendance`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { date: "2026-11-12", records: [{ studentId: state.studentId, status: "present" }] }
    });
    assert.equal(outsider.status, 403);
  });

  it("lets an admin use the same workspace", async () => {
    const batches = await request("/api/teacher/batches", { cookie: state.adminCookie });
    assert.equal(batches.status, 200);
    assert.ok(batches.json.items.some((batch) => batch.id === state.batchId));
  });
});
