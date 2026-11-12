import { generatePassword, hashPassword } from "@coaching/auth";
import { badRequest, conflict, notFound } from "../../utils/AppError.js";

const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);

const EDITABLE = {
  fullName: "full_name",
  phone: "phone",
  status: "status",
  employeeCode: "employee_code",
  qualification: "qualification",
  specialization: "specialization",
  joiningDate: "joining_date"
};

const PROFILE_FIELDS = new Set(["employeeCode", "qualification", "specialization", "joiningDate"]);

export function createTeachersService(db, audit) {
  async function list({ page, pageSize, search, status }) {
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR tp.employee_code ILIKE $${idx})`);
    }
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id ${whereSql}`,
        params
      )
    ).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status,
              tp.employee_code, tp.qualification, tp.specialization, tp.joining_date,
              (SELECT count(*)::int FROM batch_teachers bt WHERE bt.teacher_id = tp.user_id) AS batch_count
       FROM teacher_profiles tp
       JOIN users u ON u.id = tp.user_id
       ${whereSql}
       ORDER BY tp.created_at DESC
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
        employeeCode: row.employee_code,
        qualification: row.qualification,
        specialization: row.specialization,
        joiningDate: row.joining_date,
        batchCount: Number(row.batch_count)
      })),
      page,
      pageSize,
      total
    };
  }

  async function getById(id) {
    const row = await db.one(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.last_login_at,
              tp.employee_code, tp.qualification, tp.specialization, tp.joining_date, tp.bio
       FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id
       WHERE u.id = $1`,
      [id]
    );
    if (!row) throw notFound("Teacher not found");

    const assignments = await db.many(
      `SELECT bt.id, bt.batch_id, b.name AS batch_name, b.code AS batch_code,
              bt.subject_id, s.name AS subject_name, bt.is_primary
       FROM batch_teachers bt
       JOIN batches b ON b.id = bt.batch_id
       LEFT JOIN subjects s ON s.id = bt.subject_id
       WHERE bt.teacher_id = $1
       ORDER BY b.name`,
      [id]
    );

    return {
      teacher: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        employeeCode: row.employee_code,
        qualification: row.qualification,
        specialization: row.specialization,
        joiningDate: row.joining_date,
        bio: row.bio,
        lastLoginAt: row.last_login_at
      },
      assignments: assignments.map((assignment) => ({
        id: assignment.id,
        batchId: assignment.batch_id,
        batchName: assignment.batch_name,
        batchCode: assignment.batch_code,
        subjectId: assignment.subject_id,
        subjectName: assignment.subject_name,
        isPrimary: assignment.is_primary
      }))
    };
  }

  async function create(payload, actor, ip) {
    const useGenerated = !payload.password;
    const password = payload.password || generatePassword(12);

    const id = await db.transaction(async (tx) => {
      const duplicate = await tx.one(
        `SELECT u.id FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id
         WHERE lower(u.email) = lower($1) OR lower(tp.employee_code) = lower($2) LIMIT 1`,
        [payload.email, payload.employeeCode]
      );
      if (duplicate) throw conflict("A user with this email or employee code already exists");

      const { rows } = await tx.query(
        `INSERT INTO users (email, password_hash, full_name, phone, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [payload.email, hashPassword(password), payload.fullName, nullIfEmpty(payload.phone), actor.id]
      );
      const userId = rows[0].id;
      await tx.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, 'teacher', $2)", [userId, actor.id]);
      await tx.query(
        `INSERT INTO teacher_profiles (user_id, employee_code, qualification, specialization, joining_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          payload.employeeCode,
          nullIfEmpty(payload.qualification),
          nullIfEmpty(payload.specialization),
          nullIfEmpty(payload.joiningDate)
        ]
      );
      return userId;
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "teacher.created",
      entityType: "teacher",
      entityId: id,
      metadata: { email: payload.email, employeeCode: payload.employeeCode },
      ip
    });

    return { teacher: await getById(id), temporaryPassword: useGenerated ? password : null };
  }

  async function update(id, payload, actor, ip) {
    const existing = await db.one(
      "SELECT u.id FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = $1",
      [id]
    );
    if (!existing) throw notFound("Teacher not found");

    await db.transaction(async (tx) => {
      const userSets = [];
      const userValues = [];
      const profileSets = [];
      const profileValues = [];

      for (const [field, column] of Object.entries(EDITABLE)) {
        if (!(field in payload)) continue;
        const value = nullIfEmpty(payload[field]);
        if (PROFILE_FIELDS.has(field)) {
          profileSets.push(`${column} = $${profileSets.length + 1}`);
          profileValues.push(value);
        } else {
          userSets.push(`${column} = $${userSets.length + 1}`);
          userValues.push(value);
        }
      }

      if (userSets.length > 0) {
        userValues.push(id);
        await tx.query(`UPDATE users SET ${userSets.join(", ")}, updated_at = now() WHERE id = $${userValues.length}`, userValues);
      }
      if (profileSets.length > 0) {
        profileValues.push(id);
        await tx.query(
          `UPDATE teacher_profiles SET ${profileSets.join(", ")}, updated_at = now() WHERE user_id = $${profileValues.length}`,
          profileValues
        );
      }
      if (payload.status && payload.status !== "active") {
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "teacher.updated",
      entityType: "teacher",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });

    return getById(id);
  }

  async function assignBatch(id, { batchId, subjectId }, actor, ip) {
    const teacher = await db.one("SELECT user_id FROM teacher_profiles WHERE user_id = $1", [id]);
    if (!teacher) throw notFound("Teacher not found");

    const batch = await db.one("SELECT id FROM batches WHERE id = $1", [batchId]);
    if (!batch) throw notFound("Batch not found");

    if (subjectId) {
      const mapping = await db.one("SELECT 1 AS ok FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2", [
        batchId,
        subjectId
      ]);
      if (!mapping) throw badRequest("That subject is not part of this batch");
    }

    await db.query(
      `INSERT INTO batch_teachers (batch_id, teacher_id, subject_id, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (batch_id, teacher_id, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO NOTHING`,
      [batchId, id, nullIfEmpty(subjectId), actor.id]
    );

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "teacher.batch_assigned",
      entityType: "batch_teachers",
      entityId: id,
      metadata: { batchId, subjectId: subjectId || null },
      ip
    });

    return getById(id);
  }

  async function unassignBatch(id, batchId, actor, ip) {
    const result = await db.query("DELETE FROM batch_teachers WHERE teacher_id = $1 AND batch_id = $2", [id, batchId]);
    if (result.rowCount === 0) throw notFound("Assignment not found");
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "teacher.batch_unassigned",
      entityType: "batch_teachers",
      entityId: id,
      metadata: { batchId },
      ip
    });
    return getById(id);
  }

  async function changeStatus(id, status, actor, ip) {
    const teacher = await db.one(
      "SELECT u.id FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = $1",
      [id]
    );
    if (!teacher) throw notFound("Teacher not found");

    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
      if (status !== "active") {
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "teacher.status_changed",
      entityType: "teacher",
      entityId: id,
      metadata: { status },
      ip
    });

    return { id, status };
  }

  async function resetPassword(id, password, actor, ip) {
    const user = await db.one("SELECT id FROM users WHERE id = $1", [id]);
    if (!user) throw notFound("User not found");
    const useGenerated = !password;
    const nextPassword = password || generatePassword(12);

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now(),
                failed_login_attempts = 0, locked_until = NULL, updated_at = now()
         WHERE id = $1`,
        [id, hashPassword(nextPassword)]
      );
      await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "user.password_reset",
      entityType: "user",
      entityId: id,
      ip
    });
    return { temporaryPassword: useGenerated ? nextPassword : null };
  }

  return { list, getById, create, update, changeStatus, assignBatch, unassignBatch, resetPassword };
}
