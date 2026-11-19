#!/usr/bin/env node
/**
 * Student learning walkthrough on a disposable PGlite database.
 *
 * The teacher creates two lessons and a PDF note through the real teacher UI.
 * The student then sees them on Home, navigates course -> subject -> lesson,
 * resumes at a saved position, marks the lesson complete, reloads and confirms
 * the progress survives. The same pages are checked at 390px, including that
 * the fixed bottom navigation does not cover the last controls. A failing
 * dashboard request is used to render the network-error state.
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coaching-learning-ui-"));
  const db = await createDatabase({ connectionString: "", pgliteDir: path.join(tempDir, "db"), allowLocal: true });
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }
  await db.query("UPDATE app_settings SET value = 'Asia/Kolkata' WHERE key = 'instituteTimezone'");

  const password = "LearnPass123";
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
    if (role === "teacher") {
      await db.query("INSERT INTO teacher_profiles (user_id, employee_code) VALUES ($1, $2)", [
        rows[0].id,
        `EMP-${email}`
      ]);
    }
    return rows[0].id;
  };

  await addUser("learn.admin@test.local", "Learn Admin", "super_admin");
  const teacherId = await addUser("learn.teacher@test.local", "Learn Teacher", "teacher");
  const studentId = await addUser("learn.student@test.local", "Learn Student", "student");

  const course = await db.one(
    "INSERT INTO courses (code, name, duration_months) VALUES ('LEARN', 'Learning Course', 12) RETURNING id"
  );
  const subject = await db.one(
    "INSERT INTO subjects (code, name) VALUES ('ALG', 'Algebra') RETURNING id"
  );
  await db.query("INSERT INTO course_subjects (course_id, subject_id) VALUES ($1, $2)", [course.id, subject.id]);
  const batch = await db.one(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'LEARN-A', 'Learning Batch A', '2026-01-01', '2027-12-31', 30) RETURNING id`,
    [course.id]
  );
  await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2)", [batch.id, subject.id]);
  await db.query(
    "INSERT INTO batch_teachers (batch_id, teacher_id, subject_id, is_primary) VALUES ($1, $2, $3, true)",
    [batch.id, teacherId, subject.id]
  );
  await db.query(
    `INSERT INTO enrollments (student_id, batch_id, course_id, valid_from, valid_until)
     VALUES ($1, $2, $3, institute_today() - 20, institute_today() + 120)`,
    [studentId, batch.id, course.id]
  );
  await db.query(
    `INSERT INTO batch_schedules (batch_id, subject_id, day_of_week, start_time, end_time, room)
     VALUES ($1, $2, EXTRACT(DOW FROM institute_today() + 1)::int, '09:00', '10:00', 'Room 4')`,
    [batch.id, subject.id]
  );
  const assignment = await db.one(
    `INSERT INTO assignments (batch_id, subject_id, title, instructions, due_at, max_marks, status)
     VALUES ($1, $2, 'Practice: linear equations', 'Solve exercises 1-5 before class.', now() + interval '2 days', 20, 'published')
     RETURNING id`,
    [batch.id, subject.id]
  );
  await db.query(
    `INSERT INTO exams (batch_id, subject_id, title, exam_type, starts_at, ends_at, duration_minutes,
                        total_marks, pass_marks, max_attempts, status)
     VALUES ($1, $2, 'Algebra weekly test', 'mcq', now() + interval '1 day', now() + interval '2 days',
             30, 20, 8, 1, 'published')`,
    [batch.id, subject.id]
  );
  const feeStructure = await db.one(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments)
     VALUES ($1, 'Learning Course Fee', '2026-27', 5000, 1) RETURNING id`,
    [course.id]
  );
  await db.query(
    `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, status)
     VALUES ($1, $2, 5000, 0, 5000, 'pending')`,
    [studentId, feeStructure.id]
  );
  await db.query(
    `INSERT INTO announcements (title, body, audience, batch_id, published_at)
     VALUES ('Bring your formula sheet', 'We will revise linear equations in the next class.', 'batch', $1, now())`,
    [batch.id]
  );

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
        return body.includes(needle) || body.slice(0, 500);
      }, timeout);
    const waitNoText = (needle, timeout = 10000) =>
      waitFor(`text to disappear ${needle}`, async () => {
        const body = await text();
        return !body.includes(needle) || body.slice(0, 500);
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

    /* ------------------------------------------------ small admin UI fixes */
    await login("learn.admin@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/admin` });
    await waitText("Dashboard");
    const adminChrome = await page.evaluate(`(() => {
      const brand = document.querySelector(".brand");
      const name = brand?.querySelector(".brand__name")?.getBoundingClientRect();
      const sub = brand?.querySelector(".brand__sub")?.getBoundingClientRect();
      const chipName = document.querySelector(".user-chip__name")?.getBoundingClientRect();
      const chipMeta = document.querySelector(".user-chip__meta")?.getBoundingClientRect();
      const profileLinks = [...document.querySelectorAll(".sidebar__link")].filter(
        (node) => node.textContent.trim() === "My profile"
      ).length;
      return {
        nameBottom: name?.bottom ?? 0,
        subTop: sub?.top ?? 0,
        chipNameBottom: chipName?.bottom ?? 0,
        chipMetaTop: chipMeta?.top ?? 0,
        profileLinks
      };
    })()`);
    if (adminChrome.subTop < adminChrome.nameBottom - 1) throw new Error("institute name and role label overlap");
    if (adminChrome.chipMetaTop < adminChrome.chipNameBottom - 1) throw new Error("account name and email overlap");
    if (adminChrome.profileLinks !== 1) throw new Error(`expected one My profile link, found ${adminChrome.profileLinks}`);
    console.log("PASS  institute/role, name/email and duplicate profile link separated");
    await shot("30-admin-brand-account");

    /* ------------------------------------------------------ teacher publishes */
    await logout();
    await login("learn.teacher@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/teacher/lectures?batch=${batch.id}` });
    await waitText("Add lecture");

    const publishLesson = async ({ title, chapter, videoId, duration }) => {
      await clickText("Add lecture");
      await waitText("Add lecture");
      await setValue("#l-subject", subject.id);
      await setValue("#l-title", title);
      await setValue("#l-chapter", chapter);
      if (videoId) await setValue("#l-video", videoId);
      await setValue("#l-duration", duration);
      await clickText("Create lecture");
      await waitNoText("Create lecture", 12000);
      await waitText(title, 12000);
      const row = await db.one("SELECT id, status FROM lessons WHERE title = $1 ORDER BY created_at DESC LIMIT 1", [title]);
      if (row?.status !== "published") throw new Error(`teacher did not publish ${title}`);
      return row.id;
    };

    const videoLessonId = await publishLesson({
      title: "Algebra: linear equations",
      chapter: "Chapter 1",
      videoId: "M7lc1UVf-VE",
      duration: 15
    });
    const readingLessonId = await publishLesson({
      title: "Reading and notes",
      chapter: "Revision",
      videoId: "",
      duration: 10
    });
    console.log("PASS  teacher published a video lesson and a PDF-only lesson");

    await page.send("Page.navigate", { url: `${appUrl}/teacher/materials?batch=${batch.id}` });
    await waitText("Add material");
    await clickText("Add material");
    await waitText("Add material");
    await setValue("#m-subject", subject.id);
    await setValue("#m-title", "Linear equations formula sheet");
    await setValue("#m-chapter", "Chapter 1");
    await setValue("#m-url", "https://drive.google.com/file/d/learn-formula-sheet/view");
    await setValue("#m-description", "Printable formula sheet for the video lesson.");
    await clickText("Create material");
    await waitNoText("Create material", 12000);
    await waitText("Linear equations formula sheet", 12000);
    const material = await db.one("SELECT id, status FROM study_materials WHERE title = 'Linear equations formula sheet'");
    if (material?.status !== "published") throw new Error("teacher did not publish the PDF note");
    console.log("PASS  teacher published a link-based PDF note");
    await page.send("Page.navigate", { url: `${appUrl}/teacher/lectures?batch=${batch.id}` });
    await waitText("Algebra: linear equations");
    await waitText("Reading and notes");
    await shot("31-teacher-published-lessons");

    /* ------------------------------------------------------------ student home */
    await logout();
    await login("learn.student@test.local");
    await page.send("Page.navigate", { url: `${appUrl}/student` });
    await waitText("Resume learning");
    await waitText("Algebra: linear equations");
    await waitText("Next class");
    await waitText("Practice: linear equations");
    await waitText("Algebra weekly test");
    await waitText("Bring your formula sheet");
    await waitText("Total fees");
    if (!(await text()).includes("₹5,000")) throw new Error("home fee summary did not render");
    console.log("PASS  home shows resume, next class, pending work, test, notice and fees");
    await shot("32-home-desktop");

    await page.send("Page.navigate", { url: `${appUrl}/student/courses` });
    await waitText("Learning Batch A");
    await waitText("Algebra");
    if (!(await text()).includes("2 lessons")) throw new Error("course subject count did not render");
    console.log("PASS  Learn starts with course and subject counts");
    await shot("33-courses-desktop");
    await clickText("Algebra");
    await waitText("Algebra: linear equations");
    await waitText("PDF ×1");
    console.log("PASS  subject opens its lessons with video and PDF labels");
    await shot("34-lessons-desktop");

    await clickText("Reading and notes");
    await waitText("Video unavailable");
    await waitText("Attached PDFs and notes");
    console.log("PASS  a lesson without a video shows the unavailable-link guidance and its PDF notes");
    await shot("34b-lesson-no-video");

    await page.send("Page.navigate", { url: `${appUrl}/student/lectures/${videoLessonId}` });
    await waitText("Algebra: linear equations");
    await waitText("Attached PDFs and notes");
    await waitText("Open PDF");
    const videoSrc = await page.evaluate('document.querySelector(".video-frame iframe")?.src ?? ""');
    if (!videoSrc.includes("M7lc1UVf-VE")) throw new Error(`YouTube player missing: ${videoSrc}`);
    console.log("PASS  lesson page renders the YouTube player and attached PDF link");
    await shot("35-lesson-desktop");

    const progressStatus = await page.evaluate(
      `fetch(${JSON.stringify(`/api/student/lessons/${videoLessonId}/progress`)}, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionSeconds: 120 })
      }).then((response) => response.status)`
    );
    if (progressStatus !== 200) throw new Error(`saving progress returned ${progressStatus}`);
    await page.send("Page.reload");
    await waitText("Resume from 2:00", 15000);
    const resumedSrc = await page.evaluate('document.querySelector(".video-frame iframe")?.src ?? ""');
    if (!resumedSrc.includes("start=120")) throw new Error("the player did not resume at the saved position");
    console.log("PASS  refresh restored the saved position and resumed the player");
    await shot("36-lesson-resume");

    await clickText("Mark watched");
    await waitText("Completed", 12000);
    await page.send("Page.reload");
    await waitText("Completed", 15000);
    const persisted = await db.one(
      "SELECT last_position_seconds, completed_at FROM lesson_progress WHERE student_id = $1 AND lesson_id = $2",
      [studentId, videoLessonId]
    );
    if (!persisted.completed_at) throw new Error("completion did not survive the refresh");
    console.log("PASS  completion persisted across a full page refresh");
    await shot("37-lesson-completed-refresh");

    await page.send("Page.navigate", { url: `${appUrl}/student` });
    await waitText("Resume learning");
    await waitText("Reading and notes");
    console.log("PASS  Home moved the resume card to the next unfinished lesson");
    await shot("38-home-resume-next");

    /* ----------------------------------------------------------- 390px mobile */
    await setViewport(390, 844);
    await page.send("Page.navigate", { url: `${appUrl}/student` });
    await waitText("Resume learning");
    const mobileHome = await page.evaluate(`(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth
    }))()`);
    if (mobileHome.width > mobileHome.viewport + 1) {
      throw new Error(`home overflows horizontally: ${mobileHome.width} > ${mobileHome.viewport}`);
    }
    console.log("PASS  mobile Home has no horizontal overflow");
    await shot("39-home-mobile");

    await page.send("Page.navigate", { url: `${appUrl}/student/courses` });
    await waitText("Algebra");
    await shot("40-courses-mobile");
    await clickText("Algebra");
    await waitText("PDF ×1");
    await shot("41-lessons-mobile");

    await clickText("Algebra: linear equations");
    await waitText("Attached PDFs and notes");
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await sleep(300);
    const bottomLayout = await page.evaluate(`(() => {
      const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
      const controls = [...document.querySelectorAll(".student-content a, .student-content button")]
        .filter((node) => node.offsetParent !== null)
        .map((node) => node.getBoundingClientRect());
      const lastBottom = controls.length ? Math.max(...controls.map((rect) => rect.bottom)) : 0;
      return {
        navTop: nav?.top ?? 0,
        lastBottom,
        gap: (nav?.top ?? 0) - lastBottom,
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth
      };
    })()`);
    if (bottomLayout.gap < 0) {
      throw new Error(`bottom navigation covers the last lesson control by ${-bottomLayout.gap}px`);
    }
    if (bottomLayout.width > bottomLayout.viewport + 1) {
      throw new Error("mobile lesson overflows horizontally");
    }
    console.log(`PASS  mobile bottom nav clears the last control by ${Math.round(bottomLayout.gap)}px`);
    await shot("42-lesson-mobile");

    /* ------------------------------------------------------- network error UI */
    await page.send("Network.enable");
    await page.send("Network.setBlockedURLs", { urls: ["*api/student/dashboard*"] });
    await page.send("Page.navigate", { url: `${appUrl}/student` });
    await waitText("Cannot reach the server", 15000);
    await waitText("We could not load this data", 10000);
    console.log("PASS  a failed dashboard request rendered the network-error state");
    await shot("43-home-network-error");
    await page.send("Network.setBlockedURLs", { urls: [] });
    await clickText("Retry");
    await waitText("Resume learning", 15000);
    console.log("PASS  Retry recovered the Home page");

    if (!readingLessonId || !assignment.id) throw new Error("fixture identifiers missing");
    console.log(`\nSTUDENT LEARNING OK  teacher published, student learned, progress survived refresh at desktop and 390px`);
    page.close();
  } finally {
    await cleanup();
  }
}

await main().catch((error) => {
  console.error(`\nSTUDENT LEARNING FAILED  ${error.message}`);
  if (process.env.SMOKE_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
