/**
 * Phase 2 admin endpoints: real Postgres, real HTTP, real cookies.
 * Covers CRUD, enrolment, CSV import/export, teacher assignment and RBAC.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
// Empty (not deleted): dotenv must not fill this in from .env, otherwise the
// tests would run against the real Neon database.
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
  studentCookie: "",
  teacherId: "",
  courseId: "",
  subjectId: "",
  batchId: "",
  newStudentId: "",
  newStudentPassword: "",
  newStudentCookie: ""
};

async function createUser({ email, password, role, fullName }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
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

function cookieFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

async function request(pathname, { method = "GET", body, cookie, contentType } = {}) {
  const headers = { "content-type": contentType || "application/json" };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : contentType === "text/csv" ? body : JSON.stringify(body)
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-admin-test-"));
  db = await createDatabase({ connectionString: "", pgliteDir: tempDir, allowLocal: true });
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction(async (tx) => tx.exec(sql));
  }

  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });
  await createUser({ email: "owner@test.local", password: "OwnerPass123", role: "super_admin", fullName: "Owner" });
  await createUser({ email: "teacher@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher" });
  await createUser({ email: "student@test.local", password: "StudentPass123", role: "student", fullName: "Student" });

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

describe("phase 2 admin management", () => {
  it("signs in the three roles", async () => {
    const admin = await login("admin@test.local", "AdminPass123");
    assert.equal(admin.status, 200);
    state.adminCookie = cookieFrom(admin);

    const teacher = await login("teacher@test.local", "TeacherPass123");
    state.teacherCookie = cookieFrom(teacher);

    const student = await login("student@test.local", "StudentPass123");
    state.studentCookie = cookieFrom(student);
  });

  it("denies admin endpoints to teacher and student sessions", async () => {
    const teacher = await request("/api/admin/students", { cookie: state.teacherCookie });
    assert.equal(teacher.status, 403);
    const student = await request("/api/admin/courses", { cookie: state.studentCookie });
    assert.equal(student.status, 403);
    const anonymous = await request("/api/admin/students");
    assert.equal(anonymous.status, 401);
  });

  it("creates a course, subject and batch", async () => {
    const course = await request("/api/admin/courses", {
      method: "POST",
      cookie: state.adminCookie,
      body: { code: "TST-101", name: "Test Programme", durationMonths: 12, description: "Created by test" }
    });
    assert.equal(course.status, 201);
    state.courseId = course.json.id;

    const subject = await request("/api/admin/subjects", {
      method: "POST",
      cookie: state.adminCookie,
      body: { code: "TSUB", name: "Test Subject" }
    });
    assert.equal(subject.status, 201);
    state.subjectId = subject.json.id;

    const mapped = await request(`/api/admin/courses/${state.courseId}/subjects`, {
      method: "PUT",
      cookie: state.adminCookie,
      body: { subjectIds: [state.subjectId] }
    });
    assert.equal(mapped.status, 200);
    assert.equal(mapped.json.subjects.length, 1);

    const batch = await request("/api/admin/batches", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        courseId: state.courseId,
        code: "TST-B1",
        name: "Test Batch A",
        startDate: "2026-01-05",
        endDate: "2027-01-04",
        capacity: 30
      }
    });
    assert.equal(batch.status, 201);
    state.batchId = batch.json.batch.id;

    const withSubject = await request(`/api/admin/batches/${state.batchId}/subjects`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { subjectId: state.subjectId }
    });
    assert.equal(withSubject.status, 200);
    assert.equal(withSubject.json.subjects.length, 1);
  });

  it("paginates courses, subjects and batches on the server", async () => {
    const courses = await request("/api/admin/courses?page=1&pageSize=1", { cookie: state.adminCookie });
    assert.equal(courses.status, 200);
    assert.deepEqual(Object.keys(courses.json).sort(), ["items", "page", "pageSize", "total"]);
    assert.equal(courses.json.items.length, 1);
    assert.equal(courses.json.total, 1);

    const subjects = await request("/api/admin/subjects?page=1&pageSize=1", { cookie: state.adminCookie });
    assert.equal(subjects.status, 200);
    assert.equal(subjects.json.total, 1);
    assert.equal(subjects.json.items[0].code, "TSUB");

    const batches = await request("/api/admin/batches?page=1&pageSize=1", { cookie: state.adminCookie });
    assert.equal(batches.status, 200);
    assert.equal(batches.json.total, 1);
    assert.equal(batches.json.items.length, 1);

    const beyond = await request("/api/admin/batches?page=2&pageSize=1", { cookie: state.adminCookie });
    assert.equal(beyond.status, 200);
    assert.equal(beyond.json.items.length, 0);
    assert.equal(beyond.json.total, 1);
  });

  it("creates a teacher and assigns them to the batch", async () => {
    const teacher = await request("/api/admin/teachers", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        fullName: "New Teacher",
        email: "new.teacher@test.local",
        employeeCode: "T-9001",
        qualification: "M.Sc.",
        specialization: "Physics"
      }
    });
    assert.equal(teacher.status, 201);
    assert.ok(teacher.json.temporaryPassword);
    state.teacherId = teacher.json.teacher.teacher.id;

    const assigned = await request(`/api/admin/batches/${state.batchId}/teachers`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { teacherId: state.teacherId, subjectId: state.subjectId }
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.json.teachers.length, 1);
  });

  it("creates a student, enrols them, and shows them in the batch", async () => {
    const created = await request("/api/admin/students", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        fullName: "Riya Test",
        email: "riya.test@test.local",
        enrollmentNo: "ENR-TEST-001",
        phone: "9810012345",
        guardianName: "Guardian Test",
        guardianPhone: "9810099999"
      }
    });
    assert.equal(created.status, 201);
    assert.ok(created.json.temporaryPassword);
    state.newStudentId = created.json.student.student.id;
    state.newStudentPassword = created.json.temporaryPassword;

    const enrolled = await request(`/api/admin/students/${state.newStudentId}/enrollment`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { batchId: state.batchId }
    });
    assert.equal(enrolled.status, 200);
    assert.equal(enrolled.json.enrollments[0].batchName, "Test Batch A");
    assert.equal(enrolled.json.guardians.length, 1);

    const detail = await request(`/api/admin/batches/${state.batchId}`, { cookie: state.adminCookie });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.students.length, 1);
    assert.equal(detail.json.students[0].enrollmentNo, "ENR-TEST-001");

    const loginAsStudent = await login("riya.test@test.local", state.newStudentPassword);
    assert.equal(loginAsStudent.status, 200);
    assert.equal(loginAsStudent.json.user.mustChangePassword, true);
    state.newStudentCookie = cookieFrom(loginAsStudent);

    // The generated password must be replaced before the student app opens.
    const blockedDashboard = await request("/api/student/dashboard", { cookie: state.newStudentCookie });
    assert.equal(blockedDashboard.status, 403);
    assert.equal(blockedDashboard.json.error.code, "password_change_required");

    const chosen = await request("/api/auth/change-password", {
      method: "POST",
      cookie: state.newStudentCookie,
      body: { currentPassword: state.newStudentPassword, newPassword: "RiyaChosen123" }
    });
    assert.equal(chosen.status, 200, chosen.text);
    state.newStudentPassword = "RiyaChosen123";

    const dashboard = await request("/api/student/dashboard", { cookie: state.newStudentCookie });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.json.enrollment.course_name, "Test Programme");
  });

  it("searches and paginates the student list", async () => {
    const searched = await request("/api/admin/students?search=Riya&page=1&pageSize=10", {
      cookie: state.adminCookie
    });
    assert.equal(searched.status, 200);
    assert.equal(searched.json.total, 1);
    assert.equal(searched.json.items[0].fullName, "Riya Test");
    assert.ok(searched.json.items[0].batchName);
  });

  it("imports CSV students, skips duplicates and exports a CSV", async () => {
    const csv = [
      "full_name,email,enrollment_no,batch_code",
      "Imported One,imported.one@test.local,ENR-IMP-1,TST-B1",
      "Riya Test,riya.test@test.local,ENR-TEST-001,TST-B1"
    ].join("\n");

    const imported = await request("/api/admin/students/import", {
      method: "POST",
      cookie: state.adminCookie,
      body: { csv }
    });
    assert.equal(imported.status, 201);
    assert.equal(imported.json.created, 1);
    assert.equal(imported.json.skipped.length, 1);
    assert.ok(imported.json.credentials[0].temporaryPassword);

    const exported = await request("/api/admin/students/export", { cookie: state.adminCookie });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type"), /text\/csv/);
    assert.match(exported.text.split("\n")[0], /full_name,email,enrollment_no/);
    assert.match(exported.text, /imported\.one@test\.local/);
  });

  it("deactivates a student, revokes their session and lets an admin reset the password", async () => {
    const deactivated = await request(`/api/admin/students/${state.newStudentId}/status`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { status: "inactive" }
    });
    assert.equal(deactivated.status, 200);

    const revoked = await request("/api/student/dashboard", { cookie: state.newStudentCookie });
    assert.equal(revoked.status, 401, "existing session must be revoked on deactivation");

    const blockedLogin = await login("riya.test@test.local", state.newStudentPassword);
    assert.equal(blockedLogin.status, 403);

    const reactivated = await request(`/api/admin/students/${state.newStudentId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { status: "active" }
    });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.json.student.status, "active");

    const reset = await request(`/api/admin/students/${state.newStudentId}/reset-password`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {}
    });
    assert.equal(reset.status, 200);
    assert.ok(reset.json.temporaryPassword);

    const newLogin = await login("riya.test@test.local", reset.json.temporaryPassword);
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.json.user.mustChangePassword, true);
  });

  it("resets a teacher password and controls teacher status", async () => {
    const reset = await request(`/api/admin/teachers/${state.teacherId}/reset-password`, {
      method: "POST",
      cookie: state.adminCookie,
      body: {}
    });
    assert.equal(reset.status, 200);
    assert.ok(reset.json.temporaryPassword);

    const teacherLogin = await login("new.teacher@test.local", reset.json.temporaryPassword);
    assert.equal(teacherLogin.status, 200);
    const teacherCookie = cookieFrom(teacherLogin);

    // The temporary password only unlocks the change-password screen.
    const before = await request("/api/teacher/dashboard", { cookie: teacherCookie });
    assert.equal(before.status, 403);
    assert.equal(before.json.error.code, "password_change_required");

    const changed = await request("/api/auth/change-password", {
      method: "POST",
      cookie: teacherCookie,
      body: { currentPassword: reset.json.temporaryPassword, newPassword: "TeacherPass456" }
    });
    assert.equal(changed.status, 200, changed.text);

    const afterChange = await request("/api/teacher/dashboard", { cookie: teacherCookie });
    assert.equal(afterChange.status, 200);

    const deactivated = await request(`/api/admin/teachers/${state.teacherId}/status`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { status: "inactive" }
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.json.status, "inactive");

    const revoked = await request("/api/teacher/dashboard", { cookie: teacherCookie });
    assert.equal(revoked.status, 401, "existing teacher session must be revoked on deactivation");

    const blockedLogin = await login("new.teacher@test.local", reset.json.temporaryPassword);
    assert.equal(blockedLogin.status, 403);

    const reactivated = await request(`/api/admin/teachers/${state.teacherId}/status`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { status: "active" }
    });
    assert.equal(reactivated.status, 200);

    const relogin = await login("new.teacher@test.local", "TeacherPass456");
    assert.equal(relogin.status, 200);
    assert.equal(relogin.json.user.mustChangePassword, false);

    const teacherCannotReset = await request(`/api/admin/teachers/${state.teacherId}/status`, {
      method: "POST",
      cookie: state.studentCookie,
      body: { status: "inactive" }
    });
    assert.equal(teacherCannotReset.status, 403);
  });

  it("rejects invalid admin input instead of crashing", async () => {
    const badUuid = await request("/api/admin/students/not-a-uuid", { cookie: state.adminCookie });
    assert.equal(badUuid.status, 400);

    const missingFields = await request("/api/admin/courses", {
      method: "POST",
      cookie: state.adminCookie,
      body: { name: "x" }
    });
    assert.equal(missingFields.status, 400);
    assert.ok(Array.isArray(missingFields.json.error.details));

    const duplicate = await request("/api/admin/students", {
      method: "POST",
      cookie: state.adminCookie,
      body: { fullName: "Duplicate Student", email: "riya.test@test.local", enrollmentNo: "ENR-TEST-999" }
    });
    assert.equal(duplicate.status, 409);
  });

  it("publishes an announcement and notifies the audience", async () => {
    const created = await request("/api/admin/announcements", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        title: "Holiday notice",
        body: "The institute is closed on Monday for maintenance.",
        audience: "all",
        isPinned: true
      }
    });
    assert.equal(created.status, 201, created.text);

    const list = await request("/api/admin/announcements", { cookie: state.adminCookie });
    assert.equal(list.status, 200);
    assert.ok(list.json.items.some((item) => item.id === created.json.id));
    assert.equal(list.json.items[0].isPinned, true);

    const feed = await request("/api/student/announcements", { cookie: state.studentCookie });
    assert.ok(feed.json.items.some((item) => item.title === "Holiday notice"));

    const unread = await request("/api/me/notifications/unread-count", { cookie: state.studentCookie });
    assert.ok(unread.json.count >= 1);

    const inbox = await request("/api/me/notifications", { cookie: state.studentCookie });
    assert.ok(inbox.json.items.some((item) => item.title.includes("Holiday notice")));

    const first = inbox.json.items[0];
    const read = await request(`/api/me/notifications/${first.id}/read`, {
      method: "POST",
      cookie: state.studentCookie
    });
    assert.equal(read.status, 200);

    const readAll = await request("/api/me/notifications/read-all", {
      method: "POST",
      cookie: state.studentCookie
    });
    assert.equal(readAll.status, 200);
    const after = await request("/api/me/notifications/unread-count", { cookie: state.studentCookie });
    assert.equal(after.json.count, 0);

    const denied = await request("/api/admin/announcements", {
      method: "POST",
      cookie: state.studentCookie,
      body: { title: "Nope", body: "Students cannot publish notices", audience: "all" }
    });
    assert.equal(denied.status, 403);

    const missingTarget = await request("/api/admin/announcements", {
      method: "POST",
      cookie: state.adminCookie,
      body: { title: "Batch notice", body: "Missing the batch", audience: "batch" }
    });
    assert.equal(missingTarget.status, 400);

    const removed = await request(`/api/admin/announcements/${created.json.id}`, {
      method: "DELETE",
      cookie: state.adminCookie
    });
    assert.equal(removed.status, 200);
  });

  it("manages staff accounts, settings, the audit trail and reports", async () => {
    const owner = await login("owner@test.local", "OwnerPass123");
    assert.equal(owner.status, 200, owner.text);
    const ownerCookie = cookieFrom(owner);

    // A plain admin cannot manage staff or settings.
    const adminDenied = await request("/api/admin/admins", { cookie: state.adminCookie });
    assert.equal(adminDenied.status, 403);

    const before = await request("/api/admin/settings", { cookie: ownerCookie });
    assert.equal(before.status, 200, before.text);
    assert.equal(before.json.instituteName, "Coaching Institute");

    const changed = await request("/api/admin/settings", {
      method: "PATCH",
      cookie: ownerCookie,
      body: { instituteName: "Test Academy", receiptFooter: "Thank you" }
    });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.json.instituteName, "Test Academy");

    const created = await request("/api/admin/admins", {
      method: "POST",
      cookie: ownerCookie,
      body: { fullName: "Ops Admin", email: "ops@test.local", password: "OpsPass123", roleCode: "admin" }
    });
    assert.equal(created.status, 201, created.text);

    const duplicate = await request("/api/admin/admins", {
      method: "POST",
      cookie: ownerCookie,
      body: { fullName: "Ops Admin 2", email: "ops@test.local", roleCode: "admin" }
    });
    assert.equal(duplicate.status, 409);

    const opsLogin = await login("ops@test.local", "OpsPass123");
    assert.equal(opsLogin.status, 200, opsLogin.text);
    const opsCookie = cookieFrom(opsLogin);
    const opsStaff = await request("/api/admin/admins", { cookie: opsCookie });
    assert.equal(opsStaff.status, 403);
    const opsStudents = await request("/api/admin/students", { cookie: opsCookie });
    assert.equal(opsStudents.status, 200);

    const deactivated = await request(`/api/admin/admins/${created.json.id}`, {
      method: "PATCH",
      cookie: ownerCookie,
      body: { status: "inactive" }
    });
    assert.equal(deactivated.status, 200, deactivated.text);
    assert.equal(deactivated.json.status, "inactive");

    const revoked = await request("/api/admin/students", { cookie: opsCookie });
    assert.equal(revoked.status, 401);

    const audit = await request("/api/admin/audit-logs?action=settings.updated", { cookie: ownerCookie });
    assert.equal(audit.status, 200);
    assert.ok(audit.json.items.length >= 1);
    assert.equal(audit.json.items[0].action, "settings.updated");

    const reports = await request("/api/admin/reports/overview", { cookie: state.adminCookie });
    assert.equal(reports.status, 200, reports.text);
    assert.equal(typeof reports.json.totals.students, "number");
    assert.ok(Array.isArray(reports.json.feesByMonth));

    const feesCsv = await request("/api/admin/reports/fees.csv", { cookie: state.adminCookie });
    assert.equal(feesCsv.status, 200);
    assert.match(feesCsv.text.split("\n")[0], /^Student,Email,Enrolment/);

    const attendanceCsv = await request("/api/admin/reports/attendance.csv", { cookie: state.adminCookie });
    assert.equal(attendanceCsv.status, 200);
    assert.match(attendanceCsv.text.split("\n")[0], /^Student,Enrolment,Batch/);
  });
});
