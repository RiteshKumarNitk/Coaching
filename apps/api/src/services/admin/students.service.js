import { generatePassword, hashPassword } from "@coaching/auth";
import { normaliseKeys, parseCsv, toCsv, studentImportRowSchema } from "@coaching/shared";
import { badRequest, conflict, notFound } from "../../utils/AppError.js";

const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);

/** DATE columns round-trip as local midnight; toISOString() would return the previous day. */
const dateOnly = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

/** Columns that a PATCH may change, mapped to their SQL names. */
const EDITABLE = {
  fullName: "full_name",
  email: "email",
  phone: "phone",
  status: "status",
  enrollmentNo: "enrollment_no",
  admissionDate: "admission_date",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  address: "address",
  city: "city",
  state: "state",
  pincode: "pincode"
};

const PROFILE_FIELDS = new Set([
  "enrollmentNo",
  "admissionDate",
  "dateOfBirth",
  "gender",
  "address",
  "city",
  "state",
  "pincode"
]);

export function mapStudent(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    enrollmentNo: row.enrollment_no,
    admissionDate: row.admission_date,
    courseName: row.course_name ?? null,
    courseId: row.course_id ?? null,
    batchName: row.batch_name ?? null,
    batchId: row.batch_id ?? null,
    createdAt: row.created_at
  };
}

export function createStudentsService(db, audit) {
  async function loadBatch(tx, batchId) {
    const batch = await tx.one("SELECT id, course_id, status FROM batches WHERE id = $1", [batchId]);
    if (!batch) throw notFound("Batch not found");
    return batch;
  }

  async function list({ page, pageSize, search, status, batchId }) {
    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR sp.enrollment_no ILIKE $${idx})`);
    }
    if (status) {
      params.push(status);
      where.push(`u.status = $${params.length}`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(
        `EXISTS (SELECT 1 FROM enrollments e2 WHERE e2.student_id = sp.user_id AND e2.batch_id = $${params.length} AND e2.status = 'active')`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM student_profiles sp JOIN users u ON u.id = sp.user_id ${whereSql}`,
        params
      )
    ).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status,
              sp.enrollment_no, sp.admission_date, sp.created_at,
              en.course_id, c.name AS course_name, en.batch_id, b.name AS batch_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN LATERAL (
         SELECT e.course_id, e.batch_id FROM enrollments e
         WHERE e.student_id = sp.user_id AND e.status = 'active'
         ORDER BY e.enrolled_at DESC LIMIT 1
       ) en ON true
       LEFT JOIN courses c ON c.id = en.course_id
       LEFT JOIN batches b ON b.id = en.batch_id
       ${whereSql}
       ORDER BY sp.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { items: rows.map(mapStudent), page, pageSize, total };
  }

  async function getById(id) {
    const row = await db.one(
      `SELECT u.id, u.email, u.full_name, u.phone, u.status, u.created_at, u.last_login_at,
              sp.enrollment_no, sp.admission_date, sp.date_of_birth, sp.gender,
              sp.address, sp.city, sp.state, sp.pincode, sp.created_at AS profile_created_at
       FROM users u JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = $1`,
      [id]
    );
    if (!row) throw notFound("Student not found");

    const [guardians, enrollments, attendance, fees, results] = await Promise.all([
      db.many(
        `SELECT gp.id, gp.name, gp.relation, gp.phone, gp.email, gp.is_primary, gp.user_id,
                gu.email AS login_email
         FROM guardian_profiles gp
         LEFT JOIN users gu ON gu.id = gp.user_id
         WHERE gp.student_id = $1
         ORDER BY gp.is_primary DESC`,
        [id]
      ),
      db.many(
        `SELECT e.id, e.status, e.enrolled_at, b.id AS batch_id, b.name AS batch_name, b.code AS batch_code,
                c.id AS course_id, c.name AS course_name
         FROM enrollments e
         JOIN batches b ON b.id = e.batch_id
         JOIN courses c ON c.id = e.course_id
         WHERE e.student_id = $1
         ORDER BY e.status = 'active' DESC, e.enrolled_at DESC`,
        [id]
      ),
      db.one(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
                count(*) FILTER (WHERE status = 'absent')::int AS absent
         FROM attendance WHERE student_id = $1`,
        [id]
      ),
      db.one(
        `SELECT COALESCE(SUM(sf.net_amount), 0)::numeric AS total,
                COALESCE(SUM(COALESCE(p.paid, 0)), 0)::numeric AS paid
         FROM student_fees sf
         LEFT JOIN (SELECT student_fee_id, SUM(amount) AS paid FROM payments GROUP BY student_fee_id) p
           ON p.student_fee_id = sf.id
         WHERE sf.student_id = $1 AND sf.status <> 'waived'`,
        [id]
      ),
      db.many(
        `SELECT er.id, e.title AS exam_title, er.obtained_marks, er.total_marks, er.percentage, er.status, er.published_at
         FROM exam_results er JOIN exams e ON e.id = er.exam_id
         WHERE er.student_id = $1 AND e.results_published = true
         ORDER BY er.published_at DESC NULLS LAST LIMIT 5`,
        [id]
      )
    ]);

    const total = Number(attendance.total);
    return {
      student: {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        enrollmentNo: row.enrollment_no,
        admissionDate: row.admission_date,
        dateOfBirth: row.date_of_birth,
        gender: row.gender,
        address: row.address,
        city: row.city,
        state: row.state,
        pincode: row.pincode,
        lastLoginAt: row.last_login_at,
        createdAt: row.profile_created_at ?? row.created_at
      },
      guardians: guardians.map((guardian) => ({
        id: guardian.id,
        name: guardian.name,
        relation: guardian.relation,
        phone: guardian.phone,
        email: guardian.email,
        isPrimary: guardian.is_primary,
        hasLogin: Boolean(guardian.user_id),
        loginEmail: guardian.login_email ?? null
      })),
      enrollments: enrollments.map((enrollment) => ({
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolled_at,
        batchId: enrollment.batch_id,
        batchName: enrollment.batch_name,
        batchCode: enrollment.batch_code,
        courseId: enrollment.course_id,
        courseName: enrollment.course_name
      })),
      attendance: {
        total,
        present: Number(attendance.present),
        absent: Number(attendance.absent),
        percentage: total === 0 ? null : Math.round((Number(attendance.present) / total) * 100)
      },
      fees: {
        total: Number(fees.total),
        paid: Number(fees.paid),
        pending: Number(fees.total) - Number(fees.paid)
      },
      results
    };
  }

  async function create(payload, actor, ip) {
    const useGenerated = !payload.password;
    const password = payload.password || generatePassword(12);

    const id = await db.transaction(async (tx) => {
      const duplicate = await tx.one(
        `SELECT u.id FROM users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE lower(u.email) = lower($1) OR lower(sp.enrollment_no) = lower($2)
         LIMIT 1`,
        [payload.email, payload.enrollmentNo]
      );
      if (duplicate) throw conflict("A user with this email or enrolment number already exists");

      const { rows } = await tx.query(
        `INSERT INTO users (email, password_hash, full_name, phone, created_by, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [payload.email, hashPassword(password), payload.fullName, nullIfEmpty(payload.phone), actor.id, !payload.password]
      );
      const userId = rows[0].id;
      await tx.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, 'student', $2)", [
        userId,
        actor.id
      ]);
      await tx.query(
        `INSERT INTO student_profiles
           (user_id, enrollment_no, admission_date, date_of_birth, gender, address, city, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          payload.enrollmentNo,
          nullIfEmpty(payload.admissionDate) ?? dateOnly(new Date()),
          nullIfEmpty(payload.dateOfBirth),
          nullIfEmpty(payload.gender),
          nullIfEmpty(payload.address),
          nullIfEmpty(payload.city),
          nullIfEmpty(payload.state),
          nullIfEmpty(payload.pincode)
        ]
      );
      if (payload.guardianName) {
        await tx.query(
          `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary)
           VALUES ($1, $2, 'guardian', $3, true)`,
          [userId, payload.guardianName, nullIfEmpty(payload.guardianPhone)]
        );
      }
      if (payload.batchId) {
        const batch = await loadBatch(tx, payload.batchId);
        await tx.query(
          `INSERT INTO enrollments (student_id, batch_id, course_id, created_by) VALUES ($1, $2, $3, $4)`,
          [userId, batch.id, batch.course_id, actor.id]
        );
      }
      return userId;
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "student.created",
      entityType: "student",
      entityId: id,
      metadata: { email: payload.email, enrollmentNo: payload.enrollmentNo },
      ip
    });

    return { student: await getById(id), temporaryPassword: useGenerated ? password : null };
  }

  async function update(id, payload, actor, ip) {
    const existing = await db.one("SELECT u.id FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = $1", [id]);
    if (!existing) throw notFound("Student not found");

    try {
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
          `UPDATE student_profiles SET ${profileSets.join(", ")}, updated_at = now() WHERE user_id = $${profileValues.length}`,
          profileValues
        );
      }

      if ("guardianName" in payload) {
        const primary = await tx.one("SELECT id FROM guardian_profiles WHERE student_id = $1 AND is_primary LIMIT 1", [id]);
        if (primary) {
          await tx.query(
            "UPDATE guardian_profiles SET name = $2, phone = $3, updated_at = now() WHERE id = $1",
            [primary.id, payload.guardianName || "Guardian", nullIfEmpty(payload.guardianPhone)]
          );
        } else if (payload.guardianName) {
          await tx.query(
            `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary) VALUES ($1, $2, 'guardian', $3, true)`,
            [id, payload.guardianName, nullIfEmpty(payload.guardianPhone)]
          );
        }
      }

      if (payload.status && payload.status !== "active") {
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
      });
    } catch (error) {
      if (error.code === "23505") throw conflict("That email is already used by another account");
      throw error;
    }

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "student.updated",
      entityType: "student",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });

    return getById(id);
  }

  async function changeStatus(id, status, actor, ip) {
    const existss = await db.one("SELECT id FROM users WHERE id = $1", [id]);
    if (!existss) throw notFound("Student not found");
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
      if (status !== "active") {
        await tx.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
      }
    });
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "student.status_changed",
      entityType: "student",
      entityId: id,
      metadata: { status },
      ip
    });
    return { id, status };
  }

  async function assignEnrollment(id, batchId, actor, ip) {
    const student = await db.one("SELECT user_id FROM student_profiles WHERE user_id = $1", [id]);
    if (!student) throw notFound("Student not found");

    await db.transaction(async (tx) => {
      const batch = await loadBatch(tx, batchId);
      await tx.query(
        `INSERT INTO enrollments (student_id, batch_id, course_id, status, created_by)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT (student_id, batch_id) DO UPDATE SET status = 'active'`,
        [id, batch.id, batch.course_id, actor.id]
      );
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "student.enrolled",
      entityType: "enrollment",
      entityId: id,
      metadata: { batchId },
      ip
    });
    return getById(id);
  }

  async function removeEnrollment(id, enrollmentId, actor, ip) {
    const enrollment = await db.one("SELECT id, student_id FROM enrollments WHERE id = $1", [enrollmentId]);
    if (!enrollment || enrollment.student_id !== id) throw notFound("Enrolment not found");
    await db.query("DELETE FROM enrollments WHERE id = $1", [enrollmentId]);
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "student.unenrolled",
      entityType: "enrollment",
      entityId: enrollmentId,
      metadata: { studentId: id },
      ip
    });
    return getById(id);
  }

  async function resetPassword(id, password, actor, ip) {
    const user = await db.one("SELECT id, email FROM users WHERE id = $1", [id]);
    if (!user) throw notFound("User not found");
    const useGenerated = !password;
    const nextPassword = password || generatePassword(12);

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = true,
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

  /**
   * Create a read-only guardian account and link it to the student's guardian row.
   * The temporary password is returned once; the app forces a change at first sign-in.
   */
  async function grantGuardianAccess(id, { email, name }, actor, ip) {
    const student = await db.one(
      "SELECT u.id, u.full_name FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = $1",
      [id]
    );
    if (!student) throw notFound("Student not found");

    const temporaryPassword = generatePassword(12);
    let guardianUserId;

    try {
      guardianUserId = await db.transaction(async (tx) => {
        const duplicate = await tx.one("SELECT id FROM users WHERE lower(email) = lower($1)", [email]);
        if (duplicate) throw conflict("That email already has an account");

        const { rows } = await tx.query(
          `INSERT INTO users (email, password_hash, full_name, must_change_password, created_by)
           VALUES ($1, $2, $3, true, $4) RETURNING id`,
          [email, hashPassword(temporaryPassword), name || `${student.full_name} Guardian`, actor.id]
        );
        const userId = rows[0].id;
        await tx.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, 'guardian', $2)", [
          userId,
          actor.id
        ]);

        const profile = await tx.one(
          `SELECT id FROM guardian_profiles WHERE student_id = $1
           ORDER BY is_primary DESC, created_at LIMIT 1`,
          [id]
        );
        if (profile) {
          await tx.query(
            `UPDATE guardian_profiles SET user_id = $2, email = COALESCE(email, $3), updated_at = now()
             WHERE id = $1`,
            [profile.id, userId, email]
          );
        } else {
          await tx.query(
            `INSERT INTO guardian_profiles (student_id, name, relation, email, user_id, is_primary)
             VALUES ($1, $2, 'guardian', $3, $4, true)`,
            [id, name || `${student.full_name} Guardian`, email, userId]
          );
        }
        return userId;
      });
    } catch (error) {
      if (error.code === "23505") throw conflict("That email already has an account");
      throw error;
    }

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "guardian.access_granted",
      entityType: "student",
      entityId: id,
      metadata: { guardianUserId, email },
      ip
    });

    return { guardianUserId, email, temporaryPassword };
  }

  async function exportCsv() {
    const rows = await db.many(
      `SELECT u.full_name, u.email, sp.enrollment_no, u.phone, u.status, sp.admission_date,
              c.name AS course_name, b.name AS batch_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN LATERAL (
         SELECT e.course_id, e.batch_id FROM enrollments e
         WHERE e.student_id = sp.user_id AND e.status = 'active'
         ORDER BY e.enrolled_at DESC LIMIT 1
       ) en ON true
       LEFT JOIN courses c ON c.id = en.course_id
       LEFT JOIN batches b ON b.id = en.batch_id
       ORDER BY sp.enrollment_no`
    );
    return toCsv(
      ["full_name", "email", "enrollment_no", "phone", "status", "admission_date", "course", "batch"],
      rows.map((row) => [
        row.full_name,
        row.email,
        row.enrollment_no,
        row.phone,
        row.status,
        dateOnly(row.admission_date),
        row.course_name,
        row.batch_name
      ])
    );
  }

  async function importCsv(csvText, actor, ip) {
    const table = parseCsv(csvText);
    const header = table.shift()?.map((value) => String(value).trim().toLowerCase().replace(/\s+/g, "_"));
    if (!header || header.length === 0) throw badRequest("The CSV is empty or has no header row");
    if (table.length === 0) throw badRequest("The CSV has a header but no data rows");
    if (table.length > 2000) throw badRequest("Import at most 2000 students per file");

    const invalid = [];
    const rows = table.map((values, index) => {
      const parsed = studentImportRowSchema.safeParse(normaliseKeys(Object.fromEntries(header.map((key, position) => [key, values[position] ?? ""]))));
      if (!parsed.success) {
        invalid.push({ row: index + 2, message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") });
        return null;
      }
      return parsed.data;
    });
    if (invalid.length > 0) {
      throw badRequest(`Fix ${invalid.length} invalid row(s) before importing`, invalid.slice(0, 20));
    }

    const created = [];
    const skipped = [];

    await db.transaction(async (tx) => {
      for (const row of rows) {
        const duplicate = await tx.one(
          `SELECT u.id FROM users u LEFT JOIN student_profiles sp ON sp.user_id = u.id
           WHERE lower(u.email) = lower($1) OR lower(sp.enrollment_no) = lower($2) LIMIT 1`,
          [row.email, row.enrollment_no]
        );
        if (duplicate) {
          skipped.push({ email: row.email, reason: "already exists" });
          continue;
        }

        const temporaryPassword = generatePassword(12);
        const { rows: userRows } = await tx.query(
          `INSERT INTO users (email, password_hash, full_name, phone, created_by, must_change_password)
           VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
          [row.email, hashPassword(temporaryPassword), row.full_name, nullIfEmpty(row.phone), actor.id]
        );
        const userId = userRows[0].id;
        await tx.query("INSERT INTO user_roles (user_id, role_code, granted_by) VALUES ($1, 'student', $2)", [userId, actor.id]);
        await tx.query(
          `INSERT INTO student_profiles (user_id, enrollment_no, admission_date) VALUES ($1, $2, $3)`,
          [userId, row.enrollment_no, nullIfEmpty(row.admission_date)]
        );
        if (row.guardian_name) {
          await tx.query(
            `INSERT INTO guardian_profiles (student_id, name, relation, phone, is_primary) VALUES ($1, $2, 'guardian', $3, true)`,
            [userId, row.guardian_name, nullIfEmpty(row.guardian_phone)]
          );
        }
        if (row.batch_code) {
          const batch = await tx.one("SELECT id, course_id FROM batches WHERE lower(code) = lower($1)", [row.batch_code]);
          if (!batch) throw badRequest(`Batch "${row.batch_code}" does not exist`);
          await tx.query(`INSERT INTO enrollments (student_id, batch_id, course_id, created_by) VALUES ($1, $2, $3, $4)`, [
            userId,
            batch.id,
            batch.course_id,
            actor.id
          ]);
        }
        created.push({ email: row.email, enrollmentNo: row.enrollment_no, temporaryPassword });
      }
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "students.bulk_import",
      entityType: "student",
      metadata: { created: created.length, skipped: skipped.length },
      ip
    });

    return { created: created.length, skipped, credentials: created };
  }

  return {
    list,
    getById,
    create,
    update,
    changeStatus,
    assignEnrollment,
    removeEnrollment,
    resetPassword,
    grantGuardianAccess,
    exportCsv,
    importCsv
  };
}
