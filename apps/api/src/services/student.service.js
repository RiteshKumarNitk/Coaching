import { badRequest, notFound } from "../utils/AppError.js";

const num = (value) => Number(value ?? 0);

/**
 * Phase 4 student app. Every query is scoped to an active enrolment of the
 * signed-in student (`enrollments.student_id = $1`), never to a client id.
 * Only published content is visible.
 */
export function createStudentService(db, audit) {
  async function assertLessonAccess(studentId, lessonId) {
    const row = await db.one(
      `SELECT l.id, l.batch_id, l.subject_id, l.title, l.description, l.chapter,
              l.youtube_video_id, l.duration_minutes, l.sort_order, l.status, l.published_at,
              s.name AS subject_name
       FROM lessons l
       JOIN subjects s ON s.id = l.subject_id
       WHERE l.id = $1 AND l.status = 'published'
         AND EXISTS (
           SELECT 1 FROM enrollments e
           WHERE e.student_id = $2 AND e.batch_id = l.batch_id AND e.status = 'active'
         )`,
      [lessonId, studentId]
    );
    if (!row) throw notFound("Lecture not found");
    return row;
  }

  async function listCourses(studentId) {
    const rows = await db.many(
      `SELECT e.id AS enrollment_id, e.enrolled_at,
              c.id AS course_id, c.name AS course_name, c.code AS course_code,
              b.id AS batch_id, b.name AS batch_name, b.code AS batch_code,
              b.start_date, b.end_date,
              (SELECT count(*)::int FROM lessons l WHERE l.batch_id = b.id AND l.status = 'published') AS lesson_count,
              (SELECT count(*)::int FROM lessons l
                 JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = $1
               WHERE l.batch_id = b.id AND l.status = 'published' AND lp.completed_at IS NOT NULL) AS completed_count,
              (SELECT count(*)::int FROM study_materials m WHERE m.batch_id = b.id AND m.status = 'published') AS material_count,
              (SELECT count(*)::int FROM assignments a WHERE a.batch_id = b.id AND a.status = 'published') AS assignment_count
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN batches b ON b.id = e.batch_id
       WHERE e.student_id = $1 AND e.status = 'active'
       ORDER BY e.enrolled_at DESC`,
      [studentId]
    );

    const subjects = await db.many(
      `SELECT bs.batch_id, s.id, s.code, s.name
       FROM batch_subjects bs
       JOIN subjects s ON s.id = bs.subject_id
       WHERE bs.batch_id IN (SELECT batch_id FROM enrollments WHERE student_id = $1 AND status = 'active')
       ORDER BY s.name`,
      [studentId]
    );

    return rows.map((row) => ({
      enrollmentId: row.enrollment_id,
      enrolledAt: row.enrolled_at,
      courseId: row.course_id,
      courseName: row.course_name,
      courseCode: row.course_code,
      batchId: row.batch_id,
      batchName: row.batch_name,
      batchCode: row.batch_code,
      startDate: row.start_date,
      endDate: row.end_date,
      lessonCount: num(row.lesson_count),
      completedCount: num(row.completed_count),
      materialCount: num(row.material_count),
      assignmentCount: num(row.assignment_count),
      subjects: subjects
        .filter((subject) => subject.batch_id === row.batch_id)
        .map((subject) => ({ id: subject.id, code: subject.code, name: subject.name }))
    }));
  }

  async function getBatch(studentId, batchId) {
    const batch = await db.one(
      `SELECT b.id, b.code, b.name, b.start_date, b.end_date, b.status,
              c.name AS course_name, c.code AS course_code
       FROM batches b
       JOIN courses c ON c.id = b.course_id
       JOIN enrollments e ON e.batch_id = b.id
       WHERE b.id = $1 AND e.student_id = $2 AND e.status = 'active'`,
      [batchId, studentId]
    );
    if (!batch) throw notFound("Batch not found");

    const [subjects, schedule, teachers] = await Promise.all([
      db.many(
        `SELECT s.id, s.code, s.name,
                (SELECT count(*)::int FROM lessons l
                 WHERE l.batch_id = $1 AND l.subject_id = s.id AND l.status = 'published') AS lesson_count
         FROM batch_subjects bs JOIN subjects s ON s.id = bs.subject_id
         WHERE bs.batch_id = $1 ORDER BY s.name`,
        [batchId]
      ),
      db.many(
        `SELECT bs.id, bs.day_of_week, bs.start_time, bs.end_time, bs.room, s.name AS subject_name
         FROM batch_schedules bs
         LEFT JOIN subjects s ON s.id = bs.subject_id
         WHERE bs.batch_id = $1 ORDER BY bs.day_of_week, bs.start_time`,
        [batchId]
      ),
      db.many(
        `SELECT DISTINCT u.full_name, s.name AS subject_name
         FROM batch_teachers bt
         JOIN users u ON u.id = bt.teacher_id
         LEFT JOIN subjects s ON s.id = bt.subject_id
         WHERE bt.batch_id = $1 ORDER BY s.name NULLS LAST, u.full_name`,
        [batchId]
      )
    ]);

    return {
      batch: {
        id: batch.id,
        name: batch.name,
        code: batch.code,
        courseName: batch.course_name,
        courseCode: batch.course_code,
        startDate: batch.start_date,
        endDate: batch.end_date,
        status: batch.status
      },
      subjects: subjects.map((subject) => ({
        id: subject.id,
        code: subject.code,
        name: subject.name,
        lessonCount: num(subject.lesson_count)
      })),
      schedule,
      teachers
    };
  }

  async function listLessons(studentId, { page = 1, pageSize = 20, subjectId, batchId, search } = {}) {
    const params = [studentId];
    const where = [
      "l.status = 'published'",
      `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = $1 AND e.batch_id = l.batch_id AND e.status = 'active')`
    ];
    if (subjectId) {
      params.push(subjectId);
      where.push(`l.subject_id = $${params.length}`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(`l.batch_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(l.title ILIKE $${params.length} OR l.chapter ILIKE $${params.length})`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM lessons l ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT l.id, l.batch_id, l.subject_id, l.title, l.chapter, l.duration_minutes,
              l.youtube_video_id, l.sort_order, l.published_at,
              s.name AS subject_name, b.name AS batch_name,
              lp.last_position_seconds, lp.completed_at
       FROM lessons l
       JOIN subjects s ON s.id = l.subject_id
       JOIN batches b ON b.id = l.batch_id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = $1
       ${whereSql}
       ORDER BY l.sort_order, l.published_at DESC NULLS LAST, l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        batchId: row.batch_id,
        batchName: row.batch_name,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        title: row.title,
        chapter: row.chapter,
        durationMinutes: row.duration_minutes,
        youtubeVideoId: row.youtube_video_id,
        sortOrder: row.sort_order,
        publishedAt: row.published_at,
        lastPositionSeconds: num(row.last_position_seconds),
        progressPercent:
          row.duration_minutes && row.last_position_seconds
            ? Math.min(100, Math.round((num(row.last_position_seconds) / (num(row.duration_minutes) * 60)) * 100))
            : row.completed_at
              ? 100
              : 0,
        completed: Boolean(row.completed_at)
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function getLesson(studentId, lessonId) {
    const lesson = await assertLessonAccess(studentId, lessonId);

    const [progress, materials, siblings] = await Promise.all([
      db.one("SELECT last_position_seconds, completed_at, updated_at FROM lesson_progress WHERE student_id = $1 AND lesson_id = $2", [
        studentId,
        lessonId
      ]),
      db.many(
        `SELECT id, title, chapter, kind, drive_url
         FROM study_materials
         WHERE batch_id = $1 AND subject_id = $2 AND status = 'published'
         ORDER BY created_at DESC`,
        [lesson.batch_id, lesson.subject_id]
      ),
      db.many(
        `SELECT id FROM (
           SELECT l.id, row_number() OVER (ORDER BY l.sort_order, l.created_at) AS position
           FROM lessons l
           WHERE l.batch_id = $1 AND l.subject_id = $2 AND l.status = 'published'
         ) ordered`,
        [lesson.batch_id, lesson.subject_id]
      )
    ]);

    const index = siblings.findIndex((row) => row.id === lessonId);
    return {
      lesson: {
        id: lesson.id,
        batchId: lesson.batch_id,
        subjectId: lesson.subject_id,
        subjectName: lesson.subject_name,
        title: lesson.title,
        description: lesson.description,
        chapter: lesson.chapter,
        youtubeVideoId: lesson.youtube_video_id,
        durationMinutes: lesson.duration_minutes,
        publishedAt: lesson.published_at
      },
      progress: {
        lastPositionSeconds: num(progress?.last_position_seconds),
        completed: Boolean(progress?.completed_at),
        completedAt: progress?.completed_at ?? null,
        updatedAt: progress?.updated_at ?? null
      },
      materials: materials.map((row) => ({
        id: row.id,
        title: row.title,
        chapter: row.chapter,
        kind: row.kind,
        driveUrl: row.drive_url
      })),
      previousLessonId: index > 0 ? siblings[index - 1].id : null,
      nextLessonId: index >= 0 && index < siblings.length - 1 ? siblings[index + 1].id : null
    };
  }

  async function saveProgress(studentId, lessonId, { positionSeconds = 0, completed = false }, ip, user) {
    const lesson = await assertLessonAccess(studentId, lessonId);
    const position = Math.max(0, Math.min(86400, Math.round(Number(positionSeconds) || 0)));

    const saved = await db.one(
      `INSERT INTO lesson_progress (student_id, lesson_id, last_position_seconds, completed_at)
       VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() ELSE NULL END)
       ON CONFLICT (student_id, lesson_id)
       DO UPDATE SET last_position_seconds = EXCLUDED.last_position_seconds,
                     completed_at = COALESCE(lesson_progress.completed_at, EXCLUDED.completed_at),
                     updated_at = now()
       RETURNING last_position_seconds, completed_at, updated_at`,
      [studentId, lessonId, position, Boolean(completed)]
    );

    await audit.record({
      actorId: studentId,
      actorEmail: user.email,
      action: "lesson.progress",
      entityType: "lesson",
      entityId: lessonId,
      metadata: { batchId: lesson.batch_id, positionSeconds: position, completed: Boolean(completed) },
      ip
    });

    return {
      lessonId,
      lastPositionSeconds: num(saved.last_position_seconds),
      completed: Boolean(saved.completed_at),
      completedAt: saved.completed_at,
      updatedAt: saved.updated_at
    };
  }

  async function listMaterials(studentId, { page = 1, pageSize = 20, subjectId, batchId } = {}) {
    const params = [studentId];
    const where = [
      "m.status = 'published'",
      `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = $1 AND e.batch_id = m.batch_id AND e.status = 'active')`
    ];
    if (subjectId) {
      params.push(subjectId);
      where.push(`m.subject_id = $${params.length}`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(`m.batch_id = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM study_materials m ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT m.id, m.batch_id, m.subject_id, m.title, m.description, m.chapter, m.kind,
              m.drive_url, m.created_at, s.name AS subject_name, b.name AS batch_name
       FROM study_materials m
       JOIN subjects s ON s.id = m.subject_id
       JOIN batches b ON b.id = m.batch_id
       ${whereSql}
       ORDER BY m.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        batchId: row.batch_id,
        batchName: row.batch_name,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        title: row.title,
        description: row.description,
        chapter: row.chapter,
        kind: row.kind,
        driveUrl: row.drive_url,
        createdAt: row.created_at
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function listAssignments(studentId, { page = 1, pageSize = 20, batchId } = {}) {
    const params = [studentId];
    const where = [
      "a.status IN ('published', 'closed')",
      `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = $1 AND e.batch_id = a.batch_id AND e.status = 'active')`
    ];
    if (batchId) {
      params.push(batchId);
      where.push(`a.batch_id = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const total = (await db.one(`SELECT count(*)::int AS count FROM assignments a ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT a.id, a.batch_id, a.subject_id, a.title, a.instructions, a.due_at, a.max_marks, a.status,
              s.name AS subject_name, b.name AS batch_name,
              sub.id AS submission_id, sub.status AS submission_status, sub.marks_awarded,
              sub.submitted_at, sub.feedback
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       JOIN batches b ON b.id = a.batch_id
       LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = $1
       ${whereSql}
       ORDER BY a.due_at DESC NULLS LAST, a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        batchId: row.batch_id,
        batchName: row.batch_name,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        title: row.title,
        instructions: row.instructions,
        dueAt: row.due_at,
        maxMarks: row.max_marks,
        status: row.status,
        submission: row.submission_id
          ? {
              id: row.submission_id,
              status: row.submission_status,
              marksAwarded: row.marks_awarded === null ? null : num(row.marks_awarded),
              feedback: row.feedback,
              submittedAt: row.submitted_at
            }
          : null
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function assignmentForStudent(studentId, assignmentId) {
    const row = await db.one(
      `SELECT a.id, a.batch_id, a.subject_id, a.title, a.instructions, a.due_at, a.max_marks, a.status,
              s.name AS subject_name, b.name AS batch_name
       FROM assignments a
       JOIN subjects s ON s.id = a.subject_id
       JOIN batches b ON b.id = a.batch_id
       WHERE a.id = $1 AND a.status IN ('published', 'closed')
         AND EXISTS (SELECT 1 FROM enrollments e
                     WHERE e.student_id = $2 AND e.batch_id = a.batch_id AND e.status = 'active')`,
      [assignmentId, studentId]
    );
    if (!row) throw notFound("Assignment not found");
    return row;
  }

  async function getAssignment(studentId, assignmentId) {
    const assignment = await assignmentForStudent(studentId, assignmentId);
    const submission = await db.one(
      `SELECT id, status, content_text, file_url, marks_awarded, feedback, submitted_at, evaluated_at
       FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2`,
      [assignmentId, studentId]
    );

    return {
      assignment: {
        id: assignment.id,
        batchId: assignment.batch_id,
        batchName: assignment.batch_name,
        subjectId: assignment.subject_id,
        subjectName: assignment.subject_name,
        title: assignment.title,
        instructions: assignment.instructions,
        dueAt: assignment.due_at,
        maxMarks: assignment.max_marks,
        status: assignment.status
      },
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            contentText: submission.content_text,
            fileUrl: submission.file_url,
            marksAwarded: submission.marks_awarded === null ? null : num(submission.marks_awarded),
            feedback: submission.feedback,
            submittedAt: submission.submitted_at,
            evaluatedAt: submission.evaluated_at
          }
        : null
    };
  }

  async function submitAssignment(studentId, assignmentId, { contentText, fileUrl }, ip, user) {
    const assignment = await assignmentForStudent(studentId, assignmentId);
    if (assignment.status !== "published") throw badRequest("This assignment is closed for submissions");
    if (!contentText && !fileUrl) throw badRequest("Add your answer or a link to your work");

    const existing = await db.one(
      "SELECT status FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2",
      [assignmentId, studentId]
    );
    if (existing?.status === "evaluated") throw badRequest("This submission has already been evaluated");

    const late = assignment.due_at ? new Date(assignment.due_at).getTime() < Date.now() : false;
    const status = late ? "late" : "submitted";

    const saved = await db.one(
      `INSERT INTO assignment_submissions (assignment_id, student_id, content_text, file_url, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (assignment_id, student_id)
       DO UPDATE SET content_text = EXCLUDED.content_text, file_url = EXCLUDED.file_url,
                     status = EXCLUDED.status, submitted_at = now(),
                     marks_awarded = NULL, feedback = NULL, evaluated_by = NULL, evaluated_at = NULL
       RETURNING id, status, submitted_at`,
      [assignmentId, studentId, contentText || null, fileUrl || null, status]
    );

    await audit.record({
      actorId: studentId,
      actorEmail: user.email,
      action: "submission.submitted",
      entityType: "assignment_submission",
      entityId: saved.id,
      metadata: { assignmentId, late },
      ip
    });

    return { id: saved.id, status: saved.status, submittedAt: saved.submitted_at, late };
  }

  async function attendanceHistory(studentId, { page = 1, pageSize = 20, batchId, status } = {}) {
    const params = [studentId];
    const where = ["a.student_id = $1"];
    if (batchId) {
      params.push(batchId);
      where.push(`a.batch_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [total, rows, summary, monthly] = await Promise.all([
      db.one(`SELECT count(*)::int AS count FROM attendance a ${whereSql}`, params),
      db.many(
        `SELECT a.id, a.session_date, a.status, a.notes, b.name AS batch_name
         FROM attendance a JOIN batches b ON b.id = a.batch_id
         ${whereSql}
         ORDER BY a.session_date DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize]
      ),
      db.one(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
                count(*) FILTER (WHERE status = 'absent')::int AS absent,
                count(*) FILTER (WHERE status = 'late')::int AS late
         FROM attendance WHERE student_id = $1`,
        [studentId]
      ),
      db.one(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present
         FROM attendance
         WHERE student_id = $1 AND session_date >= date_trunc('month', CURRENT_DATE)`,
        [studentId]
      )
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        sessionDate: row.session_date,
        status: row.status,
        notes: row.notes,
        batchName: row.batch_name
      })),
      page,
      pageSize,
      total: num(total.count),
      summary: {
        total: num(summary.total),
        present: num(summary.present),
        absent: num(summary.absent),
        late: num(summary.late),
        percentage: num(summary.total) === 0 ? null : Math.round((num(summary.present) / num(summary.total)) * 100),
        thisMonth: {
          total: num(monthly.total),
          present: num(monthly.present),
          percentage: num(monthly.total) === 0 ? null : Math.round((num(monthly.present) / num(monthly.total)) * 100)
        }
      }
    };
  }

  async function listAnnouncements(studentId, { page = 1, pageSize = 20 } = {}) {
    const enrollment = await db.one(
      `SELECT course_id, batch_id FROM enrollments
       WHERE student_id = $1 AND status = 'active'
       ORDER BY enrolled_at DESC LIMIT 1`,
      [studentId]
    );

    const where = [
      "a.published_at IS NOT NULL",
      "(a.expires_at IS NULL OR a.expires_at > now())",
      `(a.audience = 'all'
        OR (a.audience = 'role' AND a.role_code = 'student')
        OR (a.audience = 'course' AND a.course_id = $1::uuid)
        OR (a.audience = 'batch' AND a.batch_id = $2::uuid))`
    ];
    const params = [enrollment?.course_id ?? null, enrollment?.batch_id ?? null];

    const total = (await db.one(`SELECT count(*)::int AS count FROM announcements a WHERE ${where.join(" AND ")}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT a.id, a.title, a.body, a.is_pinned, a.published_at, u.full_name AS author_name
       FROM announcements a
       LEFT JOIN users u ON u.id = a.created_by
       WHERE ${where.join(" AND ")}
       ORDER BY a.is_pinned DESC, a.published_at DESC
       LIMIT $3 OFFSET $4`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        isPinned: row.is_pinned,
        publishedAt: row.published_at,
        authorName: row.author_name
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  return {
    listCourses,
    getBatch,
    listLessons,
    getLesson,
    saveProgress,
    listMaterials,
    listAssignments,
    getAssignment,
    submitAssignment,
    attendanceHistory,
    listAnnouncements
  };
}
