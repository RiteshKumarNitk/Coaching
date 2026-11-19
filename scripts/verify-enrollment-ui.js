#!/usr/bin/env node
/**
 * Enrollment lifecycle UI verification.
 *
 * A disposable PGlite database and the built SPA are served by the real API.
 * The script clicks Assign, Withdraw, Complete, Transfer (including an occupied
 * target) on a desktop viewport and again on a narrow mobile viewport. It checks
 * the institute-local validity boundary, history after transfer, fee retention
 * and that a failed transfer leaves the source row untouched.
 */
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "database", "migrations");
const shotDir = path.join(repoRoot, "docs", "verification");
const distIndex = path.join(repoRoot, "apps", "web", "dist", "index.html");

if (!fs.existsSync(distIndex)) {
  console.error("No web build found. Run `pnpm build` first.");
  process.exit(1);
}

const { createDatabase } = await import("@coaching/db");
const { hashPassword } = await import("@coaching/auth");
const { createApp } = await import("../apps/api/src/app.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(candidate));
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

async function waitFor(label, check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ""}`);
}

async function connectPage(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const handler of handlers.get(message.method) ?? []) handler(message.params);
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  return { send, evaluate, close: () => socket.close() };
}

function cookieFrom(response) {
  return (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log("SKIP  no Chromium/Edge binary found");
    return;
  }

  await mkdir(shotDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coaching-enroll-ui-"));
  const db = await createDatabase({ connectionString: "", pgliteDir: path.join(tempDir, "db"), allowLocal: true });
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }
  await db.query("UPDATE app_settings SET value = 'Asia/Kolkata' WHERE key = 'instituteTimezone'");

  const password = "EnrollPass123";
  const addUser = async (email, fullName, role) => {
    const { rows } = await db.query(
      "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
      [email, hashPassword(password), fullName]
    );
    await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [rows[0].id, role]);
    if (role === "student") {
      await db.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, $2)", [
        rows[0].id,
        `ENR-${email}`
      ]);
    }
    return rows[0].id;
  };

  await addUser("enroll.admin@test.local", "Enroll Admin", "super_admin");
  const students = [
    {
      email: "desk.enroll@test.local",
      fullName: "Desktop Enroll",
      viewport: { width: 1360, height: 1000, label: "desktop" }
    },
    {
      email: "mobile.enroll@test.local",
      fullName: "Mobile Enroll",
      viewport: { width: 390, height: 844, label: "mobile" }
    }
  ];
  for (const student of students) student.id = await addUser(student.email, student.fullName, "student");

  const course = await db.one(
    "INSERT INTO courses (code, name, duration_months) VALUES ('ENR-UI', 'Enrollment UI Course', 12) RETURNING id"
  );
  const subject = await db.one("INSERT INTO subjects (code, name) VALUES ('ENR-UI-S', 'Enrollment UI Subject') RETURNING id");
  const batches = {};
  for (const code of ["A", "B", "C", "D", "E"]) {
    batches[code] = await db.one(
      `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
       VALUES ($1, $2, $3, '2026-01-01', '2027-12-31', 30) RETURNING id`,
      [course.id, `ENR-UI-${code}`, `Enrollment UI Batch ${code}`]
    );
  }
  const structure = await db.one(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments)
     VALUES ($1, 'Enrollment UI Fee', '2026-27', 5000, 1) RETURNING id`,
    [course.id]
  );
  const assignment = await db.one(
    `INSERT INTO assignments (batch_id, subject_id, title, status, due_at)
     VALUES ($1, $2, 'History assignment', 'published', now() + interval '2 days') RETURNING id`,
    [batches.A.id, subject.id]
  );
  for (const student of students) {
    await db.query(
      `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, status)
       VALUES ($1, $2, 5000, 0, 5000, 'pending')`,
      [student.id, structure.id]
    );
    await db.query(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content_text, status, submitted_at)
       VALUES ($1, $2, 'History work remains readable', 'submitted', now() - interval '1 day')`,
      [assignment.id, student.id]
    );
  }

  const today = (await db.one("SELECT to_char(institute_today(), 'YYYY-MM-DD') AS today")).today;
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const appUrl = `http://127.0.0.1:${server.address().port}`;

  const apiRequest = async (pathname, { method = "GET", cookie, body } = {}) => {
    const response = await fetch(`${appUrl}${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      json: text ? JSON.parse(text) : null,
      text
    };
  };
  const apiLogin = async (email) => {
    const response = await apiRequest("/api/auth/login", { method: "POST", body: { email, password } });
    if (response.status !== 200) throw new Error(`API login failed for ${email}: ${response.text}`);
    return cookieFrom(response);
  };

  const debugPort = await freePort();
  const browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${path.join(tempDir, "chrome")}`,
      `--remote-debugging-port=${debugPort}`,
      `${appUrl}/login`
    ],
    { stdio: "ignore" }
  );

  const cleanup = async () => {
    browser.kill();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    await rm(tempDir, { recursive: true, force: true });
  };

  try {
    let target;
    await waitFor("the browser debugger", async () => {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
        return Boolean(target) || "no page target";
      } catch {
        return "debugger not ready";
      }
    });
    const page = await connectPage(target.webSocketDebuggerUrl);

    const setViewport = async (width, height) => {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600
      });
    };
    await setViewport(1360, 1000);

    const text = () => page.evaluate("document.body.innerText");
    const waitText = (needle, timeout = 15000) =>
      waitFor(`text ${needle}`, async () => {
        const body = await text();
        return body.includes(needle) || body.slice(0, 400);
      }, timeout);
    const shot = async (name) => {
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(shotDir, `${name}.png`);
      await fs.promises.writeFile(file, Buffer.from(data, "base64"));
      console.log(`SHOT  ${path.relative(repoRoot, file)}`);
    };
    const setValue = (selector, value) =>
      page.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return "missing";
        const proto = element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(element, ${JSON.stringify(String(value))});
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return "set";
      })()`);
    const clickText = (needle) =>
      page.evaluate(`(() => {
        const element = [...document.querySelectorAll("button, a")].find(
          (node) => node.offsetParent !== null && node.textContent.trim().includes(${JSON.stringify(needle)})
        );
        if (!element) return "not found";
        element.scrollIntoView({ block: "center" });
        element.click();
        return "clicked";
      })()`);
    const clickDialogButton = (label) =>
      page.evaluate(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"], .modal')].find(
          (node) => node.offsetParent !== null
        );
        const button = [...(dialog ?? document).querySelectorAll("button")].find(
          (node) => node.textContent.trim() === ${JSON.stringify(label)}
        );
        if (!button) return "missing";
        button.scrollIntoView({ block: "center" });
        button.click();
        return "clicked";
      })()`);
    const waitDialogClosed = () =>
      waitFor("the dialog to close", async () => {
        const open = await page.evaluate(
          `[...document.querySelectorAll('[role="dialog"], .modal')].some((node) => node.offsetParent !== null)`
        );
        return !open || "still open";
      }, 12000);
    const rowText = (code) =>
      page.evaluate(`(() => {
        const row = [...document.querySelectorAll(".list__item")].find((node) =>
          node.innerText.includes(${JSON.stringify(code)})
        );
        return row?.innerText ?? "";
      })()`);
    const waitRow = (code, status) =>
      waitFor(`enrollment ${code} ${status}`, async () => {
        const value = await rowText(code);
        return value.includes(status) || value || "row missing";
      }, 15000);
    const scrollRow = (code) =>
      page.evaluate(`(() => {
        const row = [...document.querySelectorAll(".list__item")].find((node) =>
          node.innerText.includes(${JSON.stringify(code)})
        );
        row?.scrollIntoView({ block: "center" });
        return Boolean(row);
      })()`);
    const clickRowButton = (code, label) =>
      page.evaluate(`(() => {
        const row = [...document.querySelectorAll(".list__item")].find((node) =>
          node.innerText.includes(${JSON.stringify(code)})
        );
        const button = [...(row?.querySelectorAll("button") ?? [])].find(
          (node) => node.textContent.trim() === ${JSON.stringify(label)}
        );
        if (!button) return "missing";
        button.scrollIntoView({ block: "center" });
        button.click();
        return "clicked";
      })()`);

    const login = async (email) => {
      await waitFor("login form", async () => {
        const fields = await page.evaluate('document.querySelectorAll("form input").length');
        return Number(fields) >= 2 || `fields=${fields}`;
      });
      await setValue("form input[type=email], form input", email);
      await setValue("form input[type=password]", password);
      await page.evaluate('document.querySelector("form").requestSubmit()');
      await waitFor("signed-in route", async () => {
        const pathname = await page.evaluate("location.pathname");
        return pathname !== "/login" ? true : pathname;
      });
    };

    const assignBatch = async (student, code, { from = today, until = today } = {}) => {
      await page.send("Page.navigate", { url: `${appUrl}/admin/students/${student.id}` });
      await waitText(student.fullName);
      await clickText("Enrol");
      await waitText("Enrol in a batch");
      await setValue("#enroll-batch", batches[code].id);
      await setValue("#enroll-from", from);
      await setValue("#enroll-until", until);
      await clickDialogButton("Enrol student");
      await waitDialogClosed();
      await waitRow(`ENR-UI-${code}`, "active");
      console.log(`PASS  ${student.viewport.label}: assigned ${student.fullName} to batch ${code} (${from} → ${until})`);
    };

    const closeBatch = async (student, code, action) => {
      await page.send("Page.navigate", { url: `${appUrl}/admin/students/${student.id}` });
      await waitText(student.fullName);
      await clickRowButton(`ENR-UI-${code}`, action);
      await waitText(action === "Withdraw" ? "Withdraw enrolment" : "Complete enrolment");
      await clickDialogButton(action);
      await waitDialogClosed();
      await waitRow(`ENR-UI-${code}`, action === "Withdraw" ? "dropped" : "completed");
      console.log(`PASS  ${student.viewport.label}: ${action === "Withdraw" ? "withdrew" : "completed"} batch ${code}`);
    };

    const runTransferConflict = async (student) => {
      await page.send("Page.navigate", { url: `${appUrl}/admin/students/${student.id}` });
      await waitText(student.fullName);
      await waitRow("ENR-UI-A", "active");
      await waitRow("ENR-UI-D", "active");
      const before = await db.one("SELECT status FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
        student.id,
        batches.A.id
      ]);
      const beforeCount = await db.one("SELECT count(*)::int AS count FROM enrollments WHERE student_id = $1", [
        student.id
      ]);
      await clickRowButton("ENR-UI-A", "Transfer");
      await waitText("Transfer enrolment");
      await setValue("#transfer-batch", batches.D.id);
      await clickDialogButton("Transfer");
      await waitText("already has an enrolment in that batch", 10000);
      const after = await db.one("SELECT status, transfer_to_enrollment_id FROM enrollments WHERE student_id = $1 AND batch_id = $2", [
        student.id,
        batches.A.id
      ]);
      const afterCount = await db.one("SELECT count(*)::int AS count FROM enrollments WHERE student_id = $1", [
        student.id
      ]);
      if (before.status !== "active" || after.status !== "active" || after.transfer_to_enrollment_id !== null) {
        throw new Error("a failed transfer changed the source enrollment");
      }
      if (beforeCount.count !== afterCount.count) throw new Error("a failed transfer created a target row");
      console.log(`PASS  ${student.viewport.label}: occupied target rejected and source stayed active`);
      await shot(`${student.viewport.label === "desktop" ? "23" : "28"}-transfer-conflict-${student.viewport.label}`);
      await clickDialogButton("Cancel");
      await waitDialogClosed();
    };

    const transferTo = async (student, targetCode) => {
      await page.send("Page.navigate", { url: `${appUrl}/admin/students/${student.id}` });
      await waitText(student.fullName);
      await waitRow("ENR-UI-A", "active");
      await clickRowButton("ENR-UI-A", "Transfer");
      await waitText("Transfer enrolment");
      await setValue("#transfer-batch", batches[targetCode].id);
      await clickDialogButton("Transfer");
      await waitDialogClosed();
      await waitRow("ENR-UI-A", "transferred");
      await waitRow(`ENR-UI-${targetCode}`, "active");
      const sourceHistory = await rowText("ENR-UI-A");
      if (!sourceHistory.includes(`Transferred to Enrollment UI Batch ${targetCode}`)) {
        throw new Error("the transferred history row does not name its destination batch");
      }
      console.log(`PASS  ${student.viewport.label}: transferred A → ${targetCode}, destination shown in history`);
      await scrollRow("ENR-UI-A");
      await sleep(200);
      await shot(`${student.viewport.label === "desktop" ? "24" : "29"}-transfer-success-${student.viewport.label}`);
    };

    const verifyStudentHistory = async (student) => {
      const cookie = await apiLogin(student.email);
      const courses = await apiRequest("/api/student/courses", { cookie });
      if (courses.status !== 200) throw new Error(courses.text);
      if (!courses.json.items.some((row) => row.batchId === batches.E.id)) {
        throw new Error("the valid target enrollment is not readable on its inclusive end date");
      }
      const assignments = await apiRequest("/api/student/assignments", { cookie });
      if (assignments.status !== 200) throw new Error(assignments.text);
      const history = assignments.json.items.find((row) => row.id === assignment.id);
      if (!history?.submission) throw new Error("submitted work disappeared after transfer");
      const detail = await apiRequest(`/api/student/assignments/${assignment.id}`, { cookie });
      if (detail.status !== 200 || detail.json.submission?.contentText !== "History work remains readable") {
        throw new Error("historical assignment detail is not readable after transfer");
      }
      const fees = await apiRequest("/api/student/fees", { cookie });
      if (fees.status !== 200) throw new Error(fees.text);
      if (fees.json.summary.billed !== 5000 || fees.json.invoices.length !== 1) {
        throw new Error("same-course fee was not retained after transfer");
      }
      console.log(`PASS  ${student.viewport.label}: history, submitted work and the same-course fee remain readable`);
    };

    await login("enroll.admin@test.local");

    for (const student of students) {
      await setViewport(student.viewport.width, student.viewport.height);
      await page.send("Page.navigate", { url: `${appUrl}/admin/students/${student.id}` });
      await waitText(student.fullName);

      await assignBatch(student, "A");
      await scrollRow("ENR-UI-A");
      await sleep(200);
      await shot(`${student.viewport.label === "desktop" ? "20" : "25"}-assign-${student.viewport.label}`);
      const afterAssign = await db.one(
        `SELECT status, to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
                to_char(valid_until, 'YYYY-MM-DD') AS valid_until
         FROM enrollments WHERE student_id = $1 AND batch_id = $2`,
        [student.id, batches.A.id]
      );
      if (afterAssign.status !== "active" || afterAssign.valid_until !== today || afterAssign.valid_from !== today) {
        throw new Error(`validity was not stored as the inclusive institute date ${today}: ${JSON.stringify(afterAssign)}`);
      }
      const studentCookie = await apiLogin(student.email);
      const learning = await apiRequest("/api/student/courses", { cookie: studentCookie });
      if (learning.status !== 200 || !learning.json.items.some((row) => row.batchId === batches.A.id)) {
        throw new Error("learning is not open through the inclusive end date in Asia/Kolkata");
      }
      console.log(`PASS  ${student.viewport.label}: validity is inclusive through ${today} in Asia/Kolkata`);

      await assignBatch(student, "D");
      await assignBatch(student, "B");
      await closeBatch(student, "B", "Withdraw");
      await scrollRow("ENR-UI-B");
      await sleep(200);
      await shot(`${student.viewport.label === "desktop" ? "21" : "26"}-withdraw-${student.viewport.label}`);

      await assignBatch(student, "C");
      await closeBatch(student, "C", "Complete");
      await scrollRow("ENR-UI-C");
      await sleep(200);
      await shot(`${student.viewport.label === "desktop" ? "22" : "27"}-complete-${student.viewport.label}`);

      const moneyBefore = await db.one(
        `SELECT
          (SELECT count(*)::int FROM student_fees WHERE student_id = $1) AS invoices,
          (SELECT count(*)::int FROM payments WHERE student_id = $1) AS payments,
          (SELECT COALESCE(SUM(net_amount), 0)::numeric FROM student_fees WHERE student_id = $1) AS billed`,
        [student.id]
      );
      await runTransferConflict(student);
      await transferTo(student, "E");
      const moneyAfter = await db.one(
        `SELECT
          (SELECT count(*)::int FROM student_fees WHERE student_id = $1) AS invoices,
          (SELECT count(*)::int FROM payments WHERE student_id = $1) AS payments,
          (SELECT COALESCE(SUM(net_amount), 0)::numeric FROM student_fees WHERE student_id = $1) AS billed`,
        [student.id]
      );
      if (JSON.stringify(moneyBefore) !== JSON.stringify(moneyAfter)) {
        throw new Error("same-course transfer moved fee data");
      }
      await verifyStudentHistory(student);
    }

    console.log("\nENROLLMENT UI OK  assign, withdraw, complete, conflict-safe transfer, mobile and fee retention");
    page.close();
  } finally {
    await cleanup();
  }
}

await main().catch((error) => {
  console.error(`\nENROLLMENT UI FAILED  ${error.message}`);
  if (process.env.SMOKE_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
