#!/usr/bin/env node
/**
 * One dependency-free browser smoke test: real Chromium/Edge, real built SPA,
 * real API (PGlite in a temp directory, so no dev database is touched).
 *
 *   pnpm build && pnpm smoke:ui
 *
 * What it covers:
 *   1. a student signs in through the login form and lands on /student;
 *   2. the same session is redirected away from /admin (role-scoped routing);
 *   3. an admin signs in and the admin dashboard renders its stats.
 *
 * Uses the Chrome DevTools Protocol over Node's built-in WebSocket, so there is
 * nothing to install. Set CHROME_PATH to use a specific browser binary.
 * If no Chromium-based browser is found the script exits 0 with a notice,
 * because this check is a smoke test, not a build gate.
 */
import fs from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = path.join(repoRoot, "apps", "web", "dist", "index.html");

if (!fs.existsSync(distIndex)) {
  console.error("No web build found. Run `pnpm build` before `pnpm smoke:ui`.");
  process.exit(1);
}

const { createDatabase } = await import("@coaching/db");
const { hashPassword } = await import("@coaching/auth");
const { createApp } = await import("../apps/api/src/app.js");

const migrationsDir = path.join(repoRoot, "database", "migrations");

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  return candidates.filter(Boolean).find((candidate) => fs.existsSync(candidate));
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last === true) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}${last ? `: ${last}` : ""}`);
}

/** Minimal CDP client over Node's built-in WebSocket. */
async function connectPage(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
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
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  return { send, evaluate, close: () => socket.close() };
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) {
    console.log("SKIP  no Chromium/Edge binary found (set CHROME_PATH to run the smoke test)");
    return;
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coaching-ui-smoke-"));
  const db = await createDatabase({ connectionString: "", pgliteDir: path.join(tempDir, "db"), allowLocal: true });
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.transaction((tx) => tx.exec(sql));
  }

  const password = "SmokePass123";
  const addUser = async (email, fullName, role) => {
    const { rows } = await db.query(
      "INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id",
      [email, hashPassword(password), fullName]
    );
    await db.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)", [rows[0].id, role]);
    return rows[0].id;
  };
  const studentId = await addUser("smoke.student@test.local", "Smoke Student", "student");
  await db.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, 'ENR-SMOKE-1')", [studentId]);
  await addUser("smoke.admin@test.local", "Smoke Admin", "super_admin");

  const course = await db.query("INSERT INTO courses (code, name, duration_months) VALUES ('SMOKE', 'Smoke Course', 12) RETURNING id");
  const batch = await db.query(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'SMOKE-B1', 'Smoke Batch', '2026-01-05', '2027-01-04', 20) RETURNING id`,
    [course.rows[0].id]
  );
  await db.query("INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)", [
    studentId,
    batch.rows[0].id,
    course.rows[0].id
  ]);

  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const appUrl = `http://127.0.0.1:${server.address().port}`;

  const debugPort = await freePort();
  const profileDir = path.join(tempDir, "chrome");
  const browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=${profileDir}`,
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
    const shotDir = path.join(repoRoot, "docs", "verification");
    const shot = async (name) => {
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      await fs.promises.writeFile(path.join(shotDir, `${name}.png`), Buffer.from(data, "base64"));
      console.log(`SHOT  docs/verification/${name}.png`);
    };

    const fillLogin = async (email) => {
      await page.evaluate(`(() => {
        const inputs = [...document.querySelectorAll("form input")];
        if (inputs.length < 2) return "no form";
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        const write = (el, value) => {
          set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        write(inputs[0], ${JSON.stringify(email)});
        write(inputs[1], ${JSON.stringify(password)});
        document.querySelector("form").requestSubmit();
        return "submitted";
      })()`);
      await waitFor("the sign-in redirect", async () => {
        const url = await page.evaluate("location.pathname + location.search");
        return url !== "/login" && (url.startsWith("/student") || url.startsWith("/admin") ? true : url);
      });
    };

    // 1. Student signs in and sees their own dashboard.
    await waitFor("the login form", async () => {
      const ready = await page.evaluate("document.readyState");
      const fields = await page.evaluate('document.querySelectorAll("form input").length');
      return ready === "complete" && Number(fields) >= 2 ? true : `readyState=${ready} fields=${fields}`;
    });
    await fillLogin("smoke.student@test.local");
    console.log("PASS  student login lands on /student");
    await waitFor("the student dashboard heading", async () => {
      const heading = await page.evaluate('document.querySelector("h1")?.textContent?.trim() ?? ""');
      return heading.length > 0 || "heading not rendered yet";
    });
    const studentHeading = await page.evaluate('document.querySelector("h1")?.textContent ?? ""');
    console.log(`PASS  student dashboard rendered ("${studentHeading.trim()}")`);

    // 1b. Student mobile app metadata, install surface and offline banner.
    const manifest = await page.evaluate('fetch("/manifest.webmanifest").then((response) => response.json())');
    if (manifest.display !== "standalone") throw new Error("manifest is not standalone");
    const shortcutUrls = (manifest.shortcuts ?? []).map((shortcut) => shortcut.url);
    for (const expected of ["/student", "/student/courses", "/student/exams", "/student/fees"]) {
      if (!shortcutUrls.includes(expected)) throw new Error(`manifest shortcut missing ${expected}`);
    }
    console.log("PASS  student app manifest exposes Home, Learn, Tests and Fees shortcuts");

    const worker = await page.evaluate(`(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 10000))
      ]);
      return registration ? "ready" : "timeout";
    })()`);
    if (worker !== "ready") throw new Error(`service worker did not become ready: ${worker}`);
    console.log("PASS  production service worker is active");

    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await page.send("Page.navigate", { url: `${appUrl}/student/profile` });
    await waitFor("the student app card", async () => {
      const body = await page.evaluate("document.body.innerText");
      return body.includes("Student mobile app") || body.slice(0, 300);
    });
    await page.evaluate(`window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), {
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: "dismissed" })
    }))`);
    await waitFor("the install button", async () => {
      const visible = await page.evaluate(`[...document.querySelectorAll("button")].some(
        (node) => node.offsetParent !== null && node.textContent.includes("Install student app")
      )`);
      return visible;
    });
    await page.evaluate(`document.querySelectorAll(".card__title")[1]?.closest(".card")?.scrollIntoView({ block: "center" })`);
    await sleep(200);
    await shot("44-student-app-mobile");
    await page.evaluate(`[...document.querySelectorAll("button")]
      .find((node) => node.textContent.includes("Install student app"))?.click()`);
    await waitFor("the install cancellation message", async () => {
      const body = await page.evaluate("document.body.innerText");
      return body.includes("Install cancelled") || body.slice(0, 300);
    });
    console.log("PASS  student app card shows the install action and its outcome");

    await page.evaluate('window.scrollTo(0, 0); window.dispatchEvent(new Event("offline"))');
    await waitFor("the offline banner", async () => {
      const body = await page.evaluate("document.body.innerText");
      return body.includes("You are offline") || body.slice(0, 300);
    });
    await sleep(200);
    await shot("45-student-app-offline");
    await page.evaluate('window.dispatchEvent(new Event("online"))');
    console.log("PASS  student app shows and clears the offline banner");

    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1360,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });

    // 2. Role-scoped routing: a student cannot stay on /admin.
    await page.send("Page.navigate", { url: `${appUrl}/admin` });
    await waitFor("/admin to be rejected", async () => {
      const url = await page.evaluate("location.pathname");
      return url === "/student" ? true : url;
    });
    console.log("PASS  student is redirected from /admin to /student");

    // 3. Sign out through the API, then sign in as the admin.
    await page.evaluate(`fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .then(() => { location.href = "/login"; })`);
    await waitFor("the login form after sign-out", async () => {
      const url = await page.evaluate("location.pathname");
      const fields = await page.evaluate('document.querySelectorAll("form input").length');
      return url === "/login" && Number(fields) >= 2 ? true : `${url} fields=${fields}`;
    });
    console.log("PASS  sign-out returns to /login");

    await fillLogin("smoke.admin@test.local");
    await waitFor("the admin dashboard", async () => {
      const url = await page.evaluate("location.pathname");
      if (url !== "/admin") return url;
      const text = await page.evaluate("document.body.innerText");
      return text.includes("Students") && text.includes("Fees") ? true : "stats not rendered yet";
    });
    console.log("PASS  admin login lands on /admin and the dashboard stats render");

    page.close();
    console.log("\nSMOKE OK  login, role scoping and admin dashboard passed in a real browser");
  } finally {
    await cleanup();
  }
}

await main().catch((error) => {
  console.error(`\nSMOKE FAILED  ${error.message}`);
  if (process.env.SMOKE_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
