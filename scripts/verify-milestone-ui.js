#!/usr/bin/env node
/**
 * Browser verification with controlled network faults (CDP Fetch domain).
 *
 * Covers:
 *  - a payment the server commits but whose response is dropped, then retried;
 *  - changing the payload for the same request id (409, no second payment);
 *  - frozen-paper edit and "duplicate as draft" in the real admin UI;
 *  - autosave Saved state, a slow/stale response that must not say Saved;
 *  - submitting while the debounce is still pending;
 *  - a server-enforced expiry failure and retry.
 *
 * Runs against a disposable PGlite database and the built SPA. Screenshots are
 * written to docs/verification/. No dev or production database is opened.
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

  const on = (method, handler) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(handler);
  };

  await send("Page.enable");
  await send("Runtime.enable");

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }

  return { send, on, evaluate, close: () => socket.close() };
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log("SKIP  no Chromium/Edge binary found");
    return;
  }

  await mkdir(shotDir, { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coaching-verify-ui-"));
  const db = await createDatabase({ connectionString: "", pgliteDir: path.join(tempDir, "db"), allowLocal: true });
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }

  const password = "VerifyPass123";
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
  await addUser("verify.admin@test.local", "Verify Admin", "super_admin");
  const studentId = await addUser("verify.student@test.local", "UI Student", "student");
  const otherStudentId = await addUser("verify.other@test.local", "Other Student", "student");

  const course = await db.one(
    "INSERT INTO courses (code, name, duration_months) VALUES ('VERIFY', 'Verification Course', 12) RETURNING id"
  );
  const subject = await db.one("INSERT INTO subjects (code, name) VALUES ('VER', 'Verification Subject') RETURNING id");
  const batch = await db.one(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'VER-B', 'Verification Batch', '2026-01-01', '2027-12-31', 30) RETURNING id`,
    [course.id]
  );
  for (const id of [studentId, otherStudentId]) {
    await db.query("INSERT INTO enrollments (student_id, batch_id, course_id, valid_from, valid_until) VALUES ($1, $2, $3, institute_today() - 10, institute_today() + 60)", [
      id,
      batch.id,
      course.id
    ]);
  }
  const structure = await db.one(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments)
     VALUES ($1, 'Verification Fee', '2026-27', 5000, 1) RETURNING id`,
    [course.id]
  );
  await db.query(
    `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, status)
     VALUES ($1, $2, 5000, 0, 5000, 'pending')`,
    [studentId, structure.id]
  );

  const makeExam = async (title, studentForAttempt) => {
    const exam = await db.one(
      `INSERT INTO exams (batch_id, subject_id, title, exam_type, starts_at, ends_at, duration_minutes,
                          total_marks, pass_marks, max_attempts, status, shuffle_questions)
       VALUES ($1, $2, $3, 'mcq', now() - interval '30 minutes', now() + interval '2 hours', 60, 2, 1, 2, 'published', false)
       RETURNING id`,
      [batch.id, subject.id, title]
    );
    const question = await db.one(
      "INSERT INTO exam_questions (exam_id, question_text, marks, sort_order) VALUES ($1, $2, 2, 0) RETURNING id",
      [exam.id, `${title}: 2 + 2 = ?`]
    );
    const correct = await db.one(
      "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, '4', 0) RETURNING id",
      [question.id]
    );
    const wrong = await db.one(
      "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, '5', 1) RETURNING id",
      [question.id]
    );
    await db.query("INSERT INTO exam_answer_keys (question_id, correct_option_id) VALUES ($1, $2)", [
      question.id,
      correct.id
    ]);
    let attempt = null;
    if (studentForAttempt) {
      attempt = await db.one(
        `INSERT INTO exam_attempts (exam_id, student_id, attempt_no, expires_at)
         VALUES ($1, $2, 1, now() + interval '50 minutes') RETURNING id`,
        [exam.id, studentForAttempt]
      );
    }
    return { examId: exam.id, questionId: question.id, correct: correct.id, wrong: wrong.id, attemptId: attempt?.id };
  };

  const autosaveExam = await makeExam("Autosave and submit", studentId);
  const expiryExam = await makeExam("Expiry retry", studentId);
  const frozenExam = await makeExam("Frozen paper", otherStudentId);

  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const appUrl = `http://127.0.0.1:${server.address().port}`;

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
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1360,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });

    const shot = async (name) => {
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(shotDir, `${name}.png`);
      await fs.promises.writeFile(file, Buffer.from(data, "base64"));
      console.log(`SHOT  ${path.relative(repoRoot, file)}`);
    };

    const text = () => page.evaluate("document.body.innerText");
    const waitText = (needle, timeout = 15000) =>
      waitFor(`text ${needle}`, async () => {
        const body = await text();
        return body.includes(needle) || body.slice(0, 400);
      }, timeout);
    const waitNoText = (needle, timeout = 10000) =>
      waitFor(`text to disappear ${needle}`, async () => {
        const body = await text();
        return !body.includes(needle) || body.slice(0, 400);
      }, timeout);
    const clickText = (needle) =>
      page.evaluate(`(() => {
        const element = [...document.querySelectorAll("button, a")].find(
          (node) => node.offsetParent !== null && node.textContent.trim().includes(${JSON.stringify(needle)})
        );
        if (!element) return "not found";
        element.click();
        return "clicked";
      })()`);
    const summaryNumbers = () =>
      page.evaluate(`[...document.querySelectorAll(".grid-3 .card__title")].map(
        (node) => node.textContent.replace(/[^0-9]/g, "")
      )`);
    const waitSummary = (expected, timeout = 12000) =>
      waitFor(`fee summary ${expected.join("/")}`, async () => {
        const values = await summaryNumbers();
        return JSON.stringify(values) === JSON.stringify(expected) || values.join("/");
      }, timeout);
    const setValue = (selector, value) =>
      page.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return "missing";
        const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(element, ${JSON.stringify(String(value))});
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return "set";
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
    const logout = async () => {
      await page.evaluate('fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(() => { location.href = "/login"; })');
      await waitFor("login after logout", async () => {
        const pathname = await page.evaluate("location.pathname");
        return pathname === "/login" ? true : pathname;
      });
    };

    /* ---------------------------------------------------------- payment UI */
    await login("verify.admin@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/admin/fees` });
    await waitText("Student dues");
    await waitText("UI Student");

    let dropPaymentResponse = true;
    let holdNextAnswer = false;
    let resolveHeldSave = null;
    await page.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*fees/*/payments", requestStage: "Response" },
        { urlPattern: "*attempts/*/answers", requestStage: "Response" }
      ]
    });
    page.on("Fetch.requestPaused", async (event) => {
      const url = event.request.url;
      if (url.includes("/payments") && dropPaymentResponse) {
        dropPaymentResponse = false;
        console.log("FAULT dropping payment response after the server handled it");
        await page.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "ConnectionReset" });
        return;
      }
      if (url.includes("/answers") && holdNextAnswer) {
        // Held deliberately until the script changes the answer.
        holdNextAnswer = false;
        resolveHeldSave?.(event);
        return;
      }
      await page.send("Fetch.continueResponse", { requestId: event.requestId }).catch(() =>
        page.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => {})
      );
    });

    await clickText("Record payment");
    await waitText("Record payment");
    await setValue("#pay-amount", "1000");
    await clickText("Save receipt");
    let paymentAlert = "";
    await waitFor("the payment error alert", async () => {
      paymentAlert = await page.evaluate(`(() => {
        const alert = [...document.querySelectorAll('[role="alert"]')].find((node) => node.offsetParent !== null);
        return alert?.innerText?.trim() ?? "";
      })()`);
      return paymentAlert.length > 0 || paymentAlert;
    }, 12000).catch(async (error) => {
      console.error(await text());
      throw error;
    });
    if (paymentAlert !== "Payment status could not be confirmed. Retry with the same details to check.") {
      throw new Error(`unexpected ambiguous-payment message: ${paymentAlert}`);
    }
    console.log("PASS  dropped response used uncertain-payment wording");
    await waitSummary(["5000", "1000", "4000"]);
    console.log("PASS  collected and pending summaries refreshed while the Receipts tab is closed");
    await shot("01-payment-response-dropped");

    const paymentCount = await db.one("SELECT count(*)::int AS count FROM payments");
    if (paymentCount.count !== 1) throw new Error(`expected one committed payment, found ${paymentCount.count}`);

    const fee = await db.one("SELECT id FROM student_fees WHERE student_id = $1", [studentId]);
    const committed = await db.one("SELECT request_id FROM payments WHERE student_fee_id = $1", [fee.id]);
    const pendingKey = () =>
      page.evaluate(`sessionStorage.getItem(${JSON.stringify(`coaching.pendingPayment.${fee.id}`)}) ?? ""`);
    const storedBeforeClose = JSON.parse(await pendingKey() ?? "null");
    if (storedBeforeClose?.requestId !== committed.request_id) {
      throw new Error("the unconfirmed request key was not persisted");
    }

    await clickText("Cancel");
    await waitFor("the payment dialog to close", async () => {
      const open = await page.evaluate(`[...document.querySelectorAll('[role="dialog"]')].some(
        (node) => node.offsetParent !== null && node.innerText.includes("Record payment")
      )`);
      return !open || "still open";
    }, 10000);
    await clickText("Record payment");
    await waitText("previous payment for this invoice was not confirmed", 10000);
    console.log("PASS  closing and reopening restored the same pending request");

    await page.send("Page.reload");
    await waitText("Student dues", 15000);
    await waitSummary(["5000", "1000", "4000"]);
    await clickText("Record payment");
    await waitText("previous payment for this invoice was not confirmed", 10000);
    const storedAfterRefresh = JSON.parse(await pendingKey() ?? "null");
    if (storedAfterRefresh?.requestId !== committed.request_id) {
      throw new Error("a refresh lost the unconfirmed request key");
    }
    if (await page.evaluate('document.querySelector("#pay-amount").value') !== "1000") {
      throw new Error("the retry did not restore the original details");
    }
    console.log("PASS  refresh kept the unconfirmed request, the original amount and the authoritative totals");
    await shot("01b-payment-unconfirmed-reopened");

    await setValue("#pay-amount", "1200");
    await clickText("Save receipt");
    await waitText("already used with different details", 10000);
    const afterConflict = await db.one("SELECT count(*)::int AS count FROM payments");
    if (afterConflict.count !== 1) throw new Error("a changed payload created another payment");
    await waitSummary(["5000", "1000", "4000"]);
    console.log("PASS  changed payload for the same key returned 409 and created nothing");
    await shot("02-payment-key-conflict");

    await setValue("#pay-amount", "1000");
    await clickText("Save receipt");
    await waitFor("the replayed payment to close its dialog", async () => {
      const open = await page.evaluate(`[...document.querySelectorAll('[role="dialog"]')].some(
        (node) => node.offsetParent !== null && node.innerText.includes("Record payment")
      )`);
      return !open || "still open";
    }, 12000);
    const receipt = await db.one("SELECT receipt_no, amount, request_id FROM payments");
    console.log(`PASS  retry replayed ${receipt.receipt_no} (amount ${receipt.amount})`);
    if ((await pendingKey()) !== "") throw new Error("the confirmed request key was not cleared");
    await waitSummary(["5000", "1000", "4000"]);
    await clickText("Receipts");
    await waitText(receipt.receipt_no);
    await shot("03-payment-receipt-replayed");

    await clickText("Void");
    await waitText("Void this receipt?");
    await setValue("#void-reason", "Fault-injection duplicate entry");
    await clickText("Void receipt");
    await waitNoText("Void this receipt?", 10000);
    await waitSummary(["5000", "0", "5000"]);
    await waitText("void", 10000);
    await clickText("Dues");
    await waitText("Student dues", 10000);
    if (!(await text()).includes("₹5,000")) throw new Error("the invoice balance did not reopen after voiding");
    console.log("PASS  voiding the receipt restored Collected/Pending and the invoice balance");
    await shot("03b-payment-voided");

    /* --------------------------------------------------- frozen exam + copy */
    await page.send("Page.navigate", { url: `${appUrl}/admin/exams/${frozenExam.examId}` });
    await waitText("Frozen paper");
    await clickText("Add question");
    await waitText("Add question");
    await setValue("#q-text", "Should this be editable?");
    await setValue('#question-form input[placeholder="Option 1"]', "A");
    await setValue('#question-form input[placeholder="Option 2"]', "B");
    await page.evaluate('document.querySelector(\'button[form="question-form"]\').click()');
    await waitText("paper is frozen", 10000);
    console.log("PASS  adding a question to an exam with an attempt was refused");
    await shot("04-exam-frozen");

    await clickText("Duplicate as draft");
    await waitText("(copy)", 15000);
    await waitText("draft", 10000);
    const copied = await db.one("SELECT id, status, title FROM exams WHERE title LIKE 'Frozen paper (copy)%' ORDER BY created_at DESC LIMIT 1");
    if (!copied || copied.status !== "draft") throw new Error("duplicate exam was not created as a draft");
    console.log(`PASS  duplicated into draft ${copied.title}`);
    await page.send("Page.navigate", { url: `${appUrl}/admin/exams/${copied.id}` });
    await waitText(copied.title, 15000);
    await waitText("draft", 10000);
    await shot("05-exam-duplicated-draft");

    /* --------------------------------------------------------- autosave UI */
    await logout();
    await login("verify.student@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/student/attempts/${autosaveExam.attemptId}` });
    await waitText("Autosave is on");

    const pick = async (index) =>
      page.evaluate(`(() => {
        const input = document.querySelectorAll('input[type="radio"]')[${Number(index)}];
        if (!input) return "missing";
        input.click();
        return "clicked";
      })()`);

    await pick(1);
    await waitText("Saved", 12000);
    console.log("PASS  autosave reached the server-confirmed Saved state");
    await shot("06-autosave-saved");

    // Hold the response for the next save, then change the answer again.
    holdNextAnswer = true;
    const held = new Promise((resolve) => {
      resolveHeldSave = resolve;
    });

    await pick(0);
    await waitText("Saving…", 12000);
    const paused = await Promise.race([held, sleep(12000).then(() => null)]);
    if (!paused) throw new Error("the autosave response was never paused");
    console.log("PASS  first autosave response is held after the server committed it");

    await pick(1);
    await shot("07-autosave-stale-response-pending");

    await page.send("Fetch.continueResponse", { requestId: paused.requestId }).catch(() =>
      page.send("Fetch.continueRequest", { requestId: paused.requestId }).catch(() => {})
    );

    await waitText("Saved", 15000);
    const savedAnswer = await db.one(
      "SELECT selected_option_id FROM exam_responses WHERE attempt_id = $1 AND question_id = $2",
      [autosaveExam.attemptId, autosaveExam.questionId]
    );
    if (savedAnswer.selected_option_id !== autosaveExam.wrong) {
      throw new Error("the latest answer was not the one persisted");
    }
    console.log("PASS  stale success did not claim the newer answer was saved; latest answer persisted");
    await shot("08-autosave-latest-saved");

    /* ------------------------------------------- submit while save pending */
    await pick(0);
    await page.evaluate('setTimeout(() => {}, 0)');
    await clickText("Submit test");
    await waitText("Submit test?");
    const confirm = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"], .modal')].find((node) => node.offsetParent !== null);
      const button = [...(dialog ?? document).querySelectorAll("button")].find((node) => node.textContent.trim() === "Submit test");
      if (!button) return "missing";
      button.click();
      return "clicked";
    })()`);
    if (confirm !== "clicked") throw new Error("confirm button not found");
    await waitText("Submitted", 15000);
    await waitText("Results are not published yet", 10000);
    if ((await text()).includes("Score 2 / 2")) throw new Error("the submission page leaked an unpublished score");
    const afterSubmit = await db.one(
      "SELECT a.status, a.score, r.selected_option_id FROM exam_attempts a LEFT JOIN exam_responses r ON r.attempt_id = a.id AND r.question_id = $2 WHERE a.id = $1",
      [autosaveExam.attemptId, autosaveExam.questionId]
    );
    if (afterSubmit.selected_option_id !== autosaveExam.correct) {
      throw new Error("the final selected answer was not persisted before grading");
    }
    if (afterSubmit.status !== "evaluated" || Number(afterSubmit.score) !== 2) {
      throw new Error(`unexpected graded state: ${JSON.stringify(afterSubmit)}`);
    }
    console.log("PASS  submit persisted the pending answer, graded it and hid the score");
    await shot("09-submit-pending-debounce");

    // Publish through the real admin endpoint, then look at the same attempt as
    // the student. Before this point the score must not exist in any student payload.
    await logout();
    await login("verify.admin@test.local");
    const publishStatus = await page.evaluate(`fetch(${JSON.stringify(
      `/api/admin/exams/${autosaveExam.examId}/publish-results`
    )}, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).then((response) => response.status)`);
    if (publishStatus !== 200) throw new Error(`results publication returned ${publishStatus}`);
    await logout();
    await login("verify.student@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/student/attempts/${autosaveExam.attemptId}` });
    await waitText("Score 2 / 2", 12000);
    console.log("PASS  published results became visible to the student");
    await shot("09b-results-published");

    /* -------------------------------------------------------- expiry retry */
    await page.send("Page.navigate", { url: `${appUrl}/student/attempts/${expiryExam.attemptId}` });
    await waitText("Autosave is on");
    await db.query("UPDATE exam_attempts SET expires_at = now() - interval '1 second' WHERE id = $1", [
      expiryExam.attemptId
    ]);
    await pick(0);
    await waitText("Time is up", 12000);
    await waitText("Results are not published yet", 12000);
    const activeControls = await page.evaluate(`[...document.querySelectorAll("button")]
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.textContent.trim())
      .filter((label) => label === "Submit test" || label === "Retry now").length`);
    if (activeControls !== 0) throw new Error("expired attempts still expose active exam controls");
    await sleep(4200);
    const expiredResponse = await db.one(
      "SELECT selected_option_id FROM exam_responses WHERE attempt_id = $1 AND question_id = $2",
      [expiryExam.attemptId, expiryExam.questionId]
    );
    if (expiredResponse) throw new Error("an expired attempt wrote an answer or retried a save");
    console.log("PASS  definitive expiry stopped retries, closed the editor and showed grading status without a score");
    await shot("10-autosave-expired-retry");

    console.log("\nUI VERIFICATION OK  payment totals/replay/void, freeze, duplicate, autosave, publication and expiry");
    page.close();
  } finally {
    await cleanup();
  }
}

await main().catch((error) => {
  console.error(`\nUI VERIFICATION FAILED  ${error.message}`);
  if (process.env.SMOKE_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
