/**
 * Phase 4 student app: courses, lecture player progress, notes, assignments,
 * attendance history and announcements — all scoped to the student's enrolment.
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
  studentCookie: "",
  outsiderCookie: "",
  teacherCookie: "",
  adminCookie: "",
  batchId: "",
  otherBatchId: "",
  courseId: "",
  subjectId: "",
  lessonId: "",
  secondLessonId: "",
  draftLessonId: "",
  otherLessonId: "",
  assignmentId: "",
  lateAssignmentId: "",
  closedAssignmentId: ""
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-student-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction(async (tx) => tx.exec(sql));
  }

  const studentId = await createUser({
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
  await createUser({ email: "teacher@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher One" });
  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });

  const course = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('STU-1', 'Student Course', 12) RETURNING id"
  );
  state.courseId = course.rows[0].id;
  const subject = await db.query("INSERT INTO subjects (code, name) VALUES ('SS1', 'Student Subject') RETURNING id");
  state.subjectId = subject.rows[0].id;
  await db.query("INSERT INTO course_subjects (course_id, subject_id) VALUES ($1, $2)", [state.courseId, state.subjectId]);

  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'STU-B1', 'Student Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [state.courseId]
  );
  state.batchId = batch.rows[0].id;
  const otherBatch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'STU-B2', 'Other Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [state.courseId]
  );
  state.otherBatchId = otherBatch.rows[0].id;
  for (const batchId of [state.batchId, state.otherBatchId]) {
    await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2)", [batchId, state.subjectId]);
  }
  state.nextClassDate = (
    await db.query("SELECT to_char(institute_today() + 1, 'YYYY-MM-DD') AS date")
  ).rows[0].date;
  await db.query(
    `INSERT INTO batch_schedules (batch_id, subject_id, day_of_week, start_time, end_time, room)
     VALUES ($1, $2, EXTRACT(DOW FROM institute_today() + 1)::int, '09:00', '10:00', 'Room 4')`,
    [state.batchId, state.subjectId]
  );

  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    studentId,
    state.batchId,
    state.courseId
  ]);
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    outsiderId,
    state.otherBatchId,
    state.courseId
  ]);

  const lesson = await db.query(
    `INSERT INTO lessons (batch_id, subject_id, title, chapter, youtube_video_id, duration_minutes, status, published_at)
     VALUES ($1, $2, 'Published lecture', 'Kinematics', 'dQw4w9WgXcQ', 20, 'published', now()) RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.lessonId = lesson.rows[0].id;
  const secondLesson = await db.query(
    `INSERT INTO lessons (batch_id, subject_id, title, chapter, duration_minutes, sort_order, status, published_at)
     VALUES ($1, $2, 'Reading and notes', 'Revision', 10, 1, 'published', now()) RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.secondLessonId = secondLesson.rows[0].id;
  const draft = await db.query(
    `INSERT INTO lessons (batch_id, subject_id, title, status) VALUES ($1, $2, 'Draft lecture', 'draft') RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.draftLessonId = draft.rows[0].id;
  const otherLesson = await db.query(
    `INSERT INTO lessons (batch_id, subject_id, title, status, published_at)
     VALUES ($1, $2, 'Other batch lecture', 'published', now()) RETURNING id`,
    [state.otherBatchId, state.subjectId]
  );
  state.otherLessonId = otherLesson.rows[0].id;

  await db.query(
    `INSERT INTO study_materials (batch_id, subject_id, title, kind, drive_url, status)
     VALUES ($1, $2, 'Published notes', 'notes', 'https://drive.google.com/file/d/abc/view', 'published')`,
    [state.batchId, state.subjectId]
  );
  await db.query(
    `INSERT INTO study_materials (batch_id, subject_id, title, kind, drive_url, status)
     VALUES ($1, $2, 'Draft notes', 'notes', 'https://drive.google.com/file/d/def/view', 'draft')`,
    [state.batchId, state.subjectId]
  );

  const assignment = await db.query(
    `INSERT INTO assignments (batch_id, subject_id, title, instructions, due_at, max_marks, status)
     VALUES ($1, $2, 'Open problem set', 'Solve 1-5', now() + interval '5 days', 20, 'published') RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.assignmentId = assignment.rows[0].id;
  const late = await db.query(
    `INSERT INTO assignments (batch_id, subject_id, title, due_at, max_marks, status)
     VALUES ($1, $2, 'Past due set', now() - interval '2 days', 10, 'published') RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.lateAssignmentId = late.rows[0].id;
  const closed = await db.query(
    `INSERT INTO assignments (batch_id, subject_id, title, max_marks, status)
     VALUES ($1, $2, 'Closed set', 10, 'closed') RETURNING id`,
    [state.batchId, state.subjectId]
  );
  state.closedAssignmentId = closed.rows[0].id;

  await db.query(
    `INSERT INTO attendance (batch_id, student_id, session_date, status)
     VALUES ($1, $2, '2026-11-10', 'present'), ($1, $2, '2026-11-11', 'absent')`,
    [state.batchId, studentId]
  );

  await db.query(
    `INSERT INTO announcements (title, body, audience, published_at) VALUES ('All notice', 'Everyone', 'all', now())`
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, batch_id, published_at)
     VALUES ('Batch notice', 'My batch', 'batch', $1, now())`,
    [state.batchId]
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, batch_id, published_at)
     VALUES ('Other batch notice', 'Not mine', 'batch', $1, now())`,
    [state.otherBatchId]
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, role_code, published_at)
     VALUES ('Student notice', 'Students only', 'role', 'student', now())`
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, role_code, published_at)
     VALUES ('Teacher notice', 'Teachers only', 'role', 'teacher', now())`
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, published_at, expires_at)
     VALUES ('Expired notice', 'Old', 'all', now() - interval '10 days', now() - interval '1 day')`
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

describe("phase 4 student app", () => {
  it("signs in the student, outsider, teacher and admin", async () => {
    const student = await login("student@test.local", "StudentPass123");
    assert.equal(student.status, 200);
    state.studentCookie = cookieFrom(student);

    const outsider = await login("outsider@test.local", "StudentPass123");
    state.outsiderCookie = cookieFrom(outsider);

    const teacher = await login("teacher@test.local", "TeacherPass123");
    state.teacherCookie = cookieFrom(teacher);

    const admin = await login("admin@test.local", "AdminPass123");
    state.adminCookie = cookieFrom(admin);
  });

  it("shows only the student's own course and batch", async () => {
    const mine = await request("/api/student/courses", { cookie: state.studentCookie });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.items.length, 1);
    assert.equal(mine.json.items[0].batchCode, "STU-B1");
    assert.equal(mine.json.items[0].subjects[0].name, "Student Subject");

    const otherBatch = await request(`/api/student/batches/${state.otherBatchId}`, { cookie: state.studentCookie });
    assert.equal(otherBatch.status, 404);

    const detail = await request(`/api/student/batches/${state.batchId}`, { cookie: state.studentCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.batch.code, "STU-B1");

    const forbidden = await request("/api/student/courses", { cookie: state.teacherCookie });
    assert.equal(forbidden.status, 403);

    const adminForbidden = await request("/api/student/courses", { cookie: state.adminCookie });
    assert.equal(adminForbidden.status, 403);
  });

  it("lists published lectures only, and blocks other batches", async () => {
    const list = await request("/api/student/lessons", { cookie: state.studentCookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 2);
    const published = list.json.items.find((lesson) => lesson.id === state.lessonId);
    assert.equal(published.title, "Published lecture");
    assert.equal(published.youtubeVideoId, "dQw4w9WgXcQ");
    assert.equal(published.hasVideo, true);
    assert.equal(published.materialCount, 1);
    assert.equal(published.completed, false);
    const notesOnly = list.json.items.find((lesson) => lesson.id === state.secondLessonId);
    assert.equal(notesOnly.hasVideo, false, "PDF-only lessons are distinguishable");

    const draft = await request(`/api/student/lessons/${state.draftLessonId}`, { cookie: state.studentCookie });
    assert.equal(draft.status, 404);

    const foreign = await request(`/api/student/lessons/${state.otherLessonId}`, { cookie: state.studentCookie });
    assert.equal(foreign.status, 404);

    const search = await request("/api/student/lessons?search=Published", { cookie: state.studentCookie });
    assert.equal(search.status, 200);
    assert.equal(search.json.total, 1);
  });

  it("tracks lecture progress and completion in one row", async () => {
    const detail = await request(`/api/student/lessons/${state.lessonId}`, { cookie: state.studentCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.lesson.subjectName, "Student Subject");
    assert.equal(detail.json.nextLessonId, null);
    assert.equal(detail.json.previousLessonId, state.secondLessonId, "lesson order matches the published list");
    const reading = await request(`/api/student/lessons/${state.secondLessonId}`, { cookie: state.studentCookie });
    assert.equal(reading.status, 200);
    assert.equal(reading.json.previousLessonId, null);
    assert.equal(reading.json.nextLessonId, state.lessonId);

    const saved = await request(`/api/student/lessons/${state.lessonId}/progress`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { positionSeconds: 120 }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.lastPositionSeconds, 120);
    assert.equal(saved.json.completed, false);

    const completed = await request(`/api/student/lessons/${state.lessonId}/progress`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { positionSeconds: 1180, completed: true }
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.json.completed, true);

    const rows = await db.query("SELECT count(*)::int AS count FROM lesson_progress WHERE lesson_id = $1", [
      state.lessonId
    ]);
    assert.equal(rows.rows[0].count, 1, "progress must upsert");

    const list = await request("/api/student/lessons", { cookie: state.studentCookie });
    assert.equal(list.json.items.find((lesson) => lesson.id === state.lessonId).completed, true);

    const foreign = await request(`/api/student/lessons/${state.lessonId}/progress`, {
      method: "POST",
      cookie: state.outsiderCookie,
      body: { positionSeconds: 10 }
    });
    assert.equal(foreign.status, 404);
  });

  it("assembles resume, next class and pending work on the student home", async () => {
    const home = await request("/api/student/dashboard", { cookie: state.studentCookie });
    assert.equal(home.status, 200, home.text);
    assert.equal(home.json.resumeLesson.id, state.secondLessonId, "the unfinished lesson is next to resume");
    assert.equal(home.json.resumeLesson.title, "Reading and notes");
    assert.equal(home.json.resumeLesson.subjectName, "Student Subject");
    assert.equal(home.json.nextClass.subjectName, "Student Subject");
    assert.equal(home.json.nextClass.room, "Room 4");
    assert.equal(home.json.nextClass.nextDate, state.nextClassDate);
    assert.equal(home.json.pendingAssignmentsTotal, 2);
    assert.equal(home.json.pendingAssignments[0].title, "Past due set", "the earliest due work comes first");
    assert.equal(home.json.announcements.length, 3);
    assert.equal(home.json.fees.total, 0);

    const other = await request("/api/student/dashboard", { cookie: state.outsiderCookie });
    assert.equal(other.status, 200, other.text);
    assert.equal(other.json.nextClass, null, "another batch's timetable must not leak");
    assert.equal(other.json.pendingAssignmentsTotal, 0);
    assert.equal(other.json.resumeLesson.id, state.otherLessonId);
  });

  it("serves published study material only", async () => {
    const list = await request("/api/student/materials", { cookie: state.studentCookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 1);
    assert.equal(list.json.items[0].title, "Published notes");
    assert.equal(list.json.items[0].kind, "notes");

    const outsider = await request("/api/student/materials", { cookie: state.outsiderCookie });
    assert.equal(outsider.json.total, 0);
  });

  it("submits an assignment, marks late work, and rejects closed ones", async () => {
    const list = await request("/api/student/assignments", { cookie: state.studentCookie });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 3);
    const open = list.json.items.find((item) => item.id === state.assignmentId);
    assert.equal(open.submission, null);

    const submitted = await request(`/api/student/assignments/${state.assignmentId}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { contentText: "My answers" }
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.json.status, "submitted");
    assert.equal(submitted.json.late, false);

    const detail = await request(`/api/student/assignments/${state.assignmentId}`, { cookie: state.studentCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.submission.contentText, "My answers");

    const resubmitted = await request(`/api/student/assignments/${state.assignmentId}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { contentText: "Revised answers", fileUrl: "https://drive.google.com/file/d/xyz/view" }
    });
    assert.equal(resubmitted.status, 201);

    const rows = await db.query("SELECT count(*)::int AS count FROM assignment_submissions WHERE assignment_id = $1", [
      state.assignmentId
    ]);
    assert.equal(rows.rows[0].count, 1, "resubmission must update the same row");

    const late = await request(`/api/student/assignments/${state.lateAssignmentId}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { contentText: "Late work" }
    });
    assert.equal(late.status, 201);
    assert.equal(late.json.status, "late");
    assert.equal(late.json.late, true);

    const closed = await request(`/api/student/assignments/${state.closedAssignmentId}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { contentText: "Too late" }
    });
    assert.equal(closed.status, 400);

    const empty = await request(`/api/student/assignments/${state.assignmentId}/submissions`, {
      method: "POST",
      cookie: state.studentCookie,
      body: {}
    });
    assert.equal(empty.status, 400);

    const foreign = await request(`/api/student/assignments/${state.assignmentId}/submissions`, {
      method: "POST",
      cookie: state.outsiderCookie,
      body: { contentText: "Not my batch" }
    });
    assert.equal(foreign.status, 404);
  });

  it("returns attendance history scoped to the student", async () => {
    const history = await request("/api/student/attendance", { cookie: state.studentCookie });
    assert.equal(history.status, 200);
    assert.equal(history.json.total, 2);
    assert.equal(history.json.summary.present, 1);
    assert.equal(history.json.summary.absent, 1);
    assert.equal(history.json.summary.percentage, 50);
    assert.equal(history.json.items[0].sessionDate.slice(0, 10), "2026-11-11");

    const filtered = await request("/api/student/attendance?status=absent", { cookie: state.studentCookie });
    assert.equal(filtered.json.total, 1);

    const outsider = await request("/api/student/attendance", { cookie: state.outsiderCookie });
    assert.equal(outsider.json.total, 0);
  });

  it("shows announcements for all, the role, and the student's batch only", async () => {
    const notices = await request("/api/student/announcements", { cookie: state.studentCookie });
    assert.equal(notices.status, 200, notices.text);
    const titles = notices.json.items.map((item) => item.title).sort();
    assert.deepEqual(titles, ["All notice", "Batch notice", "Student notice"]);
    assert.equal(notices.json.total, 3);
  });
});
