/**
 * Connectivity check: prints the driver, server version, applied migrations
 * and row counts for core tables. Never prints connection strings.
 *
 *   pnpm check:db
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const db = await createDatabase();
try {
  const version = await db.one("SELECT version() AS version");
  console.log(`driver      : ${db.driver}`);
  console.log(`postgres    : ${version.version.split(",")[0]}`);

  const migrations = await db.many("SELECT version, applied_at FROM schema_migrations ORDER BY version");
  console.log(`migrations  : ${migrations.length}`);
  for (const row of migrations) {
    console.log(`  - ${row.version} (${new Date(row.applied_at).toISOString().slice(0, 10)})`);
  }

  for (const table of ["users", "students", "courses", "batches", "exams"]) {
    const query =
      table === "students"
        ? "SELECT count(*)::int AS count FROM student_profiles"
        : `SELECT count(*)::int AS count FROM ${table}`;
    const { count } = await db.one(query);
    console.log(`${table.padEnd(12)}: ${count}`);
  }
} finally {
  await db.close();
}
