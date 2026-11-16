#!/usr/bin/env node
/**
 * Pre-launch wipe: delete every demo row while keeping the schema and the
 * migration history, so a real institute can start from an empty database.
 *
 *   pnpm db:clean -- --dry-run      # show what would be removed
 *   pnpm db:clean -- --yes          # truncate it
 *
 * Refuses to run without DATABASE_URL (the demo seed also targets that URL) and
 * without an explicit --yes, because this cannot be undone.
 * Take a Neon snapshot first: docs/DEPLOYMENT.md §2.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const dryRun = process.argv.includes("--dry-run");
const confirmed = process.argv.includes("--yes");
const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Refusing to guess which database to wipe.");
  process.exit(1);
}
if (dryRun && confirmed) {
  console.error("Pass either --dry-run or --yes, not both.");
  process.exit(1);
}
if (!dryRun && !confirmed) {
  console.error(
    "This deletes every user, course, fee, exam and audit row.\n" +
      "Re-run with --dry-run to preview, or --yes to confirm. Take a Neon snapshot first."
  );
  process.exit(1);
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
// Created by migrations, not demo content: roles drive RBAC (0001 seeds the four
// codes) and schema_migrations records applied files. Wiping either breaks the app.
const PRESERVED_TABLES = ["roles", "schema_migrations"];
const db = await createDatabase();

/** Row counts for every table, read in one round trip. */
async function countRows(names) {
  const sql = names
    .map((name, index) => `SELECT ${index} AS position, count(*)::int AS rows FROM ${quote(name)}`)
    .join(" UNION ALL ");
  const rows = await db.many(`${sql} ORDER BY position`);
  return Object.fromEntries(names.map((name, index) => [name, rows[index].rows]));
}

const report = (counts) => {
  const populated = Object.entries(counts).filter(([, rows]) => rows > 0);
  const total = populated.reduce((sum, [, rows]) => sum + rows, 0);
  for (const [table, rows] of populated) console.log(`  ${rows.toString().padStart(6)}  ${table}`);
  console.log(`  ${total.toString().padStart(6)}  rows in ${populated.length} populated table(s)`);
};

try {
  const names = (
    await db.many(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         AND table_name <> ALL ($1)
       ORDER BY table_name`,
      [PRESERVED_TABLES]
    )
  ).map((row) => row.table_name);

  console.log(`Database: ${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);

  if (names.length === 0) {
    console.log("No application tables found — has `pnpm db:migrate` been run?");
    process.exitCode = 1;
  } else {
    console.log(`Before: ${names.length} tables (${names.join(", ")})`);
    console.log(`Preserved: ${PRESERVED_TABLES.join(", ")}`);
    report(await countRows(names));

    if (dryRun) {
      console.log("\nDry run — nothing deleted. Re-run with --yes to wipe these rows.");
    } else {
      await db.query(`TRUNCATE TABLE ${names.map(quote).join(", ")} RESTART IDENTITY CASCADE`);
      console.log("\nAfter:");
      report(await countRows(names));
      console.log(
        "\nDemo data removed. Next: `pnpm create-admin -- --email owner@… --name \"…\"`," +
          " then set the institute details under Settings after first sign-in."
      );
    }
  }
} finally {
  await db.close();
}
