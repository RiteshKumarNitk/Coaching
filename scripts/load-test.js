/**
 * Dependency-free load generator for the API (no k6/autocannon needed).
 *
 *   pnpm load:test -- --base http://localhost:4000 --email admin@coaching.local \
 *     --password admin123 --concurrency 10 --duration 15 \
 *     --paths "/api/admin/dashboard,/api/admin/exams?page=1"
 *
 * Signs in once, then keeps `concurrency` workers busy for `duration` seconds on the
 * given paths round-robin and reports latency percentiles. Read-only paths only.
 * Exits non-zero when nothing ran or a 5xx/network error occurred; 4xx responses are
 * counted but tolerated (a rate limiter may answer before the app is stressed).
 */
const options = parseArgs(process.argv.slice(2));
const base = options.base || "http://localhost:4000";
const concurrency = toInt(options.concurrency, 10);
const durationSeconds = toInt(options.duration, 15);
const paths = (options.paths || "/api/admin/dashboard").split(",").map(toPath).filter(Boolean);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    // pnpm forwards its own "--" separator into argv.
    if (!argv[index].startsWith("--") || argv[index] === "--") continue;
    result[argv[index].slice(2)] = argv[++index];
  }
  return result;
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Git Bash on Windows rewrites /api/x into C:/Program Files/.../api/x. */
function toPath(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  if (!/^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const apiIndex = trimmed.indexOf("/api/");
  return apiIndex >= 0 ? trimmed.slice(apiIndex) : trimmed;
}

function percentile(sorted, fraction) {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function signIn() {
  if (!options.email || !options.password) throw new Error("Pass --email and --password for the load-test session");
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: options.email, password: options.password })
  });
  if (!response.ok) throw new Error(`Login failed with ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Login returned no session cookie");
  return cookie;
}

const cookie = await signIn().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
const latencies = [];
const statuses = new Map();
const deadline = Date.now() + durationSeconds * 1000;
let cursor = 0;

async function worker() {
  while (Date.now() < deadline) {
    const path = paths[cursor++ % paths.length];
    const startedAt = performance.now();
    try {
      const response = await fetch(`${base}${path}`, { headers: { cookie } });
      await response.arrayBuffer();
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    } catch {
      statuses.set("network", (statuses.get("network") ?? 0) + 1);
    }
    latencies.push(performance.now() - startedAt);
  }
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedSeconds = (Date.now() - startedAt) / 1000;

latencies.sort((left, right) => left - right);
const total = latencies.length;
const serverErrors = [...statuses].reduce(
  (sum, [status, count]) => (status === "network" || Number(status) >= 500 ? sum + count : sum),
  0
);

console.log(`\n${base} · ${paths.length} path(s) · concurrency ${concurrency} · ${elapsedSeconds.toFixed(1)}s`);
console.log(`requests   ${total} (${(total / elapsedSeconds).toFixed(1)} rps)`);
console.log(`latency    p50 ${percentile(latencies, 0.5).toFixed(1)} ms · p95 ${percentile(latencies, 0.95).toFixed(1)} ms · p99 ${percentile(latencies, 0.99).toFixed(1)} ms`);
console.log(`statuses   ${[...statuses].map(([status, count]) => `${status}:${count}`).join(" ") || "none"}`);
console.log(`errors     ${serverErrors} (5xx or network)`);

process.exit(total === 0 || serverErrors > 0 ? 1 : 0);
