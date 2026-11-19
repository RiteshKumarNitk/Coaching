#!/usr/bin/env node
/**
 * Disposable PGlite restore drill — NOT a PostgreSQL/Neon backup verification.
 *
 * Creates a temporary PGlite database, applies every migration, writes a small
 * fixture (including a payment with a request_id), closes it, copies the PGlite
 * data directory as a backup, restores that copy into a second empty directory, and
 * verifies schema, migration bookkeeping and business rows in the restored DB.
 * It does not exercise pg_dump/pg_restore, WAL, roles, extensions or a Neon branch.
 *
 * The restored copy is then used to rehearse the rollback order for payment
 * idempotency: remove the index/column and its migration row, confirm receipts
 * survive, then re-apply the additive migration.
 *
 * This never opens .env, DATABASE_URL, the development database or production.
 */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(repoRoot, "database", "migrations");

const { createDatabase } = await import("@coaching/db");
const { hashPassword } = await import("@coaching/auth");

console.log("PGlite restore drill (not PostgreSQL/Neon)");

const root = await fs.mkdtemp(path.join(os.tmpdir(), "coaching-restore-drill-"));
const sourceDir = path.join(root, "source");
const backupDir = path.join(root, "backup");
const restoredDir = path.join(root, "restored");

const ok = (message) => console.log(`PASS  ${message}`);
const fail = (message) => {
  throw new Error(message);
};

async function applyMigrations(db) {
  for (const file of (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
    });
  }
}

async function main() {
  // 1. Source fixture.
  const source = await createDatabase({ connectionString: "", pgliteDir: sourceDir, allowLocal: true });
  await source.exec(
    `CREATE TABLE schema_migrations (
       version text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  await applyMigrations(source);

  const user = await source.one(
    "INSERT INTO users (email, password_hash, full_name) VALUES ('drill@test.local', $1, 'Drill Student') RETURNING id",
    [hashPassword("DrillPass123")]
  );
  await source.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'student')", [user.id]);
  await source.query("INSERT INTO student_profiles (user_id, enrollment_no) VALUES ($1, 'DRILL-1')", [user.id]);
  const course = await source.one(
    "INSERT INTO courses (code, name, duration_months) VALUES ('DRILL', 'Drill Course', 12) RETURNING id"
  );
  const batch = await source.one(
    `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity)
     VALUES ($1, 'DRILL-B', 'Drill Batch', '2026-01-01', '2027-12-31', 10) RETURNING id`,
    [course.id]
  );
  await source.query(
    `INSERT INTO enrollments (student_id, batch_id, course_id, status, valid_from, valid_until)
     VALUES ($1, $2, $3, 'active', institute_today() - 10, institute_today() + 10)`,
    [user.id, batch.id, course.id]
  );
  const structure = await source.one(
    `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments)
     VALUES ($1, 'Drill Fee', '2026-27', 5000, 1) RETURNING id`,
    [course.id]
  );
  const fee = await source.one(
    `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount, status)
     VALUES ($1, $2, 5000, 0, 5000, 'partial') RETURNING id`,
    [user.id, structure.id]
  );
  const payment = await source.one(
    `INSERT INTO payments (receipt_no, student_fee_id, student_id, amount, method, request_id)
     VALUES ('RCPT-DRILL-1', $1, $2, 500, 'cash', 'drill-request-1') RETURNING id`,
    [fee.id, user.id]
  );
  const sourceCounts = await source.one(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM enrollments) AS enrollments,
       (SELECT count(*)::int FROM payments) AS payments,
       (SELECT count(*)::int FROM schema_migrations) AS migrations`
  );
  await source.close();
  ok(`source fixture written (${sourceCounts.migrations} migrations)`);

  // 2. Physical backup of the closed data directory, and a restore copy.
  await fs.cp(sourceDir, backupDir, { recursive: true });
  await fs.cp(backupDir, restoredDir, { recursive: true });
  ok("PGlite data directory copied and restored into a separate disposable directory");

  // 3. Verify the restored database.
  let restored = await createDatabase({ connectionString: "", pgliteDir: restoredDir, allowLocal: true });
  const restoredCounts = await restored.one(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM enrollments) AS enrollments,
       (SELECT count(*)::int FROM payments) AS payments,
       (SELECT count(*)::int FROM schema_migrations) AS migrations`
  );
  for (const key of ["users", "enrollments", "payments", "migrations"]) {
    if (restoredCounts[key] !== sourceCounts[key]) fail(`restored ${key} mismatch`);
  }
  const restoredPayment = await restored.one("SELECT receipt_no, request_id, amount FROM payments WHERE id = $1", [
    payment.id
  ]);
  if (restoredPayment.receipt_no !== "RCPT-DRILL-1" || restoredPayment.request_id !== "drill-request-1") {
    fail("restored payment does not match the source");
  }
  const index = await restored.one(
    "SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'payments_request_id_key'"
  );
  if (!index) fail("request_id unique index missing after restore");
  const today = await restored.one("SELECT institute_today() AS today");
  if (!today?.today) fail("institute_today() missing after restore");
  ok("restored schema, migration rows, payment idempotency key and institute timezone function match");

  // 4. Rehearse schema rollback after application rollback. Application code
  // must be rolled back first so no request writes request_id while it is dropped.
  await restored.exec("DROP INDEX IF EXISTS payments_request_id_key");
  await restored.exec("ALTER TABLE payments DROP COLUMN IF EXISTS request_id");
  await restored.query("DELETE FROM schema_migrations WHERE version = '0011_payment_idempotency.sql'");
  const afterRollback = await restored.one(
    `SELECT
       (SELECT count(*)::int FROM payments) AS payments,
       (SELECT count(*)::int FROM schema_migrations) AS migrations`
  );
  if (afterRollback.payments !== 1) fail("receipts were lost during schema rollback");
  if (afterRollback.migrations !== sourceCounts.migrations - 1) fail("schema_migrations was not reconciled");
  const oldSchemaPayment = await restored.one("SELECT receipt_no, amount FROM payments WHERE id = $1", [payment.id]);
  if (oldSchemaPayment.receipt_no !== "RCPT-DRILL-1") fail("old application cannot read the surviving receipt");
  ok("rollback kept the receipt and reconciled schema_migrations (11 rows)");

  // 5. Re-apply the additive migration and record it again.
  const sql = await fs.readFile(path.join(migrationsDir, "0011_payment_idempotency.sql"), "utf8");
  await restored.exec(sql);
  const checksum = createHash("sha256").update(sql).digest("hex");
  await restored.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
    "0011_payment_idempotency.sql",
    checksum
  ]);
  const reapplied = await restored.one(
    `SELECT
       (SELECT count(*)::int FROM payments) AS payments,
       (SELECT count(*)::int FROM schema_migrations) AS migrations,
       (SELECT count(*)::int FROM information_schema.columns
        WHERE table_name = 'payments' AND column_name = 'request_id') AS column_present`
  );
  if (reapplied.payments !== 1 || reapplied.migrations !== sourceCounts.migrations || reapplied.column_present !== 1) {
    fail("re-applying the additive migration did not restore the expected state");
  }
  ok("additive migration re-applied; legacy payment kept with a NULL request_id");

  await restored.close();
  restored = null;
  console.log(
    "\nPGLITE DRILL OK  data-directory backup, restore, rollback and re-apply completed; PostgreSQL/Neon restore remains unverified"
  );
}

try {
  await main();
} catch (error) {
  console.error(`\nDRILL FAILED  ${error.message}`);
  process.exitCode = 1;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
