import { badRequest, conflict, notFound } from "../utils/AppError.js";
import { gradeAttempt } from "./exams.grading.js";

const num = (value) => Number(value ?? 0);
const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);
// JSON aggregates return Postgres timestamp text; keep one ISO format for every response.
const iso = (value) => (value === null || value === undefined ? null : new Date(value).toISOString());

/**
 * Examination management for admins and teachers. Teachers only reach exams of
 * batches they are assigned to; admins reach every exam.
 */
export function createExamsService(db, audit, notifications) {
  const isAdmin = (user) => user.roles?.some((role) => role === "admin" || role === "super_admin");

  async function examRow(id) {
    const row = await db.one(
      `SELECT e.id, e.batch_id, e.subject_id, e.title, e.description, e.instructions, e.exam_type,
              e.starts_at, e.ends_at, e.duration_minutes, e.total_marks, e.pass_marks,
              e.max_attempts, e.shuffle_questions, e.status, e.results_published, e.results_published_at
       FROM exams e WHERE e.id = $1`,
      [id]
    );
    if (!row) throw notFound("Exam not found");
    return row;
  }

  async function assertBatchAssigned(batchId, user, message = "Batch not found") {
    if (isAdmin(user)) return;
    const assigned = await db.one("SELECT 1 AS ok FROM batch_teachers WHERE batch_id = $1 AND teacher_id = $2", [
      batchId,
      user.id
    ]);
    if (!assigned) throw notFound(message);
  }

  async function assertExamAccess(examId, user) {
    const exam = await examRow(examId);
    await assertBatchAssigned(exam.batch_id, user, "Exam not found");
    return exam;
  }

  /**
   * Once any student has started the exam, its paper is frozen: question text,
   * options, keys and marking can no longer change under an attempt. Corrected
   * versions come from `duplicateExam`, not from editing a live paper.
   */
  async function assertNoAttempts(examId, message) {
    const attempts = await db.one("SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1", [examId]);
    if (num(attempts.count) > 0) throw conflict(message);
  }

  const FROZEN_AFTER_ATTEMPTS = ["examType", "startsAt", "endsAt", "durationMinutes", "passMarks", "maxAttempts"];

  const mapExam = (row) => ({
    id: row.id,
    batchId: row.batch_id,
    batchName: row.batch_name ?? null,
    subjectId: row.subject_id,
    subjectName: row.subject_name ?? null,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    examType: row.exam_type,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    durationMinutes: row.duration_minutes,
    totalMarks: num(row.total_marks),
    passMarks: num(row.pass_marks),
    maxAttempts: row.max_attempts,
    shuffleQuestions: row.shuffle_questions,
    status: row.status,
    resultsPublished: row.results_published,
    resultsPublishedAt: iso(row.results_published_at),
    questionCount: row.question_count === undefined ? undefined : num(row.question_count),
    attemptCount: row.attempt_count === undefined ? undefined : num(row.attempt_count),
    resultCount: row.result_count === undefined ? undefined : num(row.result_count)
  });

  async function listExams(user, { page = 1, pageSize = 20, batchId, status, search } = {}) {
    const params = [];
    const where = [];
    if (!isAdmin(user)) {
      params.push(user.id);
      where.push(`EXISTS (SELECT 1 FROM batch_teachers bt WHERE bt.batch_id = e.batch_id AND bt.teacher_id = $${params.length})`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(`e.batch_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`e.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`e.title ILIKE $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(pageSize, (page - 1) * pageSize);
    // Count and page share the filters, so one JSON round trip returns both.
    const { payload } = await db.one(
      `SELECT json_build_object(
         'total', (SELECT count(*)::int FROM exams e ${whereSql}),
         'items', (
           SELECT COALESCE(json_agg(row_to_json(page_rows)), '[]'::json) FROM (
             SELECT e.id, e.batch_id, e.subject_id, e.title, e.exam_type, e.starts_at, e.ends_at,
                    e.duration_minutes, e.total_marks, e.pass_marks, e.max_attempts, e.status,
                    e.results_published, e.results_published_at,
                    b.name AS batch_name, s.name AS subject_name,
                    (SELECT count(*)::int FROM exam_questions q WHERE q.exam_id = e.id) AS question_count,
                    (SELECT count(*)::int FROM exam_attempts a WHERE a.exam_id = e.id) AS attempt_count,
                    (SELECT count(*)::int FROM exam_results r WHERE r.exam_id = e.id) AS result_count
             FROM exams e
             JOIN batches b ON b.id = e.batch_id
             LEFT JOIN subjects s ON s.id = e.subject_id
             ${whereSql}
             ORDER BY e.starts_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}
           ) page_rows
         )
       ) AS payload`,
      params
    );

    return { items: payload.items.map(mapExam), page, pageSize, total: num(payload.total) };
  }

  async function getExam(id, user) {
    const exam = await assertExamAccess(id, user);
    const [batch, questions, attempts, results] = await Promise.all([
      db.one("SELECT b.name AS batch_name, c.name AS course_name FROM batches b JOIN courses c ON c.id = b.course_id WHERE b.id = $1", [
        exam.batch_id
      ]),
      db.many(
        `SELECT q.id, q.question_type, q.question_text, q.explanation, q.marks, q.negative_marks, q.sort_order,
                k.correct_option_id, k.model_answer
         FROM exam_questions q
         LEFT JOIN exam_answer_keys k ON k.question_id = q.id
         WHERE q.exam_id = $1
         ORDER BY q.sort_order, q.created_at`,
        [id]
      ),
      db.many(
        `SELECT a.id, a.attempt_no, a.status, a.started_at, a.submitted_at, a.score,
                u.full_name, sp.enrollment_no
         FROM exam_attempts a
         JOIN users u ON u.id = a.student_id
         JOIN student_profiles sp ON sp.user_id = a.student_id
         WHERE a.exam_id = $1
         ORDER BY u.full_name, a.attempt_no
         LIMIT 200`,
        [id]
      ),
      db.many(
        `SELECT r.id, r.obtained_marks, r.total_marks, r.percentage, r.status, r.published_at,
                u.full_name, sp.enrollment_no
         FROM exam_results r
         JOIN users u ON u.id = r.student_id
         JOIN student_profiles sp ON sp.user_id = r.student_id
         WHERE r.exam_id = $1
         ORDER BY r.obtained_marks DESC
         LIMIT 200`,
        [id]
      )
    ]);

    const options = await db.many(
      `SELECT o.id, o.question_id, o.option_text, o.sort_order
       FROM exam_options o JOIN exam_questions q ON q.id = o.question_id
       WHERE q.exam_id = $1 ORDER BY o.sort_order`,
      [id]
    );

    return {
      exam: { ...mapExam({ ...exam, batch_name: batch?.batch_name }), courseName: batch?.course_name ?? null },
      questions: questions.map((question) => ({
        id: question.id,
        questionType: question.question_type,
        questionText: question.question_text,
        explanation: question.explanation,
        marks: num(question.marks),
        negativeMarks: num(question.negative_marks),
        sortOrder: question.sort_order,
        correctOptionId: question.correct_option_id,
        modelAnswer: question.model_answer,
        options: options
          .filter((option) => option.question_id === question.id)
          .map((option) => ({ id: option.id, text: option.option_text, sortOrder: option.sort_order }))
      })),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNo: attempt.attempt_no,
        status: attempt.status,
        startedAt: attempt.started_at,
        submittedAt: attempt.submitted_at,
        score: attempt.score === null ? null : num(attempt.score),
        fullName: attempt.full_name,
        enrollmentNo: attempt.enrollment_no
      })),
      results: results.map((result) => ({
        id: result.id,
        obtainedMarks: num(result.obtained_marks),
        totalMarks: num(result.total_marks),
        percentage: num(result.percentage),
        status: result.status,
        publishedAt: result.published_at,
        fullName: result.full_name,
        enrollmentNo: result.enrollment_no
      }))
    };
  }

  async function createExam(payload, user, ip) {
    await assertBatchAssigned(payload.batchId, user);
    const batch = await db.one("SELECT id FROM batches WHERE id = $1", [payload.batchId]);
    if (!batch) throw notFound("Batch not found");
    if (payload.subjectId) {
      const mapping = await db.one("SELECT 1 AS ok FROM batch_subjects WHERE batch_id = $1 AND subject_id = $2", [
        payload.batchId,
        payload.subjectId
      ]);
      if (!mapping) throw badRequest("That subject is not part of this batch");
    }

    const { rows } = await db.query(
      `INSERT INTO exams (batch_id, subject_id, title, description, instructions, exam_type,
                          starts_at, ends_at, duration_minutes, total_marks, pass_marks, max_attempts,
                          shuffle_questions, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $14) RETURNING id`,
      [
        payload.batchId,
        nullIfEmpty(payload.subjectId),
        payload.title,
        nullIfEmpty(payload.description),
        nullIfEmpty(payload.instructions),
        payload.examType ?? "mcq",
        payload.startsAt,
        payload.endsAt,
        payload.durationMinutes,
        payload.passMarks ?? 0,
        payload.maxAttempts ?? 1,
        payload.shuffleQuestions ?? true,
        payload.status ?? "draft",
        user.id
      ]
    );
    const id = rows[0].id;
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.created",
      entityType: "exam",
      entityId: id,
      metadata: { batchId: payload.batchId },
      ip
    });
    return getExam(id, user);
  }

  async function updateExam(id, payload, user, ip) {
    const exam = await assertExamAccess(id, user);
    const unchanged = (field, next) => {
      const current = exam[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
      if (field === "startsAt" || field === "endsAt") return new Date(next).getTime() === new Date(current).getTime();
      if (["durationMinutes", "passMarks", "maxAttempts"].includes(field)) return Number(next) === Number(current);
      return next === current;
    };
    const frozen = FROZEN_AFTER_ATTEMPTS.filter(
      (field) => field in payload && !unchanged(field, payload[field])
    );
    if (frozen.length > 0) {
      await assertNoAttempts(
        id,
        "Students have started this exam, so its timing and marking cannot change. Duplicate the exam for a corrected version."
      );
    }
    if (payload.status === "published") {
      const questions = await db.one("SELECT count(*)::int AS count FROM exam_questions WHERE exam_id = $1", [id]);
      if (num(questions.count) === 0) throw badRequest("Add at least one question before publishing the exam");
    }
    const map = {
      title: "title",
      description: "description",
      instructions: "instructions",
      examType: "exam_type",
      startsAt: "starts_at",
      endsAt: "ends_at",
      durationMinutes: "duration_minutes",
      passMarks: "pass_marks",
      maxAttempts: "max_attempts",
      shuffleQuestions: "shuffle_questions",
      status: "status",
      subjectId: "subject_id"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(
        ["description", "instructions", "subjectId"].includes(field) ? nullIfEmpty(payload[field]) : payload[field]
      );
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    try {
      await db.query(`UPDATE exams SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    } catch (error) {
      if (error.code === "23514") throw badRequest("Check the exam dates, marks and pass marks");
      throw error;
    }

    if (payload.status === "closed") {
      await db.query("UPDATE exam_attempts SET status = 'expired' WHERE exam_id = $1 AND status = 'in_progress'", [id]);
    }
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.updated",
      entityType: "exam",
      entityId: id,
      metadata: { fields: Object.keys(payload), batchId: exam.batch_id },
      ip
    });
    return getExam(id, user);
  }

  /** Copy the whole paper (questions, options, keys) into a fresh draft exam. */
  async function duplicateExam(id, user, ip) {
    const source = await assertExamAccess(id, user);
    const questions = await db.many(
      `SELECT id, question_type, question_text, explanation, marks, negative_marks, sort_order
       FROM exam_questions WHERE exam_id = $1 ORDER BY sort_order, created_at`,
      [id]
    );
    const options = await db.many(
      `SELECT o.id, o.question_id, o.option_text, o.sort_order
       FROM exam_options o JOIN exam_questions q ON q.id = o.question_id
       WHERE q.exam_id = $1 ORDER BY o.sort_order`,
      [id]
    );
    const keys = await db.many(
      `SELECT k.question_id, k.correct_option_id, k.model_answer
       FROM exam_answer_keys k JOIN exam_questions q ON q.id = k.question_id
       WHERE q.exam_id = $1`,
      [id]
    );

    const newId = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO exams (batch_id, subject_id, title, description, instructions, exam_type,
                            starts_at, ends_at, duration_minutes, total_marks, pass_marks, max_attempts,
                            shuffle_questions, status, results_published, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', false, $14)
         RETURNING id`,
        [
          source.batch_id,
          source.subject_id,
          `${source.title} (copy)`.slice(0, 200),
          source.description,
          source.instructions,
          source.exam_type,
          source.starts_at,
          source.ends_at,
          source.duration_minutes,
          source.total_marks,
          source.pass_marks,
          source.max_attempts,
          source.shuffle_questions,
          user.id
        ]
      );
      const created = rows[0].id;

      for (const question of questions) {
        const inserted = await tx.one(
          `INSERT INTO exam_questions (exam_id, question_type, question_text, explanation, marks, negative_marks, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            created,
            question.question_type,
            question.question_text,
            question.explanation,
            question.marks,
            question.negative_marks,
            question.sort_order
          ]
        );
        const optionMap = new Map();
        for (const option of options.filter((row) => row.question_id === question.id)) {
          const copy = await tx.one(
            "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, $2, $3) RETURNING id",
            [inserted.id, option.option_text, option.sort_order]
          );
          optionMap.set(option.id, copy.id);
        }
        const key = keys.find((row) => row.question_id === question.id);
        await tx.query(
          `INSERT INTO exam_answer_keys (question_id, correct_option_id, model_answer, updated_by)
           VALUES ($1, $2, $3, $4)`,
          [inserted.id, key?.correct_option_id ? optionMap.get(key.correct_option_id) ?? null : null, key?.model_answer ?? null, user.id]
        );
      }
      return created;
    });

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.duplicated",
      entityType: "exam",
      entityId: newId,
      metadata: { sourceExamId: id, batchId: source.batch_id },
      ip
    });
    return getExam(newId, user);
  }

  async function deleteExam(id, user, ip) {
    const exam = await assertExamAccess(id, user);
    const attempts = await db.one("SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1", [id]);
    // Deleting would cascade student attempts and published results; close it instead.
    if (num(attempts.count) > 0) {
      throw conflict("This exam already has attempts. Close it instead of deleting, so student records survive.");
    }
    await db.query("DELETE FROM exams WHERE id = $1", [id]);
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.deleted",
      entityType: "exam",
      entityId: id,
      metadata: { batchId: exam.batch_id },
      ip
    });
    return { id };
  }

  async function recalcTotal(examId, runner = db) {
    await runner.query(
      `UPDATE exams SET total_marks = COALESCE((SELECT SUM(marks) FROM exam_questions WHERE exam_id = $1), 0),
                        pass_marks = LEAST(pass_marks, COALESCE((SELECT SUM(marks) FROM exam_questions WHERE exam_id = $1), 0)),
                        updated_at = now()
       WHERE id = $1`,
      [examId]
    );
  }

  /**
   * Serialise paper mutations with attempt starts: starts hold a share lock on
   * the exam row, edits hold an exclusive lock and then check for attempts. A
   * start either sees a completed edit or the edit is rejected as frozen.
   */
  async function lockPaper(tx, examId, message) {
    const exam = await tx.one("SELECT id FROM exams WHERE id = $1 FOR UPDATE", [examId]);
    if (!exam) throw notFound("Exam not found");
    const attempts = await tx.one("SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1", [examId]);
    if (num(attempts.count) > 0) throw conflict(message);
  }

  async function addQuestion(examId, payload, user, ip) {
    await assertExamAccess(examId, user);
    const type = payload.questionType ?? "mcq";

    const question = await db.transaction(async (tx) => {
      await lockPaper(
        tx,
        examId,
        "The question paper is frozen because students have started this exam. Duplicate the exam for a corrected version."
      );
      const inserted = await tx.one(
        `INSERT INTO exam_questions (exam_id, question_type, question_text, explanation, marks, negative_marks, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          examId,
          type,
          payload.questionText,
          nullIfEmpty(payload.explanation),
          payload.marks,
          type === "mcq" ? payload.negativeMarks ?? 0 : 0,
          payload.sortOrder ?? 0
        ]
      );

      let correctOptionId = null;
      if (type === "mcq") {
        for (const [index, option] of (payload.options ?? []).entries()) {
          const row = await tx.one(
            "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, $2, $3) RETURNING id",
            [inserted.id, option.text, index]
          );
          if (option.isCorrect) correctOptionId = row.id;
        }
      }

      await tx.query(
        `INSERT INTO exam_answer_keys (question_id, correct_option_id, model_answer, updated_by)
         VALUES ($1, $2, $3, $4)`,
        [inserted.id, correctOptionId, nullIfEmpty(payload.modelAnswer), user.id]
      );
      await recalcTotal(examId, tx);
      return inserted;
    });
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.question_added",
      entityType: "exam_question",
      entityId: question.id,
      metadata: { examId, type },
      ip
    });
    return getExam(examId, user);
  }

  async function updateQuestion(questionId, payload, user, ip) {
    const question = await db.one("SELECT id, exam_id FROM exam_questions WHERE id = $1", [questionId]);
    if (!question) throw notFound("Question not found");
    await assertExamAccess(question.exam_id, user);

    await db.transaction(async (tx) => {
      await lockPaper(
        tx,
        question.exam_id,
        "This question belongs to an exam students have started; the paper is frozen. Duplicate the exam for a corrected version."
      );
      const current = await tx.one("SELECT id, question_type FROM exam_questions WHERE id = $1", [questionId]);

      // Validate the row this PATCH produces, not just the fields it mentions.
      const nextType = payload.questionType ?? current.question_type;
      if (nextType === "mcq" && !payload.options) {
        const existing = await tx.one("SELECT count(*)::int AS count FROM exam_options WHERE question_id = $1", [
          questionId
        ]);
        if (num(existing.count) < 2) throw badRequest("An MCQ needs at least two options");
      }
      if (nextType === "subjective" && payload.modelAnswer === undefined) {
        const key = await tx.one("SELECT model_answer FROM exam_answer_keys WHERE question_id = $1", [questionId]);
        if (!key?.model_answer) throw badRequest("A subjective question needs a model answer");
      }

      const type = payload.questionType;
      if (type && type !== "mcq") {
        const responses = await tx.one("SELECT count(*)::int AS count FROM exam_responses WHERE question_id = $1", [
          questionId
        ]);
        if (num(responses.count) > 0) throw badRequest("This question already has student responses");
      }

      await tx.query(
        `UPDATE exam_questions SET
           question_type = COALESCE($2, question_type),
           question_text = COALESCE($3, question_text),
           explanation = COALESCE($4, explanation),
           marks = COALESCE($5, marks),
           negative_marks = COALESCE($6, negative_marks),
           sort_order = COALESCE($7, sort_order),
           updated_at = now()
         WHERE id = $1`,
        [
          questionId,
          nullIfEmpty(payload.questionType),
          nullIfEmpty(payload.questionText),
          payload.explanation === undefined ? null : nullIfEmpty(payload.explanation),
          payload.marks ?? null,
          payload.negativeMarks ?? null,
          payload.sortOrder ?? null
        ]
      );

      if (payload.options) {
        await tx.query("DELETE FROM exam_answer_keys WHERE question_id = $1", [questionId]);
        await tx.query("DELETE FROM exam_options WHERE question_id = $1", [questionId]);
        let correctOptionId = null;
        for (const [index, option] of payload.options.entries()) {
          const row = await tx.one(
            "INSERT INTO exam_options (question_id, option_text, sort_order) VALUES ($1, $2, $3) RETURNING id",
            [questionId, option.text, index]
          );
          if (option.isCorrect) correctOptionId = row.id;
        }
        await tx.query(
          `INSERT INTO exam_answer_keys (question_id, correct_option_id, model_answer, updated_by)
           VALUES ($1, $2, $3, $4)`,
          [questionId, correctOptionId, nullIfEmpty(payload.modelAnswer), user.id]
        );
      } else if (payload.modelAnswer !== undefined) {
        await tx.query(
          `INSERT INTO exam_answer_keys (question_id, model_answer, updated_by) VALUES ($1, $2, $3)
           ON CONFLICT (question_id) DO UPDATE SET model_answer = EXCLUDED.model_answer, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [questionId, nullIfEmpty(payload.modelAnswer), user.id]
        );
      }
      await recalcTotal(question.exam_id, tx);
    });

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.question_updated",
      entityType: "exam_question",
      entityId: questionId,
      metadata: { examId: question.exam_id },
      ip
    });
    return getExam(question.exam_id, user);
  }

  async function deleteQuestion(questionId, user, ip) {
    const question = await db.one("SELECT id, exam_id FROM exam_questions WHERE id = $1", [questionId]);
    if (!question) throw notFound("Question not found");
    await assertExamAccess(question.exam_id, user);
    await db.transaction(async (tx) => {
      await lockPaper(
        tx,
        question.exam_id,
        "This question belongs to an exam students have started; the paper is frozen. Duplicate the exam for a corrected version."
      );
      await tx.query("DELETE FROM exam_questions WHERE id = $1", [questionId]);
      await recalcTotal(question.exam_id, tx);
    });
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.question_deleted",
      entityType: "exam_question",
      entityId: questionId,
      metadata: { examId: question.exam_id },
      ip
    });
    return getExam(question.exam_id, user);
  }

  async function attemptResponses(attemptId, user) {
    const attempt = await db.one(
      `SELECT a.id, a.exam_id, a.student_id, a.status FROM exam_attempts a WHERE a.id = $1`,
      [attemptId]
    );
    if (!attempt) throw notFound("Attempt not found");
    await assertExamAccess(attempt.exam_id, user);

    const responses = await db.many(
      `SELECT r.id, r.question_id, r.selected_option_id, r.answer_text, r.is_marked_for_review,
              r.awarded_marks, r.evaluated_at, q.question_text, q.question_type, q.marks,
              o.option_text AS selected_option_text
       FROM exam_responses r
       JOIN exam_questions q ON q.id = r.question_id
       LEFT JOIN exam_options o ON o.id = r.selected_option_id
       WHERE r.attempt_id = $1 ORDER BY q.sort_order, q.created_at`,
      [attemptId]
    );
    const student = await db.one(
      `SELECT u.full_name, sp.enrollment_no FROM users u JOIN student_profiles sp ON sp.user_id = u.id WHERE u.id = $1`,
      [attempt.student_id]
    );

    return {
      attempt: {
        id: attempt.id,
        status: attempt.status,
        examId: attempt.exam_id,
        fullName: student?.full_name ?? null,
        enrollmentNo: student?.enrollment_no ?? null
      },
      responses: responses.map((row) => ({
        id: row.id,
        questionId: row.question_id,
        questionText: row.question_text,
        questionType: row.question_type,
        marks: num(row.marks),
        selectedOptionId: row.selected_option_id,
        selectedOptionText: row.selected_option_text,
        answerText: row.answer_text,
        markedForReview: row.is_marked_for_review,
        awardedMarks: row.awarded_marks === null ? null : num(row.awarded_marks),
        evaluatedAt: row.evaluated_at
      }))
    };
  }

  async function evaluateResponse(responseId, { awardedMarks }, user, ip) {
    const response = await db.one(
      `SELECT r.id, r.attempt_id, r.question_id, q.exam_id, q.marks
       FROM exam_responses r JOIN exam_questions q ON q.id = r.question_id
       WHERE r.id = $1`,
      [responseId]
    );
    if (!response) throw notFound("Response not found");
    await assertExamAccess(response.exam_id, user);
    if (num(awardedMarks) > num(response.marks)) throw badRequest(`Marks cannot exceed ${num(response.marks)}`);

    await db.query(
      "UPDATE exam_responses SET awarded_marks = $2, evaluated_by = $3, evaluated_at = now(), updated_at = now() WHERE id = $1",
      [responseId, awardedMarks, user.id]
    );
    const graded = await gradeAttempt(db, response.attempt_id);
    // Marks changed on a published exam: hide the result until it is published again,
    // so a student never sees a score move behind their back.
    await db.query("UPDATE exam_results SET published_at = NULL WHERE exam_id = $1 AND published_at IS NOT NULL", [
      response.exam_id
    ]);
    await db.query(
      "UPDATE exams SET results_published = false, results_published_at = NULL, updated_at = now() WHERE id = $1 AND results_published = true",
      [response.exam_id]
    );
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.response_evaluated",
      entityType: "exam_response",
      entityId: responseId,
      metadata: { examId: response.exam_id, awardedMarks },
      ip
    });
    return { id: responseId, ...graded };
  }

  async function publishResults(examId, user, ip) {
    const exam = await assertExamAccess(examId, user);
    const counts = await db.one(
      `SELECT count(*)::int AS questions FROM exam_questions WHERE exam_id = $1`,
      [examId]
    );
    if (num(counts.questions) === 0) throw badRequest("Add questions before publishing results");
    if (!["published", "closed"].includes(exam.status)) throw badRequest("Publish or close the exam first");

    const attempts = await db.many(
      "SELECT id FROM exam_attempts WHERE exam_id = $1 AND status IN ('submitted', 'evaluated')",
      [examId]
    );
    for (const attempt of attempts) {
      await gradeAttempt(db, attempt.id);
    }

    const pending = await db.one(
      `SELECT count(*)::int AS count FROM exam_attempts WHERE exam_id = $1 AND status = 'submitted'`,
      [examId]
    );
    if (num(pending.count) > 0) {
      throw badRequest(`${num(pending.count)} attempt(s) still have subjective answers waiting for evaluation`);
    }

    await db.query(
      `UPDATE exam_results SET published_at = now(), published_by = $2 WHERE exam_id = $1 AND published_at IS NULL`,
      [examId, user.id]
    );
    await db.query(
      "UPDATE exams SET results_published = true, results_published_at = now(), updated_at = now() WHERE id = $1",
      [examId]
    );

    const results = await db.many("SELECT student_id FROM exam_results WHERE exam_id = $1", [examId]);
    await notifications?.notify(
      results.map((row) => row.student_id),
      { type: "exam", title: `Results published: ${exam.title}`, body: "Open the app to see your score and answers." }
    );
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "exam.results_published",
      entityType: "exam",
      entityId: examId,
      metadata: { batchId: exam.batch_id, attempts: attempts.length },
      ip
    });
    return getExam(examId, user);
  }

  return {
    listExams,
    getExam,
    createExam,
    updateExam,
    duplicateExam,
    deleteExam,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    attemptResponses,
    evaluateResponse,
    publishResults
  };
}
