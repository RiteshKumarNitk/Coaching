#!/usr/bin/env node
/**
 * Create (or promote) a super admin.
 *
 *   pnpm create-admin -- --email owner@example.com --name "Institute Owner"
 *   pnpm create-admin -- --email owner@example.com --name "Owner" --password "StrongPass123"
 *
 * With no --password a cryptographically strong password is generated and
 * printed once. Existing accounts are never silently overwritten: only the
 * super_admin role is granted unless --reset-password is passed.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import dotenv from "dotenv";
import { createDatabase } from "@coaching/db";
import { generatePassword, hashPassword } from "@coaching/auth";
import { emailSchema, passwordSchema, personNameSchema } from "@coaching/shared";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const email = (arg("email") || process.env.ADMIN_EMAIL || "").trim();
const name = (arg("name") || process.env.ADMIN_NAME || "").trim();
const providedPassword = arg("password") || process.env.ADMIN_PASSWORD || "";
const resetPassword = process.argv.includes("--reset-password");

if (!email || !name) {
  console.error("Usage: pnpm create-admin -- --email <email> --name \"<full name>\" [--password <password>] [--reset-password]");
  process.exit(1);
}

const emailResult = emailSchema.safeParse(email);
const nameResult = personNameSchema.safeParse(name);
if (!emailResult.success || !nameResult.success) {
  console.error("[create-admin] Invalid email or name.");
  process.exit(1);
}

const password = providedPassword || generatePassword(16);
const passwordResult = passwordSchema.safeParse(password);
if (!passwordResult.success) {
  console.error(`[create-admin] ${passwordResult.error.issues[0].message}`);
  process.exit(1);
}

const db = await createDatabase();
try {
  const result = await db.transaction(async (tx) => {
    const existing = await tx.one("SELECT id, email FROM users WHERE lower(email) = lower($1)", [email]);
    if (existing) {
      await tx.query(
        `INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'super_admin') ON CONFLICT DO NOTHING`,
        [existing.id]
      );
      if (resetPassword) {
        await tx.query(
          "UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, status = 'active' WHERE id = $1",
          [existing.id, hashPassword(password)]
        );
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [existing.id]);
      }
      await tx.query(
        `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'admin.super_admin_granted', 'user', $1, $3::jsonb)`,
        [existing.id, email, JSON.stringify({ resetPassword })]
      );
      return { created: false, id: existing.id };
    }

    const { rows } = await tx.query(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [email, hashPassword(password), name]
    );
    const id = rows[0].id;
    await tx.query("INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'super_admin')", [id]);
    await tx.query(
      `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'admin.super_admin_created', 'user', $1, '{}'::jsonb)`,
      [id, email]
    );
    return { created: true, id };
  });

  if (result.created) {
    console.log(`[create-admin] Super admin created: ${email}`);
    if (!providedPassword) console.log(`[create-admin] Temporary password: ${password}`);
    console.log("[create-admin] Sign in and change the password immediately.");
  } else {
    console.log(`[create-admin] Existing account ${email} now has the super_admin role.`);
    if (resetPassword) console.log("[create-admin] Password reset and all sessions revoked.");
    if (!providedPassword && resetPassword) console.log(`[create-admin] New temporary password: ${password}`);
  }
} catch (error) {
  console.error("[create-admin] failed:", error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
