/**
 * Guardian portal: a guardian signs in and sees only their linked child's
 * attendance, fees and published results. Authorization lives in SQL
 * (`guardian_profiles.user_id`), never in a client-supplied id.
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
  guardianCookie: "",
  adminCookie: "",
  studentCookie: "",
  childId: "",
  otherStudentId: "",
  batchId: ""
};

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

const cookieFrom = (response) =>
  (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");

async function login(email, password) {
  return request("/api/auth/login", { method: "POST", body: { email, password } });
}

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
  return id;
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-guardian-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }

  state.childId = await createUser({
    email: "child@test.local",
    password: "ChildPass123",
    role: "student",
    fullName: "Child One"
  });
  state.otherStudentId = await createUser({
    email: "other@test.local",
    password: "OtherPass123",
    role: "student",
    fullName: "Other Student"
  });
  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });
  await createUser({ email: "student@test.local", password: "StudentPass123", role: "student", fullName: "Plain Student" });

  const guardianId = await createUser({
    email: "guardian@test.local",
    password: "GuardianPass123",
    role: "guardian",
    fullName: "Guardian One"
  });

  const course = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('G-1', 'Guardian Course', 12) RETURNING id"
  );
  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'G-B1', 'Guardian Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [course.rows[0].id]
  );
  state.batchId = batch.rows[0].id;
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    state.childId,
    state.batchId,
    course.rows[0].id
  ]);

  // Only the child is linked to this guardian.
  await db.query(
    `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary, user_id, email)
     VALUES ($1, 'Guardian One', 'father', '9810000000', true, $2, 'guardian@test.local')`,
    [state.childId, guardianId]
  );

  await db.query(
    `INSERT INTO attendance (batch_id, student_id, session_date, status) VALUES
       ($1, $2, '2026-11-10', 'present'),
       ($1, $2, '2026-11-11', 'absent'),
       ($1, $3, '2026-11-10', 'present')`,
    [state.batchId, state.childId, state.otherStudentId]
  );

  const structure = await db.query(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount)
     VALUES ($1, 'Guardian Tuition', '2026-27', 5000) RETURNING id`,
    [course.rows[0].id]
  );
  const fee = await db.query(
    `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, net_amount, due_date, status)
     VALUES ($1, $2, 5000, 5000, '2026-12-31', 'pending') RETURNING id`,
    [state.childId, structure.rows[0].id]
  );
  await db.query(
    `INSERT INTO payments (student_fee_id, student_id, amount, method, receipt_no)
     VALUES ($1, $2, 2000, 'cash', 'RCPT-TEST-0001')`,
    [fee.rows[0].id, state.childId]
  );

  const publishedExam = await db.query(
    `INSERT INTO exams (batch_id, title, starts_at, ends_at, duration_minutes, total_marks, pass_marks,
                        status, results_published, results_published_at)
     VALUES ($1, 'Published Test', now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
             60, 100, 40, 'closed', true, now() - interval '2 days') RETURNING id`,
    [state.batchId]
  );
  const draftExam = await db.query(
    `INSERT INTO exams (batch_id, title, starts_at, ends_at, duration_minutes, total_marks, pass_marks, status)
     VALUES ($1, 'Unpublished Test', now() - interval '2 days', now() - interval '2 days' + interval '1 hour',
             60, 100, 40, 'closed') RETURNING id`,
    [state.batchId]
  );
  for (const [examId, marks, published] of [
    [publishedExam.rows[0].id, 82, true],
    [draftExam.rows[0].id, 61, false]
  ]) {
    const attempt = await db.query(
      `INSERT INTO exam_attempts (exam_id, student_id, attempt_no, status, expires_at, score)
       VALUES ($1, $2, 1, 'evaluated', now(), $3) RETURNING id`,
      [examId, state.childId, marks]
    );
    await db.query(
      `INSERT INTO exam_results (exam_id, attempt_id, student_id, obtained_marks, total_marks, percentage, status, published_at)
       VALUES ($1, $2, $3, $4, 100, $4, $5, $6)`,
      [examId, attempt.rows[0].id, state.childId, marks, marks >= 40 ? "pass" : "fail", published ? new Date() : null]
    );
  }

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const guardian = await login("guardian@test.local", "GuardianPass123");
  assert.equal(guardian.status, 200, guardian.text);
  assert.deepEqual(guardian.json.user.roles, ["guardian"]);
  state.guardianCookie = cookieFrom(guardian);

  const admin = await login("admin@test.local", "AdminPass123");
  assert.equal(admin.status, 200, admin.text);
  state.adminCookie = cookieFrom(admin);

  const student = await login("student@test.local", "StudentPass123");
  assert.equal(student.status, 200, student.text);
  state.studentCookie = cookieFrom(student);
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("guardian portal", () => {
  it("lists only the child linked to the guardian in SQL", async () => {
    const res = await request("/api/guardian/children", { cookie: state.guardianCookie });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.items.length, 1);
    assert.equal(res.json.items[0].id, state.childId);
    assert.equal(res.json.items[0].fullName, "Child One");
    assert.match(res.json.items[0].enrollmentNo, /ENR-child/);
  });

  it("shows the child's attendance, fees and published results", async () => {
    const attendance = await request(`/api/guardian/children/${state.childId}/attendance`, {
      cookie: state.guardianCookie
    });
    assert.equal(attendance.status, 200, attendance.text);
    assert.equal(attendance.json.total, 2);
    assert.equal(attendance.json.summary.total, 2);
    assert.equal(attendance.json.summary.present, 1);
    assert.equal(attendance.json.summary.absent, 1);

    const fees = await request(`/api/guardian/children/${state.childId}/fees`, { cookie: state.guardianCookie });
    assert.equal(fees.status, 200, fees.text);
    assert.equal(fees.json.summary.billed, 5000);
    assert.equal(fees.json.summary.paid, 2000);
    assert.equal(fees.json.summary.pending, 3000);
    assert.equal(fees.json.payments.length, 1);

    const results = await request(`/api/guardian/children/${state.childId}/results`, {
      cookie: state.guardianCookie
    });
    assert.equal(results.status, 200, results.text);
    assert.equal(results.json.total, 1, "unpublished results stay hidden");
    assert.equal(results.json.items[0].title, "Published Test");
    assert.equal(results.json.items[0].obtainedMarks, 82);
  });

  it("refuses another student's records even with a valid session", async () => {
    for (const path of ["attendance", "fees", "results"]) {
      const res = await request(`/api/guardian/children/${state.otherStudentId}/${path}`, {
        cookie: state.guardianCookie
      });
      assert.equal(res.status, 404, `${path}: ${res.text}`);
    }
  });

  it("keeps guardian, student and admin areas separate", async () => {
    const guardianOnStudent = await request("/api/student/dashboard", { cookie: state.guardianCookie });
    assert.equal(guardianOnStudent.status, 403);

    const guardianOnAdmin = await request("/api/admin/students", { cookie: state.guardianCookie });
    assert.equal(guardianOnAdmin.status, 403);

    const studentOnGuardian = await request("/api/guardian/children", { cookie: state.studentCookie });
    assert.equal(studentOnGuardian.status, 403);

    const adminOnGuardian = await request("/api/guardian/children", { cookie: state.adminCookie });
    assert.equal(adminOnGuardian.status, 403);

    const anonymous = await request("/api/guardian/children");
    assert.equal(anonymous.status, 401);
  });

  it("lets the office create a guardian login and link it", async () => {
    const created = await request(`/api/admin/students/${state.otherStudentId}/guardian-access`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { email: "second.guardian@test.local", name: "Second Guardian" }
    });
    assert.equal(created.status, 201, created.text);
    assert.match(created.json.temporaryPassword, /^.{8,}$/);

    const duplicate = await request(`/api/admin/students/${state.otherStudentId}/guardian-access`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { email: "second.guardian@test.local" }
    });
    assert.equal(duplicate.status, 409);

    const signIn = await login("second.guardian@test.local", created.json.temporaryPassword);
    assert.equal(signIn.status, 200, signIn.text);
    assert.equal(signIn.json.user.mustChangePassword, true);

    const cookie = cookieFrom(signIn);
    const blocked = await request("/api/guardian/children", { cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error.code, "password_change_required");

    const changed = await request("/api/auth/change-password", {
      method: "POST",
      cookie,
      body: { currentPassword: created.json.temporaryPassword, newPassword: "GuardianPass456" }
    });
    assert.equal(changed.status, 200, changed.text);

    const children = await request("/api/guardian/children", { cookie });
    assert.equal(children.status, 200, children.text);
    assert.deepEqual(
      children.json.items.map((row) => row.id),
      [state.otherStudentId]
    );
  });
});
