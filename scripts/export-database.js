#!/usr/bin/env node
/**
 * Logical backup: exports every business table to NDJSON under
 * backups/export-<timestamp>/, plus a manifest with row counts.
 *
 *   pnpm export-database
 *
 * Credentials are never exported: password hashes, session token hashes and
 * password reset material are stripped or the table is skipped entirely.
 * For a full physical backup use `pg_dump "$DATABASE_URL" --no-owner` (Neon
 * also provides instant restore and manual snapshots).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const TABLES = [
  "roles",
  "users",
  "user_roles",
  "student_profiles",
  "guardian_profiles",
  "teacher_profiles",
  "courses",
  "subjects",
  "course_subjects",
  "batches",
  "batch_subjects",
  "batch_teachers",
  "batch_schedules",
  "enrollments",
  "lessons",
  "lesson_progress",
  "study_materials",
  "assignments",
  "assignment_submissions",
  "attendance",
  "exams",
  "exam_questions",
  "exam_options",
  "exam_answer_keys",
  "exam_attempts",
  "exam_responses",
  "exam_results",
  "fee_structures",
  "student_fees",
  "payments",
  "announcements",
  "notifications",
  "audit_logs"
];

const STRIPPED_COLUMNS = {
  users: ["password_hash"],
  sessions: ["token_hash"]
};

const PAGE_SIZE = 1000;

const db = await createDatabase();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(repoRoot, "backups", `export-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const manifest = { createdAt: new Date().toISOString(), driver: db.driver, tables: {} };

try {
  for (const table of TABLES) {
    const strip = STRIPPED_COLUMNS[table] ?? [];
    let offset = 0;
    let total = 0;
    const file = path.join(outDir, `${table}.ndjson`);
    fs.writeFileSync(file, "");

    for (;;) {
      const columns = (await db.many(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
        [table]
      ))
        .map((row) => row.column_name)
        .filter((column) => !strip.includes(column));

      if (columns.length === 0) break;
      const quoted = columns.map((column) => `"${column}"`).join(", ");
      const rows = await db.many(`SELECT ${quoted} FROM "${table}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
      if (rows.length === 0) break;
      fs.appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
      total += rows.length;
      offset += PAGE_SIZE;
      if (rows.length < PAGE_SIZE) break;
    }

    manifest.tables[table] = total;
    console.log(`[export] ${table.padEnd(24)} ${total}`);
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[export] Done: ${path.relative(repoRoot, outDir)}`);
  console.log("[export] Store this outside the repository; it contains student data.");
} catch (error) {
  console.error("[export] failed:", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
