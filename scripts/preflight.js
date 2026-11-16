/**
 * Go-live readiness check: the env the API will read plus the built frontend.
 * Never touches the database and never prints a secret value.
 *
 *   pnpm check:env
 *
 * Exit code 1 means at least one blocking problem; warnings are advisory.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../apps/api/src/config/env.js";

const failures = [];
const warnings = [];

if (!env.databaseUrl) failures.push("DATABASE_URL is not set");
if (!env.appOrigin) {
  failures.push("APP_ORIGIN is not set (CSRF checks and CSP need the public origin)");
} else if (!env.appOrigin.startsWith("https://")) {
  failures.push(`APP_ORIGIN must be an https:// origin, got ${env.appOrigin}`);
}
if (!env.cookieSecure) failures.push("COOKIE_SECURE is off — session cookies would travel over plain HTTP");

if (env.nodeEnv !== "production") warnings.push(`NODE_ENV is "${env.nodeEnv}" — set NODE_ENV=production on the host`);
if (!env.trustProxy) warnings.push("TRUST_PROXY is off — req.ip is the proxy address when the host terminates TLS");

for (const file of ["index.html", "manifest.webmanifest", "sw.js", "offline.html"]) {
  if (!fs.existsSync(path.join(env.webDist, file))) failures.push(`Missing ${file} in the web build — run pnpm build`);
}

for (const message of failures) console.log(`FAIL  ${message}`);
for (const message of warnings) console.log(`WARN  ${message}`);
console.log(
  failures.length
    ? `\n${failures.length} blocking problem(s) before go-live. See docs/DEPLOYMENT.md §3 (seed accounts, snapshot, super admin).`
    : "OK    environment and build are ready for go-live"
);

process.exit(failures.length > 0 ? 1 : 0);
