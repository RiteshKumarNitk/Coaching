import { logger } from "../utils/logger.js";

/**
 * Append-only audit trail for administrative and authentication events.
 * Audit failures must never break the business operation, so they are logged
 * and swallowed.
 */
export function createAuditService(db) {
  return {
    async record({ actorId = null, actorEmail = null, action, entityType, entityId = null, metadata = {}, ip = null }) {
      try {
        await db.query(
          `INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, metadata, ip)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
          [actorId, actorEmail, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(metadata), ip]
        );
      } catch (error) {
        logger.error("audit write failed", { action, error });
      }
    },

    async list({ limit = 50 } = {}) {
      return db.many(
        `SELECT id, actor_id, actor_email, action, entity_type, entity_id, metadata, created_at
         FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
        [Math.min(Math.max(limit, 1), 200)]
      );
    }
  };
}
