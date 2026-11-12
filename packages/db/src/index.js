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

async function createPostgresDatabase(connectionString) {
  const { default: pg } = await import("pg");
  const needsSsl = !isLocalHost(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon requires TLS. When the URL already carries sslmode we let pg handle it.
    ...(needsSsl && !/sslmode=/i.test(connectionString)
      ? { ssl: { rejectUnauthorized: false } }
      : {})
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
