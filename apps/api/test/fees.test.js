/**
 * Phase 6 fees: structures, assignment to students, offline payments with
 * receipts, dues reporting and the student's own fee ledger.
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
  studentCookie: "",
  courseId: "",
  batchId: "",
  studentId: "",
  structureId: "",
  feeId: ""
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-fees-test-"));
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
  await createUser({ email: "teacher@test.local", password: "TeacherPass123", role: "teacher", fullName: "Teacher One" });
  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin" });

  const course = await db.query(
    "INSERT INTO courses (code, name, duration_months) VALUES ('FEE-1', 'Fee Course', 12) RETURNING id"
  );
  state.courseId = course.rows[0].id;
  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'FEE-B1', 'Fee Batch', '2026-01-05', '2027-01-04', 30) RETURNING id`,
    [state.courseId]
  );
  state.batchId = batch.rows[0].id;
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    state.studentId,
    state.batchId,
    state.courseId
  ]);

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Sign in once here so no test depends on an earlier test having done it.
  const admin = await login("admin@test.local", "AdminPass123");
  assert.equal(admin.status, 200, admin.text);
  state.adminCookie = cookieFrom(admin);

  const teacher = await login("teacher@test.local", "TeacherPass123");
  assert.equal(teacher.status, 200, teacher.text);
  state.teacherCookie = cookieFrom(teacher);

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

describe("phase 6 fees", () => {
  // One invoice moves through structure, assignment, payments, corrections and waiver.
  // Those steps share a single row, so they live in one test instead of seven ordered
  // subtests: any test in this file can now run alone (node --test-name-pattern).
  it("walks an invoice from structure to payment, correction and waiver", async () => {
    // Fee structure creation, including the duplicate guard.
    const created = await request("/api/admin/fees/structures", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        courseId: state.courseId,
        name: "JEE 2027 tuition",
        academicYear: "2026-27",
        totalAmount: 12000,
        installments: 3
      }
    });
    assert.equal(created.status, 201, created.text);
    state.structureId = created.json.id;

    const duplicate = await request("/api/admin/fees/structures", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        courseId: state.courseId,
        name: "JEE 2027 tuition",
        academicYear: "2026-27",
        totalAmount: 12000,
        installments: 3
      }
    });
    assert.equal(duplicate.status, 409);

    // Assignment and dues reporting.
    const assigned = await request("/api/admin/fees/assign", {
      method: "POST",
      cookie: state.adminCookie,
      body: {
        studentId: state.studentId,
        feeStructureId: state.structureId,
        discountAmount: 2000,
        dueDate: "2026-12-31",
        notes: "Scholarship discount"
      }
    });
    assert.equal(assigned.status, 201, assigned.text);
    state.feeId = assigned.json.id;

    const again = await request("/api/admin/fees/assign", {
      method: "POST",
      cookie: state.adminCookie,
      body: { studentId: state.studentId, feeStructureId: state.structureId }
    });
    assert.equal(again.status, 409);

    const dues = await request("/api/admin/fees/dues", { cookie: state.adminCookie });
    assert.equal(dues.status, 200);
    assert.equal(dues.json.items.length, 1);
    assert.equal(dues.json.items[0].netAmount, 10000);
    assert.equal(dues.json.items[0].pendingAmount, 10000);
    assert.equal(dues.json.items[0].status, "pending");
    assert.equal(dues.json.items[0].installmentCount, 3);
    assert.equal(dues.json.summary.billed, 10000);

    const structures = await request("/api/admin/fees/structures", { cookie: state.adminCookie });
    assert.equal(structures.json.items[0].assignedCount, 1);

    // A student with no enrolment in the course cannot be charged for it.
    const outsiderId = await createUser({
      email: "outsider@test.local",
      password: "OutsiderPass123",
      role: "student",
      fullName: "Outsider Student"
    });

    const rejected = await request("/api/admin/fees/assign", {
      method: "POST",
      cookie: state.adminCookie,
      body: { studentId: outsiderId, feeStructureId: state.structureId }
    });
    assert.equal(rejected.status, 400, rejected.text);
    assert.match(rejected.json.error.message, /enrolment/i);

    const stillOne = await request("/api/admin/fees/dues", { cookie: state.adminCookie });
    assert.equal(stillOne.json.items.length, 1);

    // Offline payments, receipts and the overpayment guard.
    const first = await request(`/api/admin/fees/${state.feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { amount: 6000, method: "cash", reference: "Counter receipt" }
    });
    assert.equal(first.status, 201, first.text);
    assert.match(first.json.receiptNo, /^RCPT-\d{8}-[A-Z0-9]{4}$/);
    assert.equal(first.json.status, "partial");
    assert.equal(first.json.pendingAmount, 4000);

    const overpay = await request(`/api/admin/fees/${state.feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { amount: 5000, method: "upi" }
    });
    assert.equal(overpay.status, 400);

    const second = await request(`/api/admin/fees/${state.feeId}/payments`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { amount: 4000, method: "upi", reference: "UPI-1234" }
    });
    assert.equal(second.status, 201, second.text);
    assert.equal(second.json.status, "paid");
    assert.equal(second.json.pendingAmount, 0);

    const payments = await request("/api/admin/fees/payments", { cookie: state.adminCookie });
    assert.equal(payments.json.total, 2);
    assert.equal(payments.json.items[0].amount, 4000);

    const paidDues = await request("/api/admin/fees/dues?status=paid", { cookie: state.adminCookie });
    assert.equal(paidDues.json.items.length, 1);
    assert.equal(paidDues.json.items[0].paidAmount, 10000);
    assert.equal(paidDues.json.items[0].pendingAmount, 0);

    // The student's own ledger and instalment schedule.
    const fees = await request("/api/student/fees", { cookie: state.studentCookie });
    const plan = fees.json.invoices[0].installments;
    assert.equal(plan.length, 3);
    assert.equal(plan.reduce((sum, row) => sum + row.amount, 0), 10000);
    assert.equal(plan[0].paidAmount, plan[0].amount, "the collected money pays the first instalment");
    assert.equal(plan[2].status, "paid", "two full receipts cover the whole schedule");
    assert.equal(fees.status, 200, fees.text);
    assert.equal(fees.json.summary.billed, 10000);
    assert.equal(fees.json.summary.paid, 10000);
    assert.equal(fees.json.summary.pending, 0);
    assert.equal(fees.json.summary.openInvoices, 0);
    assert.equal(fees.json.invoices.length, 1);
    assert.equal(fees.json.invoices[0].discountAmount, 2000);
    assert.equal(fees.json.payments.length, 2);

    // Voiding a receipt, adjusting and waiving the fee, and the receipt copy.
    const allPayments = await request("/api/admin/fees/payments", { cookie: state.adminCookie });
    const latest = allPayments.json.items[0];

    const detail = await request(`/api/admin/fees/payments/${latest.id}/receipt`, { cookie: state.adminCookie });
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.receiptNo, latest.receiptNo);
    assert.equal(detail.json.studentEmail, "student@test.local");
    assert.equal(detail.json.pendingAmount, 0);

    const noReason = await request(`/api/admin/fees/payments/${latest.id}/void`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "" }
    });
    assert.equal(noReason.status, 400);

    const voided = await request(`/api/admin/fees/payments/${latest.id}/void`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "UPI reference never settled" }
    });
    assert.equal(voided.status, 200, voided.text);
    assert.equal(voided.json.status, "partial");
    assert.equal(voided.json.pendingAmount, 4000);

    const twice = await request(`/api/admin/fees/payments/${latest.id}/void`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "Again" }
    });
    assert.equal(twice.status, 409);

    const receiptAfter = await request(`/api/admin/fees/payments/${latest.id}/receipt`, {
      cookie: state.adminCookie
    });
    assert.ok(receiptAfter.json.voidedAt);

    // Adjusting the fee cannot go below what has already been collected.
    const tooLow = await request(`/api/admin/fees/${state.feeId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { discountAmount: 8000 }
    });
    assert.equal(tooLow.status, 400);

    const adjusted = await request(`/api/admin/fees/${state.feeId}`, {
      method: "PATCH",
      cookie: state.adminCookie,
      body: { discountAmount: 2500, notes: "Revised scholarship" }
    });
    assert.equal(adjusted.status, 200, adjusted.text);
    assert.equal(adjusted.json.netAmount, 9500);
    assert.equal(adjusted.json.status, "partial");

    const reminders = await request("/api/admin/fees/reminders", { cookie: state.adminCookie });
    assert.equal(reminders.status, 200);
    assert.equal(reminders.json.total, 0, "the due date is still in the future");

    const blockedWaive = await request(`/api/admin/fees/${state.feeId}/waive`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "Staff ward" }
    });
    assert.equal(blockedWaive.status, 400);

    const older = allPayments.json.items[1];
    const voidOlder = await request(`/api/admin/fees/payments/${older.id}/void`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "Cash counted twice" }
    });
    assert.equal(voidOlder.status, 200, voidOlder.text);
    assert.equal(voidOlder.json.status, "pending");

    const waived = await request(`/api/admin/fees/${state.feeId}/waive`, {
      method: "POST",
      cookie: state.adminCookie,
      body: { reason: "Staff ward" }
    });
    assert.equal(waived.status, 200, waived.text);
    assert.equal(waived.json.status, "waived");
  });

  it("keeps roles out of each other's fee APIs", async () => {
    const teacherOnAdmin = await request("/api/admin/fees/dues", { cookie: state.teacherCookie });
    assert.equal(teacherOnAdmin.status, 403);

    const adminOnStudent = await request("/api/student/fees", { cookie: state.adminCookie });
    assert.equal(adminOnStudent.status, 403);

    const anonymous = await request("/api/student/fees");
    assert.equal(anonymous.status, 401);
  });
});
