import { toCsv } from "@coaching/shared";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const num = (value) => Number(value ?? 0);

/** Read-only reporting: one JSON payload the admin dashboard can render, plus CSV exports. */
export function createReportsService(db) {
  async function overview() {
    const counts = await db.one(
      `SELECT
         (SELECT count(*)::int FROM student_profiles) AS students,
         (SELECT count(*)::int FROM teacher_profiles) AS teachers,
         (SELECT count(*)::int FROM batches WHERE status = 'active') AS active_batches,
         (SELECT count(*)::int FROM exams) AS exams`
    );

    const feesByMonth = await db.many(
      `SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month,
              COALESCE(SUM(p.amount), 0)::numeric AS collected,
              count(*)::int AS receipts
       FROM payments p
       WHERE p.voided_at IS NULL
         AND p.paid_at >= date_trunc('month', current_date) - interval '5 months'
       GROUP BY 1 ORDER BY 1`
    );

    const attendanceByBatch = await db.many(
      `SELECT b.id, b.name, count(*)::int AS marked,
              count(*) FILTER (WHERE a.status = 'present')::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              count(*) FILTER (WHERE a.status = 'late')::int AS late
       FROM attendance a JOIN batches b ON b.id = a.batch_id
       WHERE a.session_date >= current_date - 29
       GROUP BY b.id, b.name
       ORDER BY b.name`
    );

    const examPerformance = await db.many(
      `SELECT e.id, e.title, count(r.id)::int AS results,
              COALESCE(round(avg(r.percentage), 1), 0)::numeric AS average_percentage,
              count(*) FILTER (WHERE r.status = 'pass')::int AS passed
       FROM exams e JOIN exam_results r ON r.exam_id = e.id
       GROUP BY e.id, e.title, e.created_at
       ORDER BY e.created_at DESC
       LIMIT 10`
    );

    const admissionsByMonth = await db.many(
      `SELECT to_char(date_trunc('month', sp.created_at), 'YYYY-MM') AS month, count(*)::int AS admitted
       FROM student_profiles sp
       WHERE sp.created_at >= date_trunc('month', current_date) - interval '5 months'
       GROUP BY 1 ORDER BY 1`
    );

    const totals = (await db.one(
      `SELECT COALESCE(SUM(p.amount), 0)::numeric AS collected_all_time,
              count(*)::int AS receipts
       FROM payments p WHERE p.voided_at IS NULL`
    )) ?? { collected_all_time: 0, receipts: 0 };

    const outstanding = await db.one(
      `SELECT COALESCE(SUM(sf.net_amount - COALESCE(p.paid, 0)), 0)::numeric AS pending
       FROM student_fees sf
       LEFT JOIN (SELECT student_fee_id, SUM(amount) AS paid FROM payments WHERE voided_at IS NULL GROUP BY student_fee_id) p
         ON p.student_fee_id = sf.id
       WHERE sf.status <> 'waived'`
    );

    return {
      totals: {
        students: num(counts.students),
        teachers: num(counts.teachers),
        activeBatches: num(counts.active_batches),
        exams: num(counts.exams),
        collectedAllTime: money(totals.collected_all_time),
        receipts: num(totals.receipts),
        outstanding: money(outstanding?.pending)
      },
      feesByMonth: feesByMonth.map((row) => ({
        month: row.month,
        collected: money(row.collected),
        receipts: num(row.receipts)
      })),
      attendanceByBatch: attendanceByBatch.map((row) => ({
        batchId: row.id,
        batchName: row.name,
        marked: num(row.marked),
        present: num(row.present),
        absent: num(row.absent),
        late: num(row.late),
        rate: num(row.marked) === 0 ? 0 : Math.round((1000 * num(row.present)) / num(row.marked)) / 10
      })),
      examPerformance: examPerformance.map((row) => ({
        examId: row.id,
        title: row.title,
        results: num(row.results),
        averagePercentage: money(row.average_percentage),
        passed: num(row.passed)
      })),
      admissionsByMonth: admissionsByMonth.map((row) => ({ month: row.month, admitted: num(row.admitted) }))
    };
  }

  async function feesCsv() {
    const rows = await db.many(
      `SELECT u.full_name, u.email, sp.enrollment_no, fs.name AS structure_name, fs.academic_year,
              sf.total_amount, sf.discount_amount, sf.net_amount, sf.due_date, sf.status,
              COALESCE(p.paid, 0)::numeric AS paid_amount,
              (sf.net_amount - COALESCE(p.paid, 0))::numeric AS pending_amount
       FROM student_fees sf
       JOIN users u ON u.id = sf.student_id
       JOIN student_profiles sp ON sp.user_id = sf.student_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       LEFT JOIN (SELECT student_fee_id, SUM(amount) AS paid FROM payments WHERE voided_at IS NULL GROUP BY student_fee_id) p
         ON p.student_fee_id = sf.id
       ORDER BY sf.due_date NULLS LAST, u.full_name`
    );
    return toCsv(
      ["Student", "Email", "Enrolment", "Structure", "Year", "Total", "Discount", "Net", "Paid", "Pending", "Due", "Status"],
      rows.map((row) => [
        row.full_name,
        row.email,
        row.enrollment_no,
        row.structure_name,
        row.academic_year,
        money(row.total_amount),
        money(row.discount_amount),
        money(row.net_amount),
        money(row.paid_amount),
        money(row.pending_amount),
        row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : "",
        row.status
      ])
    );
  }

  async function attendanceCsv({ from, to } = {}) {
    const params = [];
    const where = [];
    if (from) {
      params.push(from);
      where.push(`a.session_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`a.session_date <= $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await db.many(
      `SELECT u.full_name, sp.enrollment_no, b.name AS batch_name,
              count(*)::int AS marked,
              count(*) FILTER (WHERE a.status = 'present')::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
              count(*) FILTER (WHERE a.status = 'late')::int AS late
       FROM attendance a
       JOIN users u ON u.id = a.student_id
       JOIN student_profiles sp ON sp.user_id = a.student_id
       JOIN batches b ON b.id = a.batch_id
       ${whereSql}
       GROUP BY u.full_name, sp.enrollment_no, b.name
       ORDER BY b.name, u.full_name`,
      params
    );

    return toCsv(
      ["Student", "Enrolment", "Batch", "Marked", "Present", "Absent", "Late", "Attendance %"],
      rows.map((row) => [
        row.full_name,
        row.enrollment_no,
        row.batch_name,
        num(row.marked),
        num(row.present),
        num(row.absent),
        num(row.late),
        num(row.marked) === 0 ? "" : Math.round((1000 * num(row.present)) / num(row.marked)) / 10
      ])
    );
  }

  return { overview, feesCsv, attendanceCsv };
}
