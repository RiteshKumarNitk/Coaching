import { badRequest, notFound } from "../utils/AppError.js";
import { gradeAttempt } from "./exams.grading.js";

const num = (value) => Number(value ?? 0);

/**
 * Phase 4 student app. Every query is scoped to an active enrolment of the
 * signed-in student (`enrollments.student_id = $1`), never to a client id.
 * Only published content is visible.
 */
export function createStudentService(db, audit) {
  /**
   * An attempt stops counting only when someone reads it, so a student who closes the
   * tab would leave it open forever. Sweep before listing/starting: expire it and grade
   * the answers it already holds.
   */
  async function expireStaleAttempts(studentId) {
    const rows = await db.many(
      `UPDATE exam_attempts SET status = 'expired'
       WHERE student_id = $1 AND status = 'in_progress' AND expires_at < now()
       RETURNING id`,
      [studentId]
    );
    for (const row of rows) await gradeAttempt(db, row.id);
    return rows.length;
  }

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

  async function listMaterials(studentId, { page = 1, pageSize = 20, subjectId, batchId, search } = {}) {
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
    if (search) {
      params.push(`%${search}%`);
      where.push(`(m.title ILIKE $${params.length} OR m.chapter ILIKE $${params.length})`);
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

  /* --------------------------------------------------------------- exams */
  const examSelect = `SELECT e.id, e.title, e.description, e.instructions, e.exam_type, e.status,
         e.starts_at, e.ends_at, e.duration_minutes, e.total_marks, e.pass_marks, e.max_attempts,
         e.results_published, b.name AS batch_name, s.name AS subject_name,
         (SELECT count(*)::int FROM exam_attempts a WHERE a.exam_id = e.id AND a.student_id = $1) AS my_attempts,
         (SELECT a.id FROM exam_attempts a WHERE a.exam_id = e.id AND a.student_id = $1 AND a.status = 'in_progress'
           ORDER BY a.started_at DESC LIMIT 1) AS active_attempt_id,
         r.obtained_marks, r.total_marks AS result_total, r.percentage, r.status AS result_status, r.published_at
  FROM exams e
  JOIN batches b ON b.id = e.batch_id
  LEFT JOIN subjects s ON s.id = e.subject_id
  LEFT JOIN LATERAL (
    SELECT er.obtained_marks, er.total_marks, er.percentage, er.status, er.published_at
    FROM exam_results er WHERE er.exam_id = e.id AND er.student_id = $1 LIMIT 1
  ) r ON true`;

  async function listExams(studentId, { page = 1, pageSize = 20 } = {}) {
    await expireStaleAttempts(studentId);
    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM exams e
         WHERE e.status IN ('scheduled', 'published', 'closed')
           AND EXISTS (SELECT 1 FROM enrollments en WHERE en.student_id = $1 AND en.batch_id = e.batch_id AND en.status = 'active')`,
        [studentId]
      )
    ).count;

    const rows = await db.many(
      `${examSelect}
       WHERE e.status IN ('scheduled', 'published', 'closed')
         AND EXISTS (SELECT 1 FROM enrollments en WHERE en.student_id = $1 AND en.batch_id = e.batch_id AND en.status = 'active')
       ORDER BY e.starts_at DESC
       LIMIT $2 OFFSET $3`,
      [studentId, pageSize, (page - 1) * pageSize]
    );

    const now = Date.now();
    return {
      items: rows.map((row) => {
        const attempts = num(row.my_attempts);
        const withinWindow =
          row.status === "published" &&
          new Date(row.starts_at).getTime() <= now &&
          new Date(row.ends_at).getTime() >= now;
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          instructions: row.instructions,
          examType: row.exam_type,
          status: row.status,
          batchName: row.batch_name,
          subjectName: row.subject_name,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          durationMinutes: row.duration_minutes,
          totalMarks: num(row.total_marks),
          passMarks: num(row.pass_marks),
          maxAttempts: row.max_attempts,
          myAttempts: attempts,
          activeAttemptId: row.active_attempt_id,
          canStart: withinWindow && !row.active_attempt_id && attempts < row.max_attempts,
          resultsPublished: row.results_published,
          result:
            row.results_published && row.published_at
              ? {
                  obtainedMarks: num(row.obtained_marks),
                  totalMarks: num(row.result_total),
                  percentage: num(row.percentage),
                  status: row.result_status,
                  publishedAt: row.published_at
                }
              : null
        };
      }),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function examForStudent(studentId, examId) {
    const row = await db.one(
      `${examSelect}
       WHERE e.id = $2 AND e.status IN ('scheduled', 'published', 'closed')
         AND EXISTS (SELECT 1 FROM enrollments en WHERE en.student_id = $1 AND en.batch_id = e.batch_id AND en.status = 'active')`,
      [studentId, examId]
    );
    if (!row) throw notFound("Exam not found");
    return row;
  }

  async function startAttempt(studentId, examId, user, ip) {
    await expireStaleAttempts(studentId);
    const exam = await examForStudent(studentId, examId);
    if (exam.status !== "published") throw badRequest("This exam is not open yet");
    const now = Date.now();
    if (new Date(exam.starts_at).getTime() > now) throw badRequest("This exam has not started yet");
    if (new Date(exam.ends_at).getTime() < now) throw badRequest("This exam has closed");

    if (exam.active_attempt_id) return getAttempt(studentId, exam.active_attempt_id);
    if (num(exam.my_attempts) >= exam.max_attempts) throw badRequest("You have used all attempts for this exam");

    const attempt = await db.one(
      `INSERT INTO exam_attempts (exam_id, student_id, attempt_no, expires_at)
       VALUES ($1, $2, $3, LEAST(now() + make_interval(mins => $4::int), $5::timestamptz))
       RETURNING id`,
      [examId, studentId, num(exam.my_attempts) + 1, exam.duration_minutes, exam.ends_at]
    );

    await audit.record({
      actorId: studentId,
      actorEmail: user.email,
      action: "exam.attempt_started",
      entityType: "exam_attempt",
      entityId: attempt.id,
      metadata: { examId },
      ip
    });
    return getAttempt(studentId, attempt.id);
  }

  async function getAttempt(studentId, attemptId) {
    const attempt = await db.one(
      `SELECT a.id, a.exam_id, a.attempt_no, a.started_at, a.expires_at, a.submitted_at, a.status, a.score
       FROM exam_attempts a WHERE a.id = $1 AND a.student_id = $2`,
      [attemptId, studentId]
    );
    if (!attempt) throw notFound("Attempt not found");

    if (attempt.status === "in_progress" && new Date(attempt.expires_at).getTime() < Date.now()) {
      await db.query("UPDATE exam_attempts SET status = 'expired' WHERE id = $1", [attemptId]);
      attempt.status = "expired";
    }

    const exam = await db.one(
      `SELECT id, title, instructions, duration_minutes, total_marks, pass_marks, shuffle_questions, ends_at
       FROM exams WHERE id = $1`,
      [attempt.exam_id]
    );
    const shuffle = Boolean(exam.shuffle_questions);
    const questions = await db.many(
      `SELECT q.id, q.question_type, q.question_text, q.marks, q.negative_marks, q.sort_order
       FROM exam_questions q
       WHERE q.exam_id = $1
       ORDER BY ${shuffle ? "md5($2::text || q.id::text)" : "q.sort_order, q.created_at"}`,
      shuffle ? [attempt.exam_id, attemptId] : [attempt.exam_id]
    );
    const options = await db.many(
      `SELECT o.id, o.question_id, o.option_text, o.sort_order
       FROM exam_options o JOIN exam_questions q ON q.id = o.question_id
       WHERE q.exam_id = $1 ORDER BY o.sort_order`,
      [attempt.exam_id]
    );
    const responses = await db.many(
      `SELECT question_id, selected_option_id, answer_text, is_marked_for_review, awarded_marks
       FROM exam_responses WHERE attempt_id = $1`,
      [attemptId]
    );

    return {
      attempt: {
        id: attempt.id,
        examId: attempt.exam_id,
        attemptNo: attempt.attempt_no,
        status: attempt.status,
        startedAt: attempt.started_at,
        expiresAt: attempt.expires_at,
        submittedAt: attempt.submitted_at,
        score: attempt.score === null ? null : num(attempt.score),
        remainingSeconds:
          attempt.status === "in_progress"
            ? Math.max(0, Math.floor((new Date(attempt.expires_at).getTime() - Date.now()) / 1000))
            : 0
      },
      exam: {
        id: exam.id,
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.duration_minutes,
        totalMarks: num(exam.total_marks),
        passMarks: num(exam.pass_marks)
      },
      questions: questions.map((question) => ({
        id: question.id,
        questionType: question.question_type,
        questionText: question.question_text,
        marks: num(question.marks),
        negativeMarks: num(question.negative_marks),
        options: options
          .filter((option) => option.question_id === question.id)
          .map((option) => ({ id: option.id, text: option.option_text }))
      })),
      responses: responses.map((row) => ({
        questionId: row.question_id,
        selectedOptionId: row.selected_option_id,
        answerText: row.answer_text,
        markedForReview: row.is_marked_for_review
      }))
    };
  }

  async function saveAttemptAnswers(studentId, attemptId, answers, user, ip) {
    const attempt = await db.one(
      "SELECT id, exam_id, status, expires_at FROM exam_attempts WHERE id = $1 AND student_id = $2",
      [attemptId, studentId]
    );
    if (!attempt) throw notFound("Attempt not found");
    if (attempt.status !== "in_progress") throw badRequest("This attempt is no longer open");
    if (new Date(attempt.expires_at).getTime() < Date.now()) throw badRequest("Time is up for this attempt");

    const questions = await db.many("SELECT id FROM exam_questions WHERE exam_id = $1", [attempt.exam_id]);
    const questionIds = new Set(questions.map((row) => row.id));
    const options = await db.many(
      `SELECT o.id, o.question_id FROM exam_options o
       JOIN exam_questions q ON q.id = o.question_id WHERE q.exam_id = $1`,
      [attempt.exam_id]
    );
    const optionsByQuestion = new Map();
    for (const option of options) {
      if (!optionsByQuestion.has(option.question_id)) optionsByQuestion.set(option.question_id, new Set());
      optionsByQuestion.get(option.question_id).add(option.id);
    }

    for (const answer of answers) {
      if (!questionIds.has(answer.questionId)) throw badRequest("A saved answer does not belong to this exam");
      if (answer.selectedOptionId) {
        const allowed = optionsByQuestion.get(answer.questionId);
        if (!allowed || !allowed.has(answer.selectedOptionId)) throw badRequest("That option does not belong to the question");
      }
    }

    await db.transaction(async (tx) => {
      for (const answer of answers) {
        await tx.query(
          `INSERT INTO exam_responses (attempt_id, question_id, selected_option_id, answer_text, is_marked_for_review)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET
             selected_option_id = EXCLUDED.selected_option_id,
             answer_text = EXCLUDED.answer_text,
             is_marked_for_review = EXCLUDED.is_marked_for_review,
             updated_at = now()`,
          [
            attemptId,
            answer.questionId,
            answer.selectedOptionId ?? null,
            answer.answerText || null,
            Boolean(answer.markedForReview)
          ]
        );
      }
    });

    await audit.record({
      actorId: studentId,
      actorEmail: user.email,
      action: "exam.answers_saved",
      entityType: "exam_attempt",
      entityId: attemptId,
      metadata: { examId: attempt.exam_id, count: answers.length },
      ip
    });

    return { attemptId, saved: answers.length, savedAt: new Date().toISOString() };
  }

  async function submitAttempt(studentId, attemptId, user, ip) {
    const attempt = await db.one(
      "SELECT id, exam_id, status FROM exam_attempts WHERE id = $1 AND student_id = $2",
      [attemptId, studentId]
    );
    if (!attempt) throw notFound("Attempt not found");
    if (attempt.status === "evaluated") return getAttempt(studentId, attemptId);
    if (!["in_progress", "expired"].includes(attempt.status)) {
      throw badRequest("This attempt was already submitted");
    }

    await db.query("UPDATE exam_attempts SET status = 'submitted', submitted_at = now() WHERE id = $1", [attemptId]);
    const graded = await gradeAttempt(db, attemptId);
    await audit.record({
      actorId: studentId,
      actorEmail: user.email,
      action: "exam.attempt_submitted",
      entityType: "exam_attempt",
      entityId: attemptId,
      metadata: { examId: attempt.exam_id, score: graded.score },
      ip
    });
    return { attemptId, ...graded };
  }

  async function listResults(studentId, { page = 1, pageSize = 20 } = {}) {
    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM exam_results r JOIN exams e ON e.id = r.exam_id
         WHERE r.student_id = $1 AND r.published_at IS NOT NULL AND e.results_published = true`,
        [studentId]
      )
    ).count;
    const rows = await db.many(
      `SELECT r.id, r.obtained_marks, r.total_marks, r.percentage, r.status, r.published_at,
              e.id AS exam_id, e.title, s.name AS subject_name
       FROM exam_results r
       JOIN exams e ON e.id = r.exam_id
       LEFT JOIN subjects s ON s.id = e.subject_id
       WHERE r.student_id = $1 AND r.published_at IS NOT NULL AND e.results_published = true
       ORDER BY r.published_at DESC
       LIMIT $2 OFFSET $3`,
      [studentId, pageSize, (page - 1) * pageSize]
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        examId: row.exam_id,
        title: row.title,
        subjectName: row.subject_name,
        obtainedMarks: num(row.obtained_marks),
        totalMarks: num(row.total_marks),
        percentage: num(row.percentage),
        status: row.status,
        publishedAt: row.published_at
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
    listAnnouncements,
    listExams,
    startAttempt,
    getAttempt,
    saveAttemptAnswers,
    submitAttempt,
    listResults
  };
}
