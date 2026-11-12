import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "@coaching/auth";
import { ROLE_PERMISSIONS, SESSION_COOKIE_NAME } from "@coaching/shared";
import { env, sessionMaxAgeMs } from "../config/env.js";
import { AppError, unauthorized } from "../utils/AppError.js";

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

// Hash used to burn comparable CPU time when the account does not exist.
const DUMMY_HASH = hashPassword("not-a-real-password-000");

const USER_WITH_ROLES = `
  SELECT u.id, u.email, u.full_name, u.phone, u.status, u.last_login_at, u.password_hash,
         u.failed_login_attempts, u.locked_until,
         COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  WHERE %CONDITION%
  GROUP BY u.id
`;

function permissionsFor(roles) {
  const set = new Set();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set];
}

export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    roles: row.roles,
    permissions: permissionsFor(row.roles),
    lastLoginAt: row.last_login_at
  };
}

export function createAuthService(db, audit) {
  async function findUserByEmail(email) {
    return db.one(USER_WITH_ROLES.replace("%CONDITION%", "lower(u.email) = lower($1)"), [email]);
  }

  async function findUserById(id) {
    return db.one(USER_WITH_ROLES.replace("%CONDITION%", "u.id = $1"), [id]);
  }

  return {
    async login({ email, password, ip, userAgent }) {
      const user = await findUserByEmail(email);
      const genericFailure = unauthorized("Invalid email or password");

      if (!user) {
        // Constant-ish work to avoid trivial user enumeration through timing.
        verifyPassword(password, DUMMY_HASH);
        await audit.record({
          action: "auth.login_failed",
          entityType: "user",
          metadata: { email, reason: "unknown_account" },
          ip
        });
        throw genericFailure;
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        await audit.record({
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.login_blocked",
          entityType: "user",
          entityId: user.id,
          metadata: { reason: "locked" },
          ip
        });
        throw new AppError(423, "Account temporarily locked after repeated failed sign-ins. Try again later.", {
          code: "account_locked"
        });
      }

      if (user.status !== "active") {
        await audit.record({
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.login_failed",
          entityType: "user",
          entityId: user.id,
          metadata: { reason: `status_${user.status}` },
          ip
        });
        throw new AppError(403, "This account is not active. Contact the institute office.", {
          code: "account_inactive"
        });
      }

      if (!verifyPassword(password, user.password_hash)) {
        const attempts = Number(user.failed_login_attempts) + 1;
        const lockUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
        await db.query(
          `UPDATE users
           SET failed_login_attempts = $2,
               locked_until = $3,
               updated_at = now()
           WHERE id = $1`,
          [user.id, attempts, lockUntil]
        );
        await audit.record({
          actorId: user.id,
          actorEmail: user.email,
          action: "auth.login_failed",
          entityType: "user",
          entityId: user.id,
          metadata: { reason: "bad_password", attempts },
          ip
        });
        throw genericFailure;
      }

      if (user.roles.length === 0) {
        throw new AppError(403, "This account has no assigned role. Contact the administrator.", {
          code: "no_role"
        });
      }

      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      const expiresAt = new Date(Date.now() + sessionMaxAgeMs);

      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, tokenHash, ip ?? null, (userAgent ?? "").slice(0, 400), expiresAt]
        );
        await tx.query(
          `UPDATE users SET last_login_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
          [user.id]
        );
      });

      await audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.login",
        entityType: "user",
        entityId: user.id,
        ip
      });

      const fresh = await findUserById(user.id);
      return { token, user: publicUser(fresh) };
    },

    async resolveSession(token) {
      if (!token) return null;
      const tokenHash = hashSessionToken(token);
      const row = await db.one(
        `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
                u.id, u.email, u.full_name, u.phone, u.status, u.last_login_at,
                COALESCE(array_agg(ur.role_code) FILTER (WHERE ur.role_code IS NOT NULL), '{}') AS roles
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         GROUP BY s.id, u.id`,
        [tokenHash]
      );
      if (!row || row.status !== "active") return null;

      // Touch last_seen_at at most every five minutes to avoid a write per request.
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
        db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(() => {});
      }

      const user = publicUser(row);
      return { user, sessionId: row.session_id, tokenHash };
    },

    async logout(token, actor, ip) {
      if (!token) return;
      await db.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [
        hashSessionToken(token)
      ]);
      if (actor) {
        await audit.record({
          actorId: actor.id,
          actorEmail: actor.email,
          action: "auth.logout",
          entityType: "session",
          entityId: actor.id,
          ip
        });
      }
    },

    async changePassword({ userId, currentPassword, newPassword, ip, keepTokenHash }) {
      const row = await db.one("SELECT id, email, password_hash FROM users WHERE id = $1", [userId]);
      if (!row) throw unauthorized();
      if (!verifyPassword(currentPassword, row.password_hash)) {
        throw new AppError(400, "Current password is incorrect", { code: "invalid_password" });
      }
      const newHash = hashPassword(newPassword);
      await db.transaction(async (tx) => {
        await tx.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [
          userId,
          newHash
        ]);
        // Revoke every other session for this account.
        await tx.query(
          `UPDATE sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash <> $2)`,
          [userId, keepTokenHash ?? null]
        );
      });
      await audit.record({
        actorId: userId,
        actorEmail: row.email,
        action: "auth.password_changed",
        entityType: "user",
        entityId: userId,
        ip
      });
    },

    async getProfile(userId) {
      const user = await findUserById(userId);
      if (!user) throw unauthorized();
      const profile = publicUser(user);

      if (user.roles.includes("student")) {
        const student = await db.one(
          `SELECT sp.enrollment_no, sp.admission_date, sp.date_of_birth, sp.gender, sp.address, sp.city, sp.state, sp.pincode,
                  (SELECT json_build_object('name', c.name, 'code', c.code, 'batch', b.name, 'batchCode', b.code)
                   FROM enrollments e
                   JOIN courses c ON c.id = e.course_id
                   JOIN batches b ON b.id = e.batch_id
                   WHERE e.student_id = sp.user_id AND e.status = 'active'
                   ORDER BY e.enrolled_at DESC LIMIT 1) AS enrollment,
                  (SELECT json_agg(json_build_object('name', g.name, 'relation', g.relation, 'phone', g.phone) ORDER BY g.is_primary DESC)
                   FROM guardian_profiles g WHERE g.student_id = sp.user_id) AS guardians
           FROM student_profiles sp WHERE sp.user_id = $1`,
          [userId]
        );
        return { ...profile, studentProfile: student };
      }

      if (user.roles.includes("teacher")) {
        const teacher = await db.one(
          `SELECT tp.employee_code, tp.qualification, tp.specialization, tp.joining_date, tp.bio,
                  (SELECT count(*)::int FROM batch_teachers bt WHERE bt.teacher_id = tp.user_id) AS batch_count
           FROM teacher_profiles tp WHERE tp.user_id = $1`,
          [userId]
        );
        return { ...profile, teacherProfile: teacher };
      }

      return profile;
    },

    permissionsFor,
    cookieName: SESSION_COOKIE_NAME,
    cookieSecure: env.cookieSecure
  };
}
