/**
 * Database access layer.
 *
 * - Production / staging: Neon PostgreSQL through `pg` + a pooled connection.
 * - Local development: an embedded PGlite (WASM PostgreSQL) instance so the
 *   app runs with zero external services and no installation.
 *
 * Both drivers expose the same tiny interface: query(), one(), many(), exec(),
 * transaction(). Nothing outside this package should import `pg` or PGlite.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Normalise a driver result into { rows, rowCount }.
 */
function normaliseResult(result) {
  const rows = result?.rows ?? [];
  const rowCount = typeof result?.rowCount === "number" ? result.rowCount : result?.affectedRows ?? rows.length;
  return { rows, rowCount };
}

function isLocalHost(connectionString) {
  try {
    const url = new URL(connectionString);
    return ["localhost", "127.0.0.1", "::1", ""].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * TLS modes accepted by DATABASE_SSL (and by sslmode= in DATABASE_URL).
 *
 * verify-full checks the certificate chain and the hostname and is the default
 * for anything that is not a local database. require, prefer, allow and
 * verify-ca are aliases for it, which is exactly what pg-connection-string v2
 * does with them today (the library is changing those names to weaker libpq
 * semantics in v3, so the resolution lives here and stays strict).
 * no-verify encrypts without checking the certificate; disable sends plaintext
 * and is for a loopback or self-hosted server without TLS.
 */
const SSL_MODES = Object.freeze({
  disable: false,
  allow: { rejectUnauthorized: true },
  prefer: { rejectUnauthorized: true },
  require: { rejectUnauthorized: true },
  "verify-ca": { rejectUnauthorized: true },
  "verify-full": { rejectUnauthorized: true },
  "no-verify": { rejectUnauthorized: false }
});

function normaliseSslMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!mode) return "";
  if (!Object.hasOwn(SSL_MODES, mode)) {
    throw new Error(
      `Unsupported database SSL mode "${value}". Use one of: ${Object.keys(SSL_MODES).join(", ")} ` +
        "(set it in DATABASE_SSL or as sslmode= in DATABASE_URL)."
    );
  }
  return mode;
}

/**
 * Decide how to reach Postgres: connection string plus an explicit `ssl` option.
 *
 * sslmode is removed from the URL before `pg` sees it. pg-connection-string v2
 * emits a "SECURITY WARNING: The SSL modes 'prefer', 'require', and
 * 'verify-ca' are treated as aliases for 'verify-full'" warning the first time
 * it parses such a URL; resolving TLS here keeps the log clean and freezes the
 * current strict behaviour instead of inheriting v3's weaker semantics.
 * DATABASE_SSL wins over the URL so one deployment can override a shared URL.
 */
export function resolveConnection(connectionString, overrideMode = process.env.DATABASE_SSL) {
  let clean = connectionString;
  let urlMode = "";
  try {
    const url = new URL(connectionString);
    urlMode = url.searchParams.get("sslmode") ?? "";
    url.searchParams.delete("sslmode");
    url.searchParams.delete("ssl");
    clean = url.toString();
  } catch {
    // key=value DSNs are passed through untouched; SSL still comes from DATABASE_SSL.
  }
  const sslMode =
    normaliseSslMode(overrideMode) || normaliseSslMode(urlMode) || (isLocalHost(connectionString) ? "disable" : "verify-full");
  return { connectionString: clean, ssl: SSL_MODES[sslMode], sslMode };
}

async function createPostgresDatabase(connectionString) {
  const { default: pg } = await import("pg");
  const { connectionString: url, ssl } = resolveConnection(connectionString);
  const pool = new pg.Pool({
    connectionString: url,
    ssl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

  // Fail fast instead of leaving a dangling promise rejection.
  pool.on("error", (error) => {
    console.error(JSON.stringify({ level: "error", message: "postgres pool error", error: error.message }));
  });

  const api = {
    driver: "postgres",
    async query(text, params = []) {
      return normaliseResult(await pool.query(text, params));
    },
    async exec(text) {
      return normaliseResult(await pool.query(text));
    },
    async transaction(fn) {
      const client = await pool.connect();
      const tx = {
        query: async (text, params = []) => normaliseResult(await client.query(text, params)),
        exec: async (text) => normaliseResult(await client.query(text))
      };
      tx.one = async (text, params = []) => (await tx.query(text, params)).rows[0] ?? null;
      tx.many = async (text, params = []) => (await tx.query(text, params)).rows;
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already broken */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };

  api.one = async (text, params) => (await api.query(text, params)).rows[0] ?? null;
  api.many = async (text, params) => (await api.query(text, params)).rows;
  return api;
}

async function createPgliteDatabase(directory) {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    throw new Error(
      "Local development database driver PGlite is not installed. Run `pnpm install`, " +
        "or set DATABASE_URL to a Neon PostgreSQL connection string."
    );
  }

  const dataDir = path.isAbsolute(directory) ? directory : path.join(repoRoot, directory);
  fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);

  const api = {
    driver: "pglite",
    async query(text, params = []) {
      return normaliseResult(await pglite.query(text, params));
    },
    async exec(text) {
      const result = await pglite.exec(text);
      // exec() returns an array of results for multi-statement scripts.
      const last = Array.isArray(result) ? result[result.length - 1] : result;
      return normaliseResult(last ?? { rows: [] });
    },
    async transaction(fn) {
      const tx = {
        query: async (text, params = []) => normaliseResult(await pglite.query(text, params)),
        exec: async (text) => normaliseResult(await pglite.exec(text))
      };
      tx.one = async (text, params = []) => (await tx.query(text, params)).rows[0] ?? null;
      tx.many = async (text, params = []) => (await tx.query(text, params)).rows;
      await pglite.exec("BEGIN");
      try {
        const result = await fn(tx);
        await pglite.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          await pglite.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw error;
      }
    },
    async close() {
      await pglite.close();
    }
  };

  api.one = async (text, params) => (await api.query(text, params)).rows[0] ?? null;
  api.many = async (text, params) => (await api.query(text, params)).rows;
  return api;
}

/**
 * Create a database handle.
 * @param {{ connectionString?: string, pgliteDir?: string }} [options]
 */
export async function createDatabase(options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL ?? "";
  if (connectionString.trim()) {
    return createPostgresDatabase(connectionString.trim());
  }
  if (process.env.NODE_ENV === "production" && !options.allowLocal) {
    throw new Error("DATABASE_URL is required when NODE_ENV=production.");
  }
  return createPgliteDatabase(options.pgliteDir ?? process.env.PGLITE_DIR ?? ".local/pglite");
}

export { repoRoot };
