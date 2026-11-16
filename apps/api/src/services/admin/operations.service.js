import { generatePassword, hashPassword } from "@coaching/auth";
import { badRequest, conflict, notFound } from "../../utils/AppError.js";

const num = (value) => Number(value ?? 0);
const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);

const SETTINGS_DEFAULTS = {
  instituteName: "Coaching Institute",
  instituteAddress: "",
  institutePhone: "",
  instituteEmail: "",
  receiptFooter: "Computer-generated receipt. Keep it for your records."
};

/**
 * Staff accounts, institute settings and the read-only audit trail. Only
 * super_admin holds `admins:manage`, `settings:manage` and `audit:read`.
 */
export function createAdminOperationsService(db, audit) {
  /* ------------------------------------------------------------- staff accounts */
  async function listAdmins({ page = 1, pageSize = 20, search, status } = {}) {
    const params = [];
    const where = ["EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_code IN ('admin', 'super_admin'))"];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM users u ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at, u.last_login_at,
              (SELECT array_agg(ur.role_code ORDER BY ur.role_code) FROM user_roles ur WHERE ur.user_id = u.id) AS roles
       FROM users u ${whereSql}
       ORDER BY u.full_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        roles: row.roles ?? [],
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function createAdmin(payload, actor, ip) {
    const password = payload.password || generatePassword(12);
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, password_hash, full_name, phone, created_by, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [payload.email, hashPassword(password), payload.fullName, nullIfEmpty(payload.phone), actor.id, !payload.password]
      );
      const id = rows[0].id;
      await db.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, $2, $3)", [
        id,
        payload.roleCode ?? "admin",
        actor.id
      ]);
      await audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "admin_user.created",
        entityType: "user",
        entityId: id,
        metadata: { email: payload.email, roleCode: payload.roleCode ?? "admin" },
        ip
      });
      return {
        id,
        email: payload.email,
        roleCode: payload.roleCode ?? "admin",
        temporaryPassword: payload.password ? undefined : password
      };
    } catch (error) {
      if (error.code === "23505") throw conflict("An account with that email already exists");
      throw error;
    }
  }

  async function updateAdmin(id, payload, actor, ip) {
    const target = await db.one(
      `SELECT u.id, u.status,
              (SELECT array_agg(ur.role_code) FROM user_roles ur WHERE ur.user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
      [id]
    );
    if (!target) throw notFound("Admin not found");
    const isAdmin = (target.roles ?? []).some((role) => role === "admin" || role === "super_admin");
    if (!isAdmin) throw badRequest("That account is not an admin");

    const nextStatus = payload.status ?? target.status;
    const nextRole = payload.roleCode ?? (target.roles.includes("super_admin") ? "super_admin" : "admin");

    if (id === actor.id && payload.roleCode && !target.roles.includes(payload.roleCode)) {
      throw badRequest("You cannot change your own role");
    }
    if (id === actor.id && nextStatus !== "active") throw badRequest("You cannot deactivate your own account");

    const losesSuper =
      target.roles.includes("super_admin") && (nextRole !== "super_admin" || nextStatus !== "active");
    if (losesSuper) {
      const remaining = await db.one(
        `SELECT count(*)::int AS count FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code = 'super_admin'
         WHERE u.status = 'active' AND u.id <> $1`,
        [id]
      );
      if (num(remaining.count) === 0) throw badRequest("At least one active super admin must remain");
    }

    await db.transaction(async (tx) => {
      if (payload.fullName !== undefined || payload.phone !== undefined || payload.status !== undefined) {
        const sets = [];
        const values = [];
        if (payload.fullName !== undefined) {
          sets.push(`full_name = $${sets.length + 1}`);
          values.push(payload.fullName);
        }
        if (payload.phone !== undefined) {
          sets.push(`phone = $${sets.length + 1}`);
          values.push(nullIfEmpty(payload.phone));
        }
        if (payload.status !== undefined) {
          sets.push(`status = $${sets.length + 1}`);
          values.push(payload.status);
        }
        values.push(id);
        await tx.query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
      }

      if (payload.roleCode !== undefined) {
        await tx.query("DELETE FROM user_roles WHERE user_id = $1 AND role_code IN ('admin', 'super_admin')", [id]);
        await tx.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, $2, $3)", [
          id,
          payload.roleCode,
          actor.id
        ]);
      }

      if (payload.status && payload.status !== "active") {
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "admin_user.updated",
      entityType: "user",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });

    const refreshed = await db.one(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status,
              (SELECT array_agg(ur.role_code ORDER BY ur.role_code) FROM user_roles ur WHERE ur.user_id = u.id) AS roles
       FROM users u WHERE u.id = $1`,
      [id]
    );
    return {
      id: refreshed.id,
      fullName: refreshed.full_name,
      email: refreshed.email,
      phone: refreshed.phone,
      status: refreshed.status,
      roles: refreshed.roles ?? []
    };
  }

  async function resetAdminPassword(id, password, actor, ip) {
    const target = await db.one(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code IN ('admin', 'super_admin')
       WHERE u.id = $1`,
      [id]
    );
    if (!target) throw notFound("Admin not found");
    const next = password || generatePassword(12);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE users SET password_hash = $2, must_change_password = true, updated_at = now() WHERE id = $1",
        [id, hashPassword(next)]
      );
      await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    });
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "admin_user.password_reset",
      entityType: "user",
      entityId: id,
      ip
    });
    return { id, temporaryPassword: password ? undefined : next };
  }

  /* ------------------------------------------------------------------ settings */
  async function getSettings() {
    const rows = await db.many("SELECT key, value FROM app_settings");
    const values = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      if (row.key in values) values[row.key] = row.value;
    }
    return values;
  }

  async function updateSettings(payload, actor, ip) {
    const keys = Object.keys(SETTINGS_DEFAULTS).filter((key) => payload[key] !== undefined);
    if (keys.length === 0) throw badRequest("Nothing to update");
    for (const key of keys) {
      await db.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, String(payload[key] ?? ""), actor.id]
      );
    }
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "settings.updated",
      entityType: "settings",
      entityId: null,
      metadata: { keys },
      ip
    });
    return getSettings();
  }

  /* --------------------------------------------------------------- audit trail */
  async function listAudit({ page = 1, pageSize = 20, search, action, entityType } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(actor_email ILIKE $${params.length} OR action ILIKE $${params.length} OR entity_id ILIKE $${params.length})`);
    }
    if (action) {
      params.push(action);
      where.push(`action = $${params.length}`);
    }
    if (entityType) {
      params.push(entityType);
      where.push(`entity_type = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (await db.one(`SELECT count(*)::int AS count FROM audit_logs ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT id, actor_id, actor_email, action, entity_type, entity_id, metadata, ip, created_at
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        metadata: row.metadata,
        ip: row.ip,
        createdAt: row.created_at
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  return { listAdmins, createAdmin, updateAdmin, resetAdminPassword, getSettings, updateSettings, listAudit };
}
