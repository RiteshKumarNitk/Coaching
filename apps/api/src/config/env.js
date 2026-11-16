import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../../..");

// Root .env is the single source of secrets; apps/api/.env can override locally.
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.resolve(here, "../../.env"), override: true });

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

const nodeEnv = process.env.NODE_ENV || "development";

export const env = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 4000,
  appOrigin: (process.env.APP_ORIGIN || "").replace(/\/+$/, ""),
  databaseUrl: process.env.DATABASE_URL || "",
  pgliteDir: process.env.PGLITE_DIR || ".local/pglite",
  sessionTtlDays: Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS || 7), 1), 30),
  cookieSecure: toBool(process.env.COOKIE_SECURE, nodeEnv === "production"),
  trustProxy: toBool(process.env.TRUST_PROXY, false),
  webDist: process.env.WEB_DIST_DIR
    ? path.resolve(repoRoot, process.env.WEB_DIST_DIR)
    : path.join(repoRoot, "apps", "web", "dist"),
  logLevel: process.env.LOG_LEVEL || (nodeEnv === "test" ? "error" : "info"),
  // Per-IP requests per minute for /api. Raise only for load tests or a shared-proxy shape.
  apiRateLimitMax: Math.max(Number(process.env.API_RATE_LIMIT_MAX) || 600, 60)
});

export const sessionMaxAgeMs = env.sessionTtlDays * 24 * 60 * 60 * 1000;
