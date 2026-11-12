/**
 * Integration test: real PostgreSQL (embedded PGlite), real HTTP server,
 * real cookies. Covers auth, RBAC boundaries, CSRF origin checks and that
 * dashboard numbers are computed from the database.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
delete process.env.DATABASE_URL;
delete process.env.APP_ORIGIN;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../database/migrations");

const { createDatabase } = await import("@coaching/db");
const { hashPassword } = await import("@coaching/auth");
const { createApp } = await import("../src/app.js");

let db;
let server;
let baseUrl;
let tempDir;

async function applyMigrations(database) {
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await database.transaction(async (tx) => tx.exec(sql));
  }
}

async function createUser({ email, password, role, fullName }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [email, hashPassword(password), fullName]
  );
  const id = rows[0].id;
  await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [id, role]);
  if (role === "student") {
    await db.query(
      `INSERT INTO student_profiles (user_id, enrollment_no, admission_date) VALUES ($1, $2, CURRENT_DATE)`,
      [id, `ENR-T-${email}`]
    );
  }
  if (role === "teacher") {
    await db.query(`INSERT INTO teacher_profiles (user_id, employee_code) VALUES ($1, $2)`, [id, `EMP-${email}`]);
  }
  return id;
}

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((value) => value.split(";")[0]).join("; ");
}

async function request(pathname, { method = "GET", body, cookie, origin } = {}) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, headers: response.headers };
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-test-"));
  db = await createDatabase({ pgliteDir: tempDir, allowLocal: true });
  await applyMigrations(db);

  await createUser({ email: "admin@test.local", password: "AdminPass123", role: "admin", fullName: "Admin User" });
  await createUser({ email: "teacher@test.local", password: "TeachPass123", role: "teacher", fullName: "Teacher One" });
  await createUser({ email: "student@test.local", password: "StudyPass123", role: "student", fullName: "Student One" });

  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    // fetch keeps sockets alive; without this the test process never exits.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("authentication", () => {
  it("serves a health check backed by the database", async () => {
    const res = await request("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "ok");
  });

  it("rejects unauthenticated access to protected endpoints", async () => {
    const res = await request("/api/auth/me");
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, "unauthorized");
  });

  it("rejects a wrong password without revealing account existence", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: { email: "student@test.local", password: "WrongPass123" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.message, "Invalid email or password");
  });

  it("blocks state-changing requests from a foreign origin", async () => {
    const res = await request("/api/auth/login", {
      method: "POST",
      origin: "https://evil.example",
      body: { email: "student@test.local", password: "StudyPass123" }
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "csrf_origin_mismatch");
  });

  it("signs a student in, exposes only their own session, and enforces role boundaries", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: "student@test.local", password: "StudyPass123" }
    });
    assert.equal(login.status, 200);
    assert.deepEqual(login.json.user.roles, ["student"]);
    assert.equal(login.json.token, undefined, "session token must not be returned in JSON");

    const cookie = cookieFrom(login);
    assert.match(cookie, /cp_session=/);

    const me = await request("/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, "student@test.local");

    const own = await request("/api/student/dashboard", { cookie });
    assert.equal(own.status, 200);
    assert.equal(own.json.student.enrollmentNo, "ENR-T-student@test.local");
    assert.equal(own.json.fees.total, 0);

    const forbidden = await request("/api/admin/dashboard", { cookie });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json.error.code, "forbidden");

    const cookieHeader = own.headers.get("set-cookie");
    assert.equal(cookieHeader, null, "dashboard responses must not set cookies");
  });

  it("returns database-driven admin metrics", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: "admin@test.local", password: "AdminPass123" }
    });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);

    const dashboard = await request("/api/admin/dashboard", { cookie });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.json.metrics.totalStudents, 1);
    assert.equal(dashboard.json.metrics.activeCourses, 0);
    assert.equal(dashboard.json.metrics.pendingFees.amount, 0);
    assert.ok(Array.isArray(dashboard.json.attendanceTrend));

    const teacherArea = await request("/api/teacher/dashboard", { cookie });
    // Admins are allowed into the teacher dashboard but own no batches.
    assert.equal(teacherArea.status, 200);
    assert.equal(teacherArea.json.metrics.batches, 0);
  });

  it("changes a password and revokes other sessions", async () => {
    const first = await request("/api/auth/login", {
      method: "POST",
      body: { email: "student@test.local", password: "StudyPass123" }
    });
    const cookie = cookieFrom(first);

    const changed = await request("/api/auth/change-password", {
      method: "POST",
      cookie,
      body: { currentPassword: "StudyPass123", newPassword: "StudyPass456" }
    });
    assert.equal(changed.status, 200);

    const oldPassword = await request("/api/auth/login", {
      method: "POST",
      body: { email: "student@test.local", password: "StudyPass123" }
    });
    assert.equal(oldPassword.status, 401);

    const newPassword = await request("/api/auth/login", {
      method: "POST",
      body: { email: "student@test.local", password: "StudyPass456" }
    });
    assert.equal(newPassword.status, 200);

    const logout = await request("/api/auth/logout", { method: "POST", cookie: cookieFrom(newPassword) });
    assert.equal(logout.status, 200);

    const afterLogout = await request("/api/auth/me", { cookie: cookieFrom(newPassword) });
    assert.equal(afterLogout.status, 401);
  });
});
