import { badRequest, conflict, notFound } from "../../utils/AppError.js";

const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);
const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : nullIfEmpty(value));

const COURSE_SELECT = `SELECT c.id, c.code, c.name, c.description, c.duration_months, c.status, c.created_at,
         (SELECT count(*)::int FROM course_subjects cs WHERE cs.course_id = c.id) AS subject_count,
         (SELECT count(*)::int FROM batches b WHERE b.course_id = c.id) AS batch_count,
         (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS student_count
  FROM courses c`;

const mapCourse = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  durationMonths: row.duration_months,
  status: row.status,
  subjectCount: Number(row.subject_count),
  batchCount: Number(row.batch_count),
  studentCount: Number(row.student_count)
});

const SUBJECT_SELECT = `SELECT s.id, s.code, s.name, s.description, s.status,
         (SELECT count(*)::int FROM course_subjects cs WHERE cs.subject_id = s.id) AS course_count
  FROM subjects s`;

const mapSubject = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  status: row.status,
  courseCount: Number(row.course_count)
});

export function createAcademicsService(db, audit) {
  /* ---------------------------------------------------------------- courses */
  async function listCourses({ page = 1, pageSize = 20, search, status } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(c.name ILIKE $${idx} OR c.code ILIKE $${idx})`);
    }
    if (status) {
      params.push(status);
      where.push(`c.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (await db.one(`SELECT count(*)::int AS count FROM courses c ${whereSql}`, params)).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `${COURSE_SELECT} ${whereSql} ORDER BY c.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { items: rows.map(mapCourse), page, pageSize, total };
  }

  async function courseById(id) {
    const row = await db.one(`${COURSE_SELECT} WHERE c.id = $1`, [id]);
    if (!row) throw notFound("Course not found");
    return mapCourse(row);
  }

  async function createCourse(payload, actor, ip) {
    try {
      const { rows } = await db.query(
        `INSERT INTO courses (code, name, description, duration_months, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [payload.code, payload.name, nullIfEmpty(payload.description), payload.durationMonths, actor.id]
      );
      const id = rows[0].id;
      await audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "course.created",
        entityType: "course",
        entityId: id,
        metadata: { code: payload.code },
        ip
      });
      return await courseById(id);
    } catch (error) {
      if (error.code === "23505") throw conflict("A course with this code already exists");
      throw error;
    }
  }

  async function updateCourse(id, payload, actor, ip) {
    const sets = [];
    const values = [];
    const map = {
      code: "code",
      name: "name",
      description: "description",
      durationMonths: "duration_months",
      status: "status"
    };
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "description" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    try {
      const result = await db.query(`UPDATE courses SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
      if (result.rowCount === 0) throw notFound("Course not found");
    } catch (error) {
      if (error.code === "23505") throw conflict("A course with this code already exists");
      throw error;
    }
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "course.updated",
      entityType: "course",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return courseById(id);
  }

  async function setCourseSubjects(id, subjectIds, actor, ip) {
    const course = await db.one("SELECT id FROM courses WHERE id = $1", [id]);
    if (!course) throw notFound("Course not found");

    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM course_subjects WHERE course_id = $1 AND NOT (subject_id = ANY($2::uuid[]))", [
        id,
        subjectIds
      ]);
      for (const subjectId of subjectIds) {
        await tx.query(
          `INSERT INTO course_subjects (course_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, subjectId]
        );
      }
    });

    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "course.subjects_updated",
      entityType: "course",
      entityId: id,
      metadata: { count: subjectIds.length },
      ip
    });
    return getCourse(id);
  }

  async function getCourse(id) {
    const course = await courseById(id);
    const subjects = await db.many(
      `SELECT s.id, s.code, s.name FROM course_subjects cs JOIN subjects s ON s.id = cs.subject_id
       WHERE cs.course_id = $1 ORDER BY s.name`,
      [id]
    );
    return { ...course, subjects };
  }

  /* --------------------------------------------------------------- subjects */
  async function listSubjects({ page = 1, pageSize = 20, search, status } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (await db.one(`SELECT count(*)::int AS count FROM subjects s ${whereSql}`, params)).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `${SUBJECT_SELECT} ${whereSql} ORDER BY s.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { items: rows.map(mapSubject), page, pageSize, total };
  }

  async function subjectById(id) {
    const row = await db.one(`${SUBJECT_SELECT} WHERE s.id = $1`, [id]);
    if (!row) throw notFound("Subject not found");
    return mapSubject(row);
  }

  async function createSubject(payload, actor, ip) {
    try {
      const { rows } = await db.query(
        `INSERT INTO subjects (code, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [payload.code, payload.name, nullIfEmpty(payload.description), actor.id]
      );
      const id = rows[0].id;
      await audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "subject.created",
        entityType: "subject",
        entityId: id,
        metadata: { code: payload.code },
        ip
      });
      return await subjectById(id);
    } catch (error) {
      if (error.code === "23505") throw conflict("A subject with this code already exists");
      throw error;
    }
  }

  async function updateSubject(id, payload, actor, ip) {
    const sets = [];
    const values = [];
    const map = { code: "code", name: "name", description: "description", status: "status" };
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "description" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    try {
      const result = await db.query(`UPDATE subjects SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
      if (result.rowCount === 0) throw notFound("Subject not found");
    } catch (error) {
      if (error.code === "23505") throw conflict("A subject with this code already exists");
      throw error;
    }
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "subject.updated",
      entityType: "subject",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return subjectById(id);
  }

  /* ---------------------------------------------------------------- batches */
  async function listBatches({ page = 1, pageSize = 20, search, courseId, status } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(`(b.name ILIKE $${idx} OR b.code ILIKE $${idx})`);
    }
    if (courseId) {
      params.push(courseId);
      where.push(`b.course_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`b.status = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (
      await db.one(`SELECT count(*)::int AS count FROM batches b JOIN courses c ON c.id = b.course_id ${whereSql}`, params)
    ).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT b.id, b.code, b.name, b.start_date, b.end_date, b.capacity, b.status, b.schedule_note,
              c.id AS course_id, c.name AS course_name, c.code AS course_code,
              (SELECT count(*)::int FROM enrollments e WHERE e.batch_id = b.id AND e.status = 'active') AS student_count,
              (SELECT count(*)::int FROM batch_teachers bt WHERE bt.batch_id = b.id) AS teacher_count
       FROM batches b JOIN courses c ON c.id = b.course_id
       ${whereSql}
       ORDER BY b.start_date DESC, b.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const items = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      capacity: row.capacity,
      status: row.status,
      scheduleNote: row.schedule_note,
      courseId: row.course_id,
      courseName: row.course_name,
      courseCode: row.course_code,
      studentCount: Number(row.student_count),
      teacherCount: Number(row.teacher_count)
    }));

    return { items, page, pageSize, total };
  }

  async function createBatch(payload, actor, ip) {
    const course = await db.one("SELECT id FROM courses WHERE id = $1", [payload.courseId]);
    if (!course) throw notFound("Course not found");

    try {
      const { rows } = await db.query(
        `INSERT INTO batches (course_id, code, name, start_date, end_date, capacity, schedule_note, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          payload.courseId,
          payload.code,
          payload.name,
          isoDate(payload.startDate),
          isoDate(payload.endDate),
          payload.capacity ?? null,
          nullIfEmpty(payload.schedule),
          payload.startDate > new Date() ? "upcoming" : "active",
          actor.id
        ]
      );
      const id = rows[0].id;
      await audit.record({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "batch.created",
        entityType: "batch",
        entityId: id,
        metadata: { code: payload.code },
        ip
      });
      return getBatch(id);
    } catch (error) {
      if (error.code === "23505") throw conflict("A batch with this code already exists");
      throw error;
    }
  }

  async function updateBatch(id, payload, actor, ip) {
    const map = {
      code: "code",
      name: "name",
      startDate: "start_date",
      endDate: "end_date",
      capacity: "capacity",
      status: "status"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "startDate" || field === "endDate" ? isoDate(payload[field]) : payload[field]);
    }
    if ("schedule" in payload) {
      sets.push(`schedule_note = $${sets.length + 1}`);
      values.push(nullIfEmpty(payload.schedule));
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);

    try {
      const result = await db.query(`UPDATE batches SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
      if (result.rowCount === 0) throw notFound("Batch not found");
    } catch (error) {
      if (error.code === "23505") throw conflict("A batch with this code already exists");
      throw error;
    }
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.updated",
      entityType: "batch",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return getBatch(id);
  }

  async function getBatch(id) {
    const row = await db.one(
      `SELECT b.id, b.code, b.name, b.start_date, b.end_date, b.capacity, b.status, b.schedule_note,
              c.id AS course_id, c.name AS course_name, c.code AS course_code
       FROM batches b JOIN courses c ON c.id = b.course_id WHERE b.id = $1`,
      [id]
    );
    if (!row) throw notFound("Batch not found");

    const [subjects, teachers, students, schedule] = await Promise.all([
      db.many(
        `SELECT s.id, s.code, s.name FROM batch_subjects bs JOIN subjects s ON s.id = bs.subject_id
         WHERE bs.batch_id = $1 ORDER BY s.name`,
        [id]
      ),
      db.many(
        `SELECT bt.id, u.id AS teacher_id, u.full_name, u.email, bt.subject_id, s.name AS subject_name, bt.is_primary
         FROM batch_teachers bt
         JOIN users u ON u.id = bt.teacher_id
         LEFT JOIN subjects s ON s.id = bt.subject_id
         WHERE bt.batch_id = $1
         ORDER BY u.full_name`,
        [id]
      ),
      db.many(
        `SELECT e.id, e.status, e.enrolled_at, u.id AS student_id, u.full_name, u.email, sp.enrollment_no
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         JOIN student_profiles sp ON sp.user_id = u.id
         WHERE e.batch_id = $1
         ORDER BY u.full_name`,
        [id]
      ),
      db.many(
        `SELECT bs.id, bs.day_of_week, bs.start_time, bs.end_time, bs.room, bs.subject_id, s.name AS subject_name,
                bs.teacher_id, u.full_name AS teacher_name
         FROM batch_schedules bs
         LEFT JOIN subjects s ON s.id = bs.subject_id
         LEFT JOIN users u ON u.id = bs.teacher_id
         WHERE bs.batch_id = $1
         ORDER BY bs.day_of_week, bs.start_time`,
        [id]
      )
    ]);

    return {
      batch: {
        id: row.id,
        code: row.code,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        capacity: row.capacity,
        status: row.status,
        scheduleNote: row.schedule_note,
        courseId: row.course_id,
        courseName: row.course_name,
        courseCode: row.course_code,
        studentCount: students.filter((student) => student.status === "active").length
      },
      subjects,
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        teacherId: teacher.teacher_id,
        fullName: teacher.full_name,
        email: teacher.email,
        subjectId: teacher.subject_id,
        subjectName: teacher.subject_name,
        isPrimary: teacher.is_primary
      })),
      students: students.map((student) => ({
        enrollmentId: student.id,
        status: student.status,
        enrolledAt: student.enrolled_at,
        studentId: student.student_id,
        fullName: student.full_name,
        email: student.email,
        enrollmentNo: student.enrollment_no
      })),
      schedule: schedule.map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.day_of_week,
        startTime: slot.start_time,
        endTime: slot.end_time,
        room: slot.room,
        subjectId: slot.subject_id,
        subjectName: slot.subject_name,
        teacherId: slot.teacher_id,
        teacherName: slot.teacher_name
      }))
    };
  }

  async function addBatchSubject(id, subjectId, actor, ip) {
    const batch = await db.one("SELECT id FROM batches WHERE id = $1", [id]);
    if (!batch) throw notFound("Batch not found");
    const subject = await db.one("SELECT id FROM subjects WHERE id = $1", [subjectId]);
    if (!subject) throw notFound("Subject not found");

    await db.query("INSERT INTO batch_subjects (batch_id, subject_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
      id,
      subjectId
    ]);
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.subject_added",
      entityType: "batch",
      entityId: id,
      metadata: { subjectId },
      ip
    });
    return getBatch(id);
  }

  async function removeBatchSubject(id, subjectId, actor, ip) {
    const result = await db.query("DELETE FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2", [id, subjectId]);
    if (result.rowCount === 0) throw notFound("Subject is not part of this batch");
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.subject_removed",
      entityType: "batch",
      entityId: id,
      metadata: { subjectId },
      ip
    });
    return getBatch(id);
  }

  async function assignBatchTeacher(id, { teacherId, subjectId }, actor, ip) {
    const teacher = await db.one("SELECT user_id FROM teacher_profiles WHERE user_id = $1", [teacherId]);
    if (!teacher) throw notFound("Teacher not found");
    if (subjectId) {
      const mapping = await db.one("SELECT 1 AS ok FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2", [id, subjectId]);
      if (!mapping) throw badRequest("Add that subject to the batch first");
    }

    await db.query(
      `INSERT INTO batch_teachers (batch_id, teacher_id, subject_id, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (batch_id, teacher_id, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
      [id, teacherId, nullIfEmpty(subjectId), actor.id]
    );
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.teacher_assigned",
      entityType: "batch",
      entityId: id,
      metadata: { teacherId, subjectId: subjectId || null },
      ip
    });
    return getBatch(id);
  }

  async function removeBatchTeacher(id, teacherId, actor, ip) {
    const result = await db.query("DELETE FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2", [id, teacherId]);
    if (result.rowCount === 0) throw notFound("Teacher is not assigned to this batch");
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.teacher_removed",
      entityType: "batch",
      entityId: id,
      metadata: { teacherId },
      ip
    });
    return getBatch(id);
  }

  async function addSchedule(id, payload, actor, ip) {
    if (payload.subjectId) {
      const mapping = await db.one("SELECT 1 AS ok FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2", [
        id,
        payload.subjectId
      ]);
      if (!mapping) throw badRequest("Add that subject to the batch first");
    }
    if (payload.teacherId) {
      const teacher = await db.one("SELECT user_id FROM teacher_profiles WHERE user_id = $1", [payload.teacherId]);
      if (!teacher) throw notFound("Teacher not found");
    }

    const { rows } = await db.query(
      `INSERT INTO batch_schedules (batch_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        id,
        nullIfEmpty(payload.subjectId),
        nullIfEmpty(payload.teacherId),
        payload.dayOfWeek,
        payload.startTime,
        payload.endTime,
        nullIfEmpty(payload.room)
      ]
    );
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.schedule_added",
      entityType: "batch",
      entityId: id,
      metadata: { scheduleId: rows[0].id },
      ip
    });
    return getBatch(id);
  }

  async function removeSchedule(id, scheduleId, actor, ip) {
    const result = await db.query("DELETE FROM batch_schedules WHERE id = $1 AND batch_id = $2", [scheduleId, id]);
    if (result.rowCount === 0) throw notFound("Schedule slot not found");
    await audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "batch.schedule_removed",
      entityType: "batch",
      entityId: id,
      metadata: { scheduleId },
      ip
    });
    return getBatch(id);
  }

  return {
    listCourses,
    getCourse,
    createCourse,
    updateCourse,
    setCourseSubjects,
    listSubjects,
    createSubject,
    updateSubject,
    listBatches,
    getBatch,
    createBatch,
    updateBatch,
    addBatchSubject,
    removeBatchSubject,
    assignBatchTeacher,
    removeBatchTeacher,
    addSchedule,
    removeSchedule
  };
}
