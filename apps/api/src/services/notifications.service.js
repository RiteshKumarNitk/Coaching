import { notFound } from "../utils/AppError.js";

const num = (value) => Number(value ?? 0);

/**
 * In-app notifications. Rows are written by the service that causes the event
 * (announcement published, fee assigned, results published) and read through
 * /api/me/notifications, so every role uses the same bell.
 */
export function createNotificationsService(db) {
  async function notify(userIds, { type = "system", title, body = null, link = null }) {
    const recipients = [...new Set((userIds ?? []).filter(Boolean))];
    if (recipients.length === 0) return 0;
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT unnest($1::uuid[]), $2, $3, $4, $5`,
      [recipients, type, title, body, link]
    );
    return recipients.length;
  }

  async function list(userId, { page = 1, pageSize = 20 } = {}) {
    const total = (
      await db.one("SELECT count(*)::int AS count FROM notifications WHERE user_id = $1", [userId])
    ).count;
    const rows = await db.many(
      `SELECT id, type, title, body, link, read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.read_at,
        createdAt: row.created_at
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function unreadCount(userId) {
    const row = await db.one(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [userId]
    );
    return { count: num(row.count) };
  }

  async function markRead(userId, id) {
    const row = await db.one(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2 RETURNING id, read_at`,
      [id, userId]
    );
    if (!row) throw notFound("Notification not found");
    return { id: row.id, readAt: row.read_at };
  }

  async function markAllRead(userId) {
    const result = await db.query(
      "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
      [userId]
    );
    return { updated: result.rowCount };
  }

  return { notify, list, unreadCount, markRead, markAllRead };
}
