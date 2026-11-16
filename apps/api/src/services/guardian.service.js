import { notFound } from "../utils/AppError.js";

/**
 * Read-only guardian portal. A guardian may see exactly the students linked to
 * their own account in `guardian_profiles` (user_id = session user). The link is
 * checked in SQL on every request; the browser never supplies a student it can
 * choose from. Attendance, fees and results are then produced by the existing
 * student queries for that verified student id.
 */
export function createGuardianService(db, studentWorkspace, feesWorkspace) {
  async function linkedChild(guardianId, studentId) {
    return db.one(
      `SELECT gp.student_id, u.full_name, u.email, sp.enrollment_no
       FROM guardian_profiles gp
       JOIN users u ON u.id = gp.student_id
       JOIN student_profiles sp ON sp.user_id = gp.student_id
       WHERE gp.user_id = $1 AND gp.student_id = $2`,
      [guardianId, studentId]
    );
  }

  async function assertChild(guardianId, studentId) {
    const child = await linkedChild(guardianId, studentId);
    if (!child) throw notFound("Child not found");
    return child;
  }

  async function listChildren(guardianId) {
    const rows = await db.many(
      `SELECT DISTINCT u.id, u.full_name, u.email, u.status, sp.enrollment_no,
              en.course_name, en.batch_name
       FROM guardian_profiles gp
       JOIN users u ON u.id = gp.student_id
       JOIN student_profiles sp ON sp.user_id = gp.student_id
       LEFT JOIN LATERAL (
         SELECT c.name AS course_name, b.name AS batch_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN batches b ON b.id = e.batch_id
         WHERE e.student_id = gp.student_id AND e.status = 'active'
         ORDER BY e.enrolled_at DESC LIMIT 1
       ) en ON true
       WHERE gp.user_id = $1
       ORDER BY u.full_name`,
      [guardianId]
    );

    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      status: row.status,
      enrollmentNo: row.enrollment_no,
      courseName: row.course_name,
      batchName: row.batch_name
    }));
  }

  async function attendance(guardianId, studentId, query) {
    await assertChild(guardianId, studentId);
    return studentWorkspace.attendanceHistory(studentId, query);
  }

  async function fees(guardianId, studentId) {
    await assertChild(guardianId, studentId);
    return feesWorkspace.studentFees(studentId);
  }

  async function results(guardianId, studentId, query) {
    await assertChild(guardianId, studentId);
    return studentWorkspace.listResults(studentId, query);
  }

  return { listChildren, attendance, fees, results };
}
