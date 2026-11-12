#!/usr/bin/env node
/**
 * Bulk student import from CSV.
 *
 *   pnpm import-students -- database/seeds/samples/students-sample.csv
 *   pnpm import-students -- ./students.csv --batch JEE-27-A
 *
 * - Deduplicates by email and enrollment number (existing accounts are skipped).
 * - Runs in a single transaction (all-or-nothing).
 * - Generated passwords are written to backups/imported-credentials-*.csv so the
 *   office can hand them out; that file is gitignored. Delete it after use.
 * - Recognised headers: full_name, email, enrollment_no, phone, guardian_name,
 *   guardian_phone, admission_date, batch_code, password
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";
import { generatePassword, hashPassword } from "@coaching/auth";
import { passwordSchema, studentImportRowSchema } from "@coaching/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const csvPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : arg("file");
const defaultBatchCode = arg("batch");

if (!csvPath) {
  console.error("Usage: pnpm import-students -- path/to/students.csv [--batch BATCH-CODE]");
  process.exit(1);
}

/** Minimal RFC-4180 CSV parser (handles quotes, commas and CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

const file = path.resolve(process.cwd(), csvPath);
if (!fs.existsSync(file)) {
  console.error(`[import] File not found: ${file}`);
  process.exit(1);
}

const table = parseCsv(fs.readFileSync(file, "utf8"));
const header = table.shift()?.map((value) => value.trim().toLowerCase().replace(/\s+/g, "_"));
if (!header || header.length === 0) {
  console.error("[import] Missing CSV header row.");
  process.exit(1);
}

const db = await createDatabase();
const created = [];
const skipped = [];

try {
  await db.transaction(async (tx) => {
    for (const [index, values] of table.entries()) {
      const raw = Object.fromEntries(header.map((key, position) => [key, (values[position] ?? "").trim()]));
      const parsed = studentImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`Row ${index + 2}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
      }
      const row = parsed.data;

      const duplicate = await tx.one(
        `SELECT u.id FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE lower(u.email) = lower($1) OR lower(sp.enrollment_no) = lower($2)
         LIMIT 1`,
        [row.email, row.enrollment_no]
      );
      if (duplicate) {
        skipped.push({ email: row.email, reason: "already exists" });
        continue;
      }

      const temporaryPassword = raw.password || generatePassword(12);
      const passwordCheck = passwordSchema.safeParse(temporaryPassword);
      if (!passwordCheck.success) {
        throw new Error(`Row ${index + 2}: ${passwordCheck.error.issues[0].message}`);
      }

      const { rows } = await tx.query(
        `INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
        [row.email, hashPassword(temporaryPassword), row.full_name, row.phone || null]
      );
      const userId = rows[0].id;
      await tx.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'student')", [userId]);
      await tx.query(
        `INSERT INTO student_profiles (user_id, enrollment_no, admission_date) VALUES ($1, $2, $3)`,
        [userId, row.enrollment_no, row.admission_date || null]
      );
      if (row.guardian_name) {
        await tx.query(
          `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary)
           VALUES ($1, $2, 'guardian', $3, true)`,
          [userId, row.guardian_name, row.guardian_phone || null]
        );
      }

      const batchCode = row.batch_code || defaultBatchCode;
      if (batchCode) {
        const batch = await tx.one("SELECT id, course_id FROM batches WHERE lower(code) = lower($1)", [batchCode]);
        if (!batch) throw new Error(`Row ${index + 2}: batch "${batchCode}" does not exist`);
        await tx.query(
          `INSERT INTO enrollments (student_id, batch_id, course_id) VALUES ($1, $2, $3)`,
          [userId, batch.id, batch.course_id]
        );
      }

      created.push({ email: row.email, enrollmentNo: row.enrollment_no, password: temporaryPassword });
    }

    await tx.query(
      `INSERT INTO audit_logs (action, entity_type, metadata)
       VALUES ('students.bulk_import', 'user', $1::jsonb)`,
      [JSON.stringify({ file: path.basename(file), created: created.length, skipped: skipped.length })]
    );
  });

  console.log(`[import] created ${created.length} student(s), skipped ${skipped.length} existing record(s).`);
  for (const entry of skipped) console.log(`  skipped ${entry.email} (${entry.reason})`);

  if (created.length > 0) {
    const outDir = path.join(repoRoot, "backups");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(outDir, `imported-credentials-${stamp}.csv`);
    fs.writeFileSync(
      outFile,
      ["email,enrollment_no,temporary_password", ...created.map((entry) => `${entry.email},${entry.enrollmentNo},${entry.password}`)].join("\n"),
      { mode: 0o600 }
    );
    console.log(`[import] Temporary passwords written to ${path.relative(repoRoot, outFile)} (gitignored). Delete after distribution.`);
  }
} catch (error) {
  console.error("[import] failed, transaction rolled back:", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
