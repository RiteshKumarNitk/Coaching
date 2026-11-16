import { notFound } from "../utils/AppError.js";

const num = (value) => Number(value ?? 0);
const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);

const SELECT = `SELECT a.id, a.title, a.body, a.audience, a.role_code, a.course_id, a.batch_id,
         a.is_pinned, a.published_at, a.expires_at, a.created_at,
         c.name AS course_name, b.name AS batch_name, u.full_name AS author_name
  FROM announcements a
  LEFT JOIN courses c ON c.id = a.course_id
  LEFT JOIN batches b ON b.id = a.batch_id
  LEFT JOIN users u ON u.id = a.created_by`;

const map = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  audience: row.audience,
  roleCode: row.role_code,
  courseId: row.course_id,
  courseName: row.course_name,
  batchId: row.batch_id,
  batchName: row.batch_name,
  isPinned: row.is_pinned,
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  authorName: row.author_name
});

/**
 * Notices for the whole institute, one role, one course or one batch. Publishing
 * also writes an in-app notification for everyone in the audience.
 */
export function createAnnouncementsService(db, audit, notifications) {
  async function assertTarget({ audience, courseId, batchId }) {
    if (audience === "course") {
      const course = await db.one("SELECT id FROM courses WHERE id = $1", [courseId]);
      if (!course) throw notFound("Course not found");
    }
    if (audience === "batch") {
      const batch = await db.one("SELECT id FROM batches WHERE id = $1", [batchId]);
      if (!batch) throw notFound("Batch not found");
    }
  }

  async function audienceUserIds({ audience, roleCode, courseId, batchId }) {
    if (audience === "all") {
      return db.many("SELECT id FROM users WHERE status = 'active'");
    }
    if (audience === "role") {
      return db.many(
        `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role_code = $1 AND u.status = 'active'`,
        [roleCode]
      );
    }
    if (audience === "course") {
      return db.many(
        `SELECT DISTINCT u.id FROM users u
         JOIN enrollments e ON e.student_id = u.id AND e.status = 'active'
         WHERE e.course_id = $1 AND u.status = 'active'`,
        [courseId]
      );
    }
    return db.many(
      `SELECT DISTINCT u.id FROM users u
       JOIN enrollments e ON e.student_id = u.id AND e.status = 'active'
       WHERE e.batch_id = $1 AND u.status = 'active'`,
      [batchId]
    );
  }

  async function list({ page = 1, pageSize = 20, search, audience } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
    }
    if (audience) {
      params.push(audience);
      where.push(`a.audience = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (await db.one(`SELECT count(*)::int AS count FROM announcements a ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `${SELECT} ${whereSql}
       ORDER BY a.is_pinned DESC, a.published_at DESC NULLS LAST, a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { items: rows.map(map), page, pageSize, total: num(total) };
  }

  async function getById(id) {
    const row = await db.one(`${SELECT} WHERE a.id = $1`, [id]);
    if (!row) throw notFound("Announcement not found");
    return map(row);
  }

  async function create(payload, user, ip) {
    await assertTarget(payload);
    const { rows } = await db.query(
      `INSERT INTO announcements (title, body, audience, role_code, course_id, batch_id, is_pinned,
                                  published_at, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9) RETURNING id`,
      [
        payload.title,
        payload.body,
        payload.audience ?? "all",
        payload.audience === "role" ? nullIfEmpty(payload.roleCode) : null,
        payload.audience === "course" ? nullIfEmpty(payload.courseId) : null,
        payload.audience === "batch" ? nullIfEmpty(payload.batchId) : null,
        payload.isPinned ?? false,
        nullIfEmpty(payload.expiresAt),
        user.id
      ]
    );
    const id = rows[0].id;

    const recipients = (await audienceUserIds(payload)).map((row) => row.id).filter((userId) => userId !== user.id);
    const delivered = await notifications.notify(recipients, {
      type: "announcement",
      title: `New notice: ${payload.title}`,
      body: payload.body.length > 240 ? `${payload.body.slice(0, 237)}…` : payload.body,
      link: null
    });

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "announcement.published",
      entityType: "announcement",
      entityId: id,
      metadata: { audience: payload.audience ?? "all", notified: delivered },
      ip
    });

    return getById(id);
  }

  async function update(id, payload, user, ip) {
    const existing = await db.one("SELECT id FROM announcements WHERE id = $1", [id]);
    if (!existing) throw notFound("Announcement not found");

    const map = { title: "title", body: "body", isPinned: "is_pinned", expiresAt: "expires_at" };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "expiresAt" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if (sets.length === 0) return getById(id);

    values.push(id);
    await db.query(`UPDATE announcements SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "announcement.updated",
      entityType: "announcement",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return getById(id);
  }

  async function remove(id, user, ip) {
    const existing = await db.one("SELECT id FROM announcements WHERE id = $1", [id]);
    if (!existing) throw notFound("Announcement not found");
    await db.query("DELETE FROM announcements WHERE id = $1", [id]);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "announcement.deleted",
      entityType: "announcement",
      entityId: id,
      ip
    });
    return { id };
  }

  /** Teachers may only announce to a batch they actually teach. */
  async function createForTeacher(payload, user, ip) {
    const assigned = await db.one("SELECT 1 AS ok FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2", [
      payload.batchId,
      user.id
    ]);
    if (!assigned) throw notFound("That batch is not assigned to you");
    return create(
      {
        title: payload.title,
        body: payload.body,
        audience: "batch",
        batchId: payload.batchId,
        isPinned: payload.isPinned,
        expiresAt: payload.expiresAt
      },
      user,
      ip
    );
  }

  async function listForTeacher(userId, { page = 1, pageSize = 20 } = {}) {
    const where = `WHERE a.created_by = $1
      OR (a.audience = 'batch' AND EXISTS (
        SELECT 1 FROM batch_teachers bt WHERE bt.teacher_id = $1 AND bt.batch_id = a.batch_id
      ))`;
    const total = (await db.one(`SELECT count(*)::int AS count FROM announcements a ${where}`, [userId])).count;
    const rows = await db.many(
      `${SELECT} ${where}
       ORDER BY a.is_pinned DESC, a.published_at DESC NULLS LAST, a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize]
    );
    return { items: rows.map(map), page, pageSize, total: num(total) };
  }

  return { list, getById, create, update, remove, createForTeacher, listForTeacher };
}
