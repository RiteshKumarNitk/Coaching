import { notFound } from "../utils/AppError.js";

const num = (value) => Number(value ?? 0);

/**
 * Grades an attempt: MCQs against exam_answer_keys (negative marks applied at
 * score level because exam_responses.awarded_marks cannot go below zero),
 * subjective answers left pending until a teacher/admin awards marks.
 * The result row stays unpublished until the exam results are published.
 */
export async function gradeAttempt(db, attemptId) {
  const attempt = await db.one(
    `SELECT a.id, a.exam_id, a.student_id, e.total_marks, e.pass_marks
     FROM exam_attempts a JOIN exams e ON e.id = a.exam_id
     WHERE a.id = $1`,
    [attemptId]
  );
  if (!attempt) throw notFound("Attempt not found");

  await db.query(
    `UPDATE exam_responses r
     SET awarded_marks = CASE
           WHEN r.selected_option_id IS NULL THEN 0
           WHEN r.selected_option_id = k.correct_option_id THEN q.marks
           ELSE 0
         END,
         evaluated_at = now()
     FROM exam_questions q
     LEFT JOIN exam_answer_keys k ON k.question_id = q.id
     WHERE r.question_id = q.id AND r.attempt_id = $1 AND q.question_type = 'mcq'`,
    [attemptId]
  );

  const [responses, penaltyRow] = await Promise.all([
    db.many(
      `SELECT r.id, q.question_type, r.awarded_marks, q.marks
       FROM exam_responses r JOIN exam_questions q ON q.id = r.question_id
       WHERE r.attempt_id = $1`,
      [attemptId]
    ),
    db.one(
      `SELECT COALESCE(SUM(q.negative_marks), 0)::numeric AS penalty
       FROM exam_responses r
       JOIN exam_questions q ON q.id = r.question_id
       LEFT JOIN exam_answer_keys k ON k.question_id = q.id
       WHERE r.attempt_id = $1 AND q.question_type = 'mcq'
         AND r.selected_option_id IS NOT NULL
         AND r.selected_option_id IS DISTINCT FROM k.correct_option_id`,
      [attemptId]
    )
  ]);

  const pending = responses.some((row) => row.question_type === "subjective" && row.awarded_marks === null);
  const earned = responses.reduce((sum, row) => sum + num(row.awarded_marks), 0);
  const score = Math.max(0, Math.round((earned - num(penaltyRow.penalty)) * 100) / 100);
  const total = num(attempt.total_marks);
  const percentage = total > 0 ? Math.min(100, Math.round((score / total) * 10000) / 100) : 0;
  const status = pending ? "submitted" : "evaluated";
  // An exam with no marks cannot be passed: 0 >= 0 must not read as a pass.
  const resultStatus = pending || total === 0 ? "pending" : score >= num(attempt.pass_marks) ? "pass" : "fail";

  await db.query("UPDATE exam_attempts SET status = $2, score = $3 WHERE id = $1", [attemptId, status, score]);
  await db.query(
    `INSERT INTO exam_results (exam_id, attempt_id, student_id, obtained_marks, total_marks, percentage, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET
       attempt_id = CASE WHEN EXCLUDED.obtained_marks >= exam_results.obtained_marks
                         THEN EXCLUDED.attempt_id ELSE exam_results.attempt_id END,
       obtained_marks = GREATEST(EXCLUDED.obtained_marks, exam_results.obtained_marks),
       total_marks = EXCLUDED.total_marks,
       percentage = CASE WHEN EXCLUDED.obtained_marks >= exam_results.obtained_marks
                         THEN EXCLUDED.percentage ELSE exam_results.percentage END,
       status = CASE
         WHEN EXCLUDED.status = 'pending' THEN exam_results.status
         WHEN EXCLUDED.obtained_marks >= exam_results.obtained_marks THEN EXCLUDED.status
         ELSE exam_results.status END`,
    // Multiple attempts keep the best score rather than silently keeping the last one.
    [attempt.exam_id, attemptId, attempt.student_id, score, total, percentage, resultStatus]
  );

  return { score, totalMarks: total, percentage, status, resultStatus, pending };
}
