/**
 * SQL migration runner.
 *
 *   pnpm db:migrate
 *
 * Applies every database/migrations/*.sql file exactly once, in filename
 * order, inside a transaction. Applied versions and checksums are recorded in
 * schema_migrations. Safe to re-run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const MIGRATIONS_DIR = path.join(here, "migrations");

async function main() {
  const db = await createDatabase();
  console.log(`[migrate] driver=${db.driver}`);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map(
    (await db.many("SELECT version, checksum FROM schema_migrations")).map((row) => [row.version, row.checksum])
  );

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  let appliedCount = 0;

  for (const file of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = applied.get(file);

    if (previous) {
      if (previous !== checksum) {
        console.warn(`[migrate] ${file} changed after being applied (checksum mismatch). Not re-applying.`);
      }
      continue;
    }

    process.stdout.write(`[migrate] applying ${file} ... `);
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
    });
    console.log("ok");
    appliedCount += 1;
  }

  console.log(appliedCount === 0 ? "[migrate] database is up to date" : `[migrate] applied ${appliedCount} migration(s)`);
  await db.close();
}

main().catch((error) => {
  console.error("[migrate] failed:", error.message);
  if (error.detail) console.error("[migrate] detail:", error.detail);
  process.exit(1);
});
