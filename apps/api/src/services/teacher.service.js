import { badRequest, notFound } from "../utils/AppError.js";

const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);

/**
 * Phase 3 workspace for teachers. Every batch-scoped call checks batch_teachers
 * (admins bypass), so a teacher can only touch batches assigned to them.
 */
export function createTeacherService(db, audit) {
  const isAdmin = (user) => user.roles.some((role) => role === "admin" || role === "super_admin");

  async function assertBatch(batchId, user) {
    const batch = await db.one(
      `SELECT b.id, b.code, b.name, b.course_id, b.start_date, b.end_date, b.status
       FROM batches b WHERE b.id = $1`,
      [batchId]
    );
    if (!batch) throw notFound("Batch not found");
    if (!isAdmin(user)) {
      const assigned = await db.one(
        "SELECT 1 AS ok FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2",
        [batchId, user.id]
      );
      if (!assigned) throw notFound("Batch not found");
    }
    return batch;
  }

  async function assertBatchSubject(batchId, subjectId) {
    const mapping = await db.one(
      "SELECT 1 AS ok FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2",
      [batchId, subjectId]
    );
    if (!mapping) throw badRequest("That subject is not part of this batch");
  }

  async function listBatches(user) {
    const rows = await db.many(
      `SELECT b.id, b.code, b.name, b.start_date, b.end_date, b.capacity, b.status,
              c.name AS course_name, c.code AS course_code,
              (SELECT count(*)::int FROM enrollments e WHERE e.batch_id = b.id AND e.status = 'active') AS student_count,
              (SELECT count(*)::int FROM lessons l WHERE l.batch_id = b.id) AS lesson_count,
              (SELECT count(*)::int FROM assignments a WHERE a.batch_id = b.id) AS assignment_count
       FROM batches b JOIN courses c ON c.id = b.course_id
       WHERE $1::boolean OR EXISTS (
         SELECT 1 FROM batch_teachers bt WHERE bt.batch_id = b.id AND bt.teacher_id = $2
       )
       ORDER BY b.start_date DESC, b.name`,
      [isAdmin(user), user.id]
    );

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      capacity: row.capacity,
      status: row.status,
      courseName: row.course_name,
      courseCode: row.course_code,
      studentCount: Number(row.student_count),
      lessonCount: Number(row.lesson_count),
      assignmentCount: Number(row.assignment_count)
    }));
  }

  async function getBatch(batchId, user) {
    const batch = await assertBatch(batchId, user);

    const [subjects, students, schedule] = await Promise.all([
      db.many(
        `SELECT s.id, s.code, s.name FROM batch_subjects bs JOIN subjects s ON s.id = bs.subject_id
         WHERE bs.batch_id = $1 ORDER BY s.name`,
        [batchId]
      ),
      db.many(
        `SELECT u.id AS student_id, u.full_name, u.email, sp.enrollment_no, e.enrolled_at
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         JOIN student_profiles sp ON sp.user_id = u.id
         WHERE e.batch_id = $1 AND e.status = 'active'
         ORDER BY u.full_name`,
        [batchId]
      ),
      db.many(
        `SELECT bs.id, bs.day_of_week, bs.start_time, bs.end_time, bs.room,
                s.name AS subject_name, u.full_name AS teacher_name
         FROM batch_schedules bs
         LEFT JOIN subjects s ON s.id = bs.subject_id
         LEFT JOIN users u ON u.id = bs.teacher_id
         WHERE bs.batch_id = $1 ORDER BY bs.day_of_week, bs.start_time`,
        [batchId]
      )
    ]);

    return {
      batch: {
        id: batch.id,
        code: batch.code,
        name: batch.name,
        courseId: batch.course_id,
        startDate: batch.start_date,
        endDate: batch.end_date,
        status: batch.status,
        studentCount: students.length
      },
      subjects,
      students,
      schedule
    };
  }

  /* ---------------------------------------------------------------- lessons */
  async function listLessons(batchId, user, { page = 1, pageSize = 20, search, subjectId }) {
    await assertBatch(batchId, user);
    const params = [batchId];
    const where = ["l.batch_id = $1"];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(l.title ILIKE $${params.length} OR l.chapter ILIKE $${params.length})`);
    }
    if (subjectId) {
      params.push(subjectId);
      where.push(`l.subject_id = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM lessons l ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT l.id, l.title, l.description, l.chapter, l.youtube_video_id, l.duration_minutes,
              l.sort_order, l.status, l.published_at, l.subject_id, s.name AS subject_name
       FROM lessons l JOIN subjects s ON s.id = l.subject_id
       ${whereSql}
       ORDER BY l.sort_order, l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        chapter: row.chapter,
        youtubeVideoId: row.youtube_video_id,
        durationMinutes: row.duration_minutes,
        sortOrder: row.sort_order,
        status: row.status,
        publishedAt: row.published_at,
        subjectId: row.subject_id,
        subjectName: row.subject_name
      })),
      page,
      pageSize,
      total
    };
  }

  async function lessonRow(id) {
    const row = await db.one(
      `SELECT l.id, l.batch_id, l.title, l.description, l.chapter, l.youtube_video_id,
              l.duration_minutes, l.sort_order, l.status, l.published_at, l.subject_id, s.name AS subject_name
       FROM lessons l JOIN subjects s ON s.id = l.subject_id WHERE l.id = $1`,
      [id]
    );
    if (!row) throw notFound("Lecture not found");
    return row;
  }

  async function lessonById(id) {
    const row = await lessonRow(id);
    return {
      id: row.id,
      batchId: row.batch_id,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      title: row.title,
      description: row.description,
      chapter: row.chapter,
      youtubeVideoId: row.youtube_video_id,
      durationMinutes: row.duration_minutes,
      sortOrder: row.sort_order,
      status: row.status,
      publishedAt: row.published_at
    };
  }

  async function createLesson(batchId, payload, user, ip) {
    await assertBatch(batchId, user);
    await assertBatchSubject(batchId, payload.subjectId);

    const { rows } = await db.query(
      `INSERT INTO lessons (batch_id, subject_id, title, description, chapter, youtube_video_id,
                            duration_minutes, sort_order, status, published_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        batchId,
        payload.subjectId,
        payload.title,
        nullIfEmpty(payload.description),
        nullIfEmpty(payload.chapter),
        nullIfEmpty(payload.youtubeVideoId),
        payload.durationMinutes ?? null,
        payload.sortOrder ?? 0,
        payload.status ?? "published",
        (payload.status ?? "published") === "published" ? new Date() : null,
        user.id
      ]
    );
    const id = rows[0].id;
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "lesson.created",
      entityType: "lesson",
      entityId: id,
      metadata: { batchId, subjectId: payload.subjectId },
      ip
    });
    return lessonById(id);
  }

  async function updateLesson(id, payload, user, ip) {
    const lesson = await lessonRow(id);
    await assertBatch(lesson.batch_id, user);
    if (payload.subjectId) await assertBatchSubject(lesson.batch_id, payload.subjectId);

    const map = {
      title: "title",
      description: "description",
      chapter: "chapter",
      youtubeVideoId: "youtube_video_id",
      durationMinutes: "duration_minutes",
      sortOrder: "sort_order",
      status: "status",
      subjectId: "subject_id"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "description" || field === "chapter" || field === "youtubeVideoId" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if ("status" in payload && payload.status === "published") {
      sets.push(`published_at = COALESCE(published_at, now())`);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    await db.query(`UPDATE lessons SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "lesson.updated",
      entityType: "lesson",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return lessonById(id);
  }

  async function deleteLesson(id, user, ip) {
    const lesson = await lessonRow(id);
    await assertBatch(lesson.batch_id, user);
    await db.query("DELETE FROM lessons WHERE id = $1", [id]);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "lesson.deleted",
      entityType: "lesson",
      entityId: id,
      metadata: { batchId: lesson.batch_id },
      ip
    });
    return { id };
  }

  /* -------------------------------------------------------------- materials */
  async function listMaterials(batchId, user, { page = 1, pageSize = 20, search }) {
    await assertBatch(batchId, user);
    const params = [batchId];
    const where = ["m.batch_id = $1"];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(m.title ILIKE $${params.length} OR m.chapter ILIKE $${params.length})`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM study_materials m ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT m.id, m.title, m.description, m.chapter, m.kind, m.drive_url, m.status,
              m.created_at, m.subject_id, s.name AS subject_name
       FROM study_materials m JOIN subjects s ON s.id = m.subject_id
       ${whereSql}
       ORDER BY m.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        chapter: row.chapter,
        kind: row.kind,
        driveUrl: row.drive_url,
        status: row.status,
        createdAt: row.created_at,
        subjectId: row.subject_id,
        subjectName: row.subject_name
      })),
      page,
      pageSize,
      total
    };
  }

  async function materialRow(id) {
    const row = await db.one(
      `SELECT m.id, m.batch_id, m.title, m.description, m.chapter, m.kind, m.drive_url, m.status, m.subject_id
       FROM study_materials m WHERE m.id = $1`,
      [id]
    );
    if (!row) throw notFound("Material not found");
    return row;
  }

  async function materialById(id) {
    const row = await materialRow(id);
    return {
      id: row.id,
      batchId: row.batch_id,
      subjectId: row.subject_id,
      title: row.title,
      description: row.description,
      chapter: row.chapter,
      kind: row.kind,
      driveUrl: row.drive_url,
      status: row.status
    };
  }

  async function createMaterial(batchId, payload, user, ip) {
    await assertBatch(batchId, user);
    await assertBatchSubject(batchId, payload.subjectId);

    const { rows } = await db.query(
      `INSERT INTO study_materials (batch_id, subject_id, title, description, chapter, kind, drive_url, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        batchId,
        payload.subjectId,
        payload.title,
        nullIfEmpty(payload.description),
        nullIfEmpty(payload.chapter),
        payload.kind ?? "notes",
        payload.driveUrl,
        payload.status ?? "published",
        user.id
      ]
    );
    const id = rows[0].id;
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "material.created",
      entityType: "study_material",
      entityId: id,
      metadata: { batchId, kind: payload.kind ?? "notes" },
      ip
    });
    return materialById(id);
  }

  async function updateMaterial(id, payload, user, ip) {
    const material = await materialRow(id);
    await assertBatch(material.batch_id, user);
    if (payload.subjectId) await assertBatchSubject(material.batch_id, payload.subjectId);

    const map = {
      title: "title",
      description: "description",
      chapter: "chapter",
      kind: "kind",
      driveUrl: "drive_url",
      status: "status",
      subjectId: "subject_id"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "description" || field === "chapter" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    await db.query(
      `UPDATE study_materials SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "material.updated",
      entityType: "study_material",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return materialById(id);
  }

  async function deleteMaterial(id, user, ip) {
    const material = await materialRow(id);
    await assertBatch(material.batch_id, user);
    await db.query("DELETE FROM study_materials WHERE id = $1", [id]);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "material.deleted",
      entityType: "study_material",
      entityId: id,
      metadata: { batchId: material.batch_id },
      ip
    });
    return { id };
  }

  /* ------------------------------------------------------------ assignments */
  async function listAssignments(batchId, user, { page = 1, pageSize = 20 }) {
    await assertBatch(batchId, user);
    const total = (
      await db.one("SELECT count(*)::int AS count FROM assignments a WHERE a.batch_id = $1", [batchId])
    ).count;
    const rows = await db.many(
      `SELECT a.id, a.title, a.instructions, a.due_at, a.max_marks, a.status, a.created_at,
              a.subject_id, s.name AS subject_name,
              (SELECT count(*)::int FROM assignment_submissions sub WHERE sub.assignment_id = a.id) AS submission_count,
              (SELECT count(*)::int FROM assignment_submissions sub WHERE sub.assignment_id = a.id AND sub.status = 'evaluated') AS evaluated_count
       FROM assignments a JOIN subjects s ON s.id = a.subject_id
       WHERE a.batch_id = $1
       ORDER BY a.due_at DESC NULLS LAST, a.created_at DESC
       LIMIT $2 OFFSET $3`,
      [batchId, pageSize, (page - 1) * pageSize]
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        instructions: row.instructions,
        dueAt: row.due_at,
        maxMarks: row.max_marks,
        status: row.status,
        createdAt: row.created_at,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        submissionCount: Number(row.submission_count),
        evaluatedCount: Number(row.evaluated_count)
      })),
      page,
      pageSize,
      total
    };
  }

  async function assignmentRow(id) {
    const row = await db.one(
      `SELECT a.id, a.batch_id, a.title, a.instructions, a.due_at, a.max_marks, a.status, a.subject_id
       FROM assignments a WHERE a.id = $1`,
      [id]
    );
    if (!row) throw notFound("Assignment not found");
    return row;
  }

  async function assignmentById(id) {
    const row = await assignmentRow(id);
    return {
      id: row.id,
      batchId: row.batch_id,
      subjectId: row.subject_id,
      title: row.title,
      instructions: row.instructions,
      dueAt: row.due_at,
      maxMarks: row.max_marks,
      status: row.status
    };
  }

  async function createAssignment(batchId, payload, user, ip) {
    await assertBatch(batchId, user);
    await assertBatchSubject(batchId, payload.subjectId);

    const { rows } = await db.query(
      `INSERT INTO assignments (batch_id, subject_id, title, instructions, due_at, max_marks, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        batchId,
        payload.subjectId,
        payload.title,
        nullIfEmpty(payload.instructions),
        nullIfEmpty(payload.dueAt),
        payload.maxMarks ?? 10,
        payload.status ?? "published",
        user.id
      ]
    );
    const id = rows[0].id;
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "assignment.created",
      entityType: "assignment",
      entityId: id,
      metadata: { batchId },
      ip
    });
    return assignmentById(id);
  }

  async function updateAssignment(id, payload, user, ip) {
    const assignment = await assignmentRow(id);
    await assertBatch(assignment.batch_id, user);
    if (payload.subjectId) await assertBatchSubject(assignment.batch_id, payload.subjectId);

    const map = {
      title: "title",
      instructions: "instructions",
      dueAt: "due_at",
      maxMarks: "max_marks",
      status: "status",
      subjectId: "subject_id"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(field === "instructions" || field === "dueAt" ? nullIfEmpty(payload[field]) : payload[field]);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    await db.query(`UPDATE assignments SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "assignment.updated",
      entityType: "assignment",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return assignmentById(id);
  }

  async function deleteAssignment(id, user, ip) {
    const assignment = await assignmentRow(id);
    await assertBatch(assignment.batch_id, user);
    await db.query("DELETE FROM assignments WHERE id = $1", [id]);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "assignment.deleted",
      entityType: "assignment",
      entityId: id,
      metadata: { batchId: assignment.batch_id },
      ip
    });
    return { id };
  }

  async function getAssignment(id, user) {
    const assignment = await assignmentRow(id);
    await assertBatch(assignment.batch_id, user);

    const [subject, submissions] = await Promise.all([
      db.one("SELECT name FROM subjects WHERE id = $1", [assignment.subject_id]),
      db.many(
        `SELECT sub.id, sub.status, sub.marks_awarded, sub.feedback, sub.submitted_at, sub.evaluated_at,
                u.id AS student_id, u.full_name, sp.enrollment_no
         FROM assignment_submissions sub
         JOIN users u ON u.id = sub.student_id
         JOIN student_profiles sp ON sp.user_id = u.id
         WHERE sub.assignment_id = $1
         ORDER BY u.full_name`,
        [id]
      )
    ]);

    return {
      assignment: {
        id: assignment.id,
        batchId: assignment.batch_id,
        title: assignment.title,
        instructions: assignment.instructions,
        dueAt: assignment.due_at,
        maxMarks: assignment.max_marks,
        status: assignment.status,
        subjectId: assignment.subject_id,
        subjectName: subject?.name ?? null
      },
      submissions: submissions.map((row) => ({
        id: row.id,
        status: row.status,
        marksAwarded: row.marks_awarded === null ? null : Number(row.marks_awarded),
        feedback: row.feedback,
        submittedAt: row.submitted_at,
        evaluatedAt: row.evaluated_at,
        studentId: row.student_id,
        fullName: row.full_name,
        enrollmentNo: row.enrollment_no
      }))
    };
  }

  async function evaluateSubmission(submissionId, payload, user, ip) {
    const submission = await db.one(
      `SELECT sub.id, sub.assignment_id, a.batch_id, a.max_marks
       FROM assignment_submissions sub JOIN assignments a ON a.id = sub.assignment_id
       WHERE sub.id = $1`,
      [submissionId]
    );
    if (!submission) throw notFound("Submission not found");
    await assertBatch(submission.batch_id, user);
    if (Number(payload.marksAwarded) > Number(submission.max_marks)) {
      throw badRequest(`Marks cannot exceed ${submission.max_marks}`);
    }

    await db.query(
      `UPDATE assignment_submissions
       SET marks_awarded = $2, feedback = $3, status = $4, evaluated_by = $5, evaluated_at = now()
       WHERE id = $1`,
      [
        submissionId,
        payload.marksAwarded,
        nullIfEmpty(payload.feedback),
        payload.status ?? "evaluated",
        user.id
      ]
    );
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "submission.evaluated",
      entityType: "assignment_submission",
      entityId: submissionId,
      metadata: { assignmentId: submission.assignment_id, marks: payload.marksAwarded },
      ip
    });
    return { id: submissionId };
  }

  /* ------------------------------------------------------------- attendance */
  async function getAttendance(batchId, date, user) {
    await assertBatch(batchId, user);
    const rows = await db.many(
      `SELECT u.id AS student_id, u.full_name, sp.enrollment_no, a.status, a.notes
       FROM enrollments e
       JOIN users u ON u.id = e.student_id
       JOIN student_profiles sp ON sp.user_id = u.id
       LEFT JOIN attendance a
         ON a.student_id = e.student_id AND a.batch_id = e.batch_id AND a.session_date = $2
       WHERE e.batch_id = $1 AND e.status = 'active'
       ORDER BY u.full_name`,
      [batchId, date]
    );

    return {
      date,
      students: rows.map((row) => ({
        studentId: row.student_id,
        fullName: row.full_name,
        enrollmentNo: row.enrollment_no,
        status: row.status,
        notes: row.notes,
        marked: row.status !== null
      })),
      markedCount: rows.filter((row) => row.status !== null).length,
      total: rows.length
    };
  }

  async function saveAttendance(batchId, date, records, user, ip) {
    await assertBatch(batchId, user);

    const enrolled = await db.many(
      "SELECT student_id FROM enrollments WHERE batch_id = $1 AND status = 'active'",
      [batchId]
    );
    const allowed = new Set(enrolled.map((row) => row.student_id));
    const invalid = records.filter((record) => !allowed.has(record.studentId));
    if (invalid.length > 0) throw badRequest("Some students are not enrolled in this batch");

    await db.transaction(async (tx) => {
      for (const record of records) {
        await tx.query(
          `INSERT INTO attendance (batch_id, student_id, session_date, status, notes, marked_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (student_id, batch_id, session_date)
           DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                         marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [batchId, record.studentId, date, record.status, nullIfEmpty(record.notes), user.id]
        );
      }
    });

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "attendance.saved",
      entityType: "batch",
      entityId: batchId,
      metadata: { date, count: records.length },
      ip
    });

    return getAttendance(batchId, date, user);
  }

  return {
    listBatches,
    getBatch,
    listLessons,
    createLesson,
    updateLesson,
    deleteLesson,
    listMaterials,
    createMaterial,
    updateMaterial,
    deleteMaterial,
    listAssignments,
    getAssignment,
    createAssignment,
    updateAssignment,
    deleteAssignment,
    evaluateSubmission,
    getAttendance,
    saveAttendance
  };
}
