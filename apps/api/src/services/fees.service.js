import { badRequest, conflict, notFound } from "../utils/AppError.js";

const num = (value) => Number(value ?? 0);
const money = (value) => Math.round(num(value) * 100) / 100;
const nullIfEmpty = (value) => (value === undefined || value === null || value === "" ? null : value);
const PAID_TOTALS = `(SELECT student_fee_id, SUM(amount) AS paid FROM payments
  WHERE voided_at IS NULL GROUP BY student_fee_id)`;

/**
 * Split a payable amount into an ordered schedule. The last instalment absorbs the
 * rounding remainder so the parts always add back up to the invoice net amount.
 */
const toIsoDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

function buildSchedule(net, count, firstDue) {
  const parts = Math.max(1, Math.min(24, Number(count) || 1));
  const iso = toIsoDate(firstDue);
  const base = iso ? new Date(`${iso}T00:00:00Z`) : new Date();
  const rows = [];
  const per = Math.floor((money(net) * 100) / parts) / 100;
  let assigned = 0;
  for (let index = 0; index < parts; index += 1) {
    const amount = index === parts - 1 ? money(net - assigned) : per;
    assigned = money(assigned + amount);
    const due = new Date(base.getTime());
    due.setUTCMonth(due.getUTCMonth() + index);
    rows.push({ seq: index + 1, amount, dueDate: due.toISOString().slice(0, 10) });
  }
  return rows;
}

async function replaceSchedule({ query }, feeId, net, count, firstDue) {
  await query("DELETE FROM fee_installments WHERE student_fee_id = $1", [feeId]);
  const rows = buildSchedule(net, count, firstDue);
  for (const row of rows) {
    await query(
      "INSERT INTO fee_installments (student_fee_id, seq, amount, due_date) VALUES ($1, $2, $3, $4)",
      [feeId, row.seq, row.amount, row.dueDate]
    );
  }
  return rows;
}

const FEE_SELECT = `SELECT sf.id, sf.student_id, sf.fee_structure_id, sf.total_amount, sf.discount_amount,
         sf.net_amount, sf.due_date, sf.status, sf.notes, sf.created_at,
         u.full_name, u.email, sp.enrollment_no,
         fs.name AS structure_name, fs.academic_year,
         c.name AS course_name, b.name AS batch_name,
         (SELECT count(*)::int FROM fee_installments i WHERE i.student_fee_id = sf.id) AS installment_count,
         COALESCE(p.paid, 0)::numeric AS paid_amount
  FROM student_fees sf
  JOIN users u ON u.id = sf.student_id
  JOIN student_profiles sp ON sp.user_id = sf.student_id
  JOIN fee_structures fs ON fs.id = sf.fee_structure_id
  JOIN courses c ON c.id = fs.course_id
  LEFT JOIN LATERAL (
    SELECT b.name FROM enrollments e JOIN batches b ON b.id = e.batch_id
    WHERE e.student_id = sf.student_id AND e.status = 'active'
    ORDER BY e.enrolled_at DESC LIMIT 1
  ) b ON true
  LEFT JOIN ${PAID_TOTALS} p ON p.student_fee_id = sf.id`;

export function createFeesService(db, audit, notifications) {
  /* ------------------------------------------------------------- structures */
  async function listStructures({ page = 1, pageSize = 20, search, status, courseId } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(fs.name ILIKE $${params.length} OR fs.academic_year ILIKE $${params.length})`);
    }
    if (status) {
      params.push(status);
      where.push(`fs.status = $${params.length}`);
    }
    if (courseId) {
      params.push(courseId);
      where.push(`fs.course_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const total = (await db.one(`SELECT count(*)::int AS count FROM fee_structures fs ${whereSql}`, params)).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT fs.id, fs.course_id, fs.name, fs.academic_year, fs.total_amount, fs.installments, fs.status,
              c.name AS course_name, c.code AS course_code,
              (SELECT count(*)::int FROM student_fees sf WHERE sf.fee_structure_id = fs.id) AS assigned_count
       FROM fee_structures fs JOIN courses c ON c.id = fs.course_id
       ${whereSql}
       ORDER BY fs.academic_year DESC, fs.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        courseName: row.course_name,
        courseCode: row.course_code,
        name: row.name,
        academicYear: row.academic_year,
        totalAmount: money(row.total_amount),
        installments: row.installments,
        status: row.status,
        assignedCount: num(row.assigned_count)
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function createStructure(payload, user, ip) {
    const course = await db.one("SELECT id FROM courses WHERE id = $1", [payload.courseId]);
    if (!course) throw notFound("Course not found");
    try {
      const { rows } = await db.query(
        `INSERT INTO fee_structures (course_id, name, academic_year, total_amount, installments, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          payload.courseId,
          payload.name,
          payload.academicYear,
          payload.totalAmount,
          payload.installments ?? 1,
          payload.status ?? "active",
          user.id
        ]
      );
      await audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: "fee_structure.created",
        entityType: "fee_structure",
        entityId: rows[0].id,
        metadata: { courseId: payload.courseId, totalAmount: payload.totalAmount },
        ip
      });
      return { id: rows[0].id };
    } catch (error) {
      if (error.code === "23505") throw conflict("This fee structure already exists for that course and year");
      throw error;
    }
  }

  async function updateStructure(id, payload, user, ip) {
    const map = {
      name: "name",
      academicYear: "academic_year",
      totalAmount: "total_amount",
      installments: "installments",
      status: "status"
    };
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(map)) {
      if (!(field in payload)) continue;
      sets.push(`${column} = $${sets.length + 1}`);
      values.push(payload[field]);
    }
    if (sets.length === 0) throw badRequest("Nothing to update");
    values.push(id);
    const result = await db.query(
      `UPDATE fee_structures SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    if (result.rowCount === 0) throw notFound("Fee structure not found");
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "fee_structure.updated",
      entityType: "fee_structure",
      entityId: id,
      metadata: { fields: Object.keys(payload) },
      ip
    });
    return { id };
  }

  /* ------------------------------------------------------------------- dues */
  async function listDues({ page = 1, pageSize = 20, status, batchId, search } = {}) {
    const params = [];
    const where = [];
    if (status) {
      params.push(status);
      where.push(`sf.status = $${params.length}`);
    }
    if (batchId) {
      params.push(batchId);
      where.push(
        `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = sf.student_id AND e.batch_id = $${params.length} AND e.status = 'active')`
      );
    }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR sp.enrollment_no ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(pageSize, (page - 1) * pageSize);
    // Total, page and summary in one JSON round trip; the summary is institute-wide.
    const { payload } = await db.one(
      `SELECT json_build_object(
         'total', (
           SELECT count(*)::int FROM student_fees sf
           JOIN users u ON u.id = sf.student_id
           JOIN student_profiles sp ON sp.user_id = sf.student_id ${whereSql}
         ),
         'summary', (
           SELECT json_build_object(
             'billed', COALESCE(SUM(sf.net_amount), 0)::numeric,
             'collected', COALESCE(SUM(COALESCE(p.paid, 0)), 0)::numeric,
             'pending', COALESCE(SUM(sf.net_amount - COALESCE(p.paid, 0)), 0)::numeric
           )
           FROM student_fees sf
           LEFT JOIN ${PAID_TOTALS} p ON p.student_fee_id = sf.id
           WHERE sf.status <> 'waived'
         ),
         'items', (
           SELECT COALESCE(json_agg(row_to_json(page_rows)), '[]'::json) FROM (
             ${FEE_SELECT} ${whereSql}
             ORDER BY sf.due_date NULLS LAST, u.full_name
             LIMIT $${params.length - 1} OFFSET $${params.length}
           ) page_rows
         )
       ) AS payload`,
      params
    );

    return {
      items: payload.items.map((row) => {
        const paid = money(row.paid_amount);
        const net = money(row.net_amount);
        return {
          id: row.id,
          studentId: row.student_id,
          fullName: row.full_name,
          email: row.email,
          enrollmentNo: row.enrollment_no,
          feeStructureId: row.fee_structure_id,
          structureName: row.structure_name,
          academicYear: row.academic_year,
          courseName: row.course_name,
          batchName: row.batch_name,
          totalAmount: money(row.total_amount),
          discountAmount: money(row.discount_amount),
          netAmount: net,
          paidAmount: paid,
          pendingAmount: Math.max(0, money(net - paid)),
          dueDate: row.due_date,
          status: row.status,
          installmentCount: num(row.installment_count),
          notes: row.notes
        };
      }),
      page,
      pageSize,
      total: num(payload.total),
      summary: {
        billed: money(payload.summary.billed),
        collected: money(payload.summary.collected),
        pending: money(payload.summary.pending)
      }
    };
  }

  async function assignFee(payload, user, ip) {
    const student = await db.one("SELECT user_id FROM student_profiles WHERE user_id = $1", [payload.studentId]);
    if (!student) throw notFound("Student not found");
    const structure = await db.one(
      "SELECT id, name, course_id, total_amount, installments FROM fee_structures WHERE id = $1 AND status = 'active'",
      [payload.feeStructureId]
    );
    if (!structure) throw notFound("Fee structure not found");

    // A fee belongs to a course, so the student must be on that course. Otherwise a
    // NEET fee can be billed to a JEE student and the ledger silently looks valid.
    const enrolled = await db.one(
      `SELECT 1 AS ok FROM enrollments
       WHERE student_id = $1 AND course_id = $2 AND status = 'active'`,
      [payload.studentId, structure.course_id]
    );
    if (!enrolled) {
      throw badRequest("This student has no active enrolment on the course this fee belongs to");
    }

    const total = money(structure.total_amount);
    const discount = money(payload.discountAmount ?? 0);
    if (discount > total) throw badRequest("Discount cannot exceed the fee amount");

    try {
      const { rows } = await db.query(
        `INSERT INTO student_fees (student_id, fee_structure_id, total_amount, discount_amount, net_amount,
                                   due_date, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8) RETURNING id`,
        [
          payload.studentId,
          payload.feeStructureId,
          total,
          discount,
          money(total - discount),
          nullIfEmpty(payload.dueDate),
          nullIfEmpty(payload.notes),
          user.id
        ]
      );
      const schedule = await replaceSchedule(
        db,
        rows[0].id,
        money(total - discount),
        structure.installments,
        nullIfEmpty(payload.dueDate)
      );

      await audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: "student_fee.assigned",
        entityType: "student_fee",
        entityId: rows[0].id,
        metadata: {
          studentId: payload.studentId,
          feeStructureId: payload.feeStructureId,
          installments: schedule.length
        },
        ip
      });

      await notifications?.notify([payload.studentId], {
        type: "fee",
        title: `Fee assigned: ${structure.name}`,
        body: `Payable ₹${money(total - discount).toFixed(2)}${payload.dueDate ? `, due ${payload.dueDate}` : ""}.`
      });
      return { id: rows[0].id, installments: schedule.length };
    } catch (error) {
      if (error.code === "23505") throw conflict("This fee is already assigned to the student");
      if (error.code === "23514") throw badRequest("Check the fee amount, discount and due date");
      throw error;
    }
  }

  async function recordPayment(feeId, payload, user, ip) {
    const amount = money(payload.amount);
    const requestId = payload.requestId?.trim() || null;
    const referenceInput = nullIfEmpty(payload.reference);
    const notesInput = nullIfEmpty(payload.notes);
    const paidAtInput = nullIfEmpty(payload.paidAt);

    /** Does an existing idempotent payment describe this same request? */
    const matchesRequest = (row) =>
      row.student_fee_id === feeId &&
      money(row.amount) === amount &&
      row.method === payload.method &&
      (row.reference ?? null) === referenceInput &&
      (row.notes ?? null) === notesInput &&
      (!paidAtInput || new Date(row.paid_at).getTime() === new Date(paidAtInput).getTime());

    /** The stored receipt plus the invoice's current money state. */
    async function replayReceipt(row) {
      const { rows: paidRows } = await db.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payments
         WHERE student_fee_id = $1 AND voided_at IS NULL`,
        [feeId]
      );
      const { rows: feeRows } = await db.query("SELECT net_amount FROM student_fees WHERE id = $1", [feeId]);
      const paid = money(paidRows[0]?.paid);
      const net = money(feeRows[0]?.net_amount);
      return {
        id: row.id,
        receiptNo: row.receipt_no,
        paidAt: row.paid_at,
        amount: money(row.amount),
        status: paid >= net ? "paid" : paid > 0 ? "partial" : "pending",
        paidAmount: paid,
        pendingAmount: Math.max(0, money(net - paid)),
        replayed: true
      };
    }

    if (requestId) {
      const existing = await db.one("SELECT * FROM payments WHERE request_id = $1", [requestId]);
      if (existing) {
        if (!matchesRequest(existing)) {
          throw conflict("This payment request was already used with different details");
        }
        return replayReceipt(existing);
      }
    }

    const receiptNo = `RCPT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    let payment;
    try {
      payment = await db.transaction(async (tx) => {
        // Lock the invoice: two clerks taking cash at the same moment must not both
        // pass the pending-amount check and overpay the same fee.
        const { rows: feeRows } = await tx.query(
          `SELECT id, student_id, net_amount, status FROM student_fees WHERE id = $1 FOR UPDATE`,
          [feeId]
        );
        const fee = feeRows[0];
        if (!fee) throw notFound("Fee not found");
        if (fee.status === "waived") throw badRequest("This fee has been waived");

        const { rows: paidRows } = await tx.query(
          `SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payments
           WHERE student_fee_id = $1 AND voided_at IS NULL`,
          [feeId]
        );
        const paid = money(paidRows[0].paid);
        const net = money(fee.net_amount);
        const pending = Math.max(0, money(net - paid));
        if (amount > pending) throw badRequest(`The pending amount is ₹${pending.toFixed(2)}`);

        const { rows } = await tx.query(
          `INSERT INTO payments (receipt_no, student_fee_id, student_id, amount, method, paid_at, reference, notes, recorded_by, request_id)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8, $9, $10)
           RETURNING id, receipt_no, paid_at`,
          [
            receiptNo,
            feeId,
            fee.student_id,
            amount,
            payload.method,
            paidAtInput,
            referenceInput,
            notesInput,
            user.id,
            requestId
          ]
        );
        const newPaid = money(paid + amount);
        const status = newPaid >= net ? "paid" : newPaid > 0 ? "partial" : "pending";
        await tx.query("UPDATE student_fees SET status = $2, updated_at = now() WHERE id = $1", [feeId, status]);
        return { ...rows[0], status, paidAmount: newPaid, pendingAmount: Math.max(0, money(net - newPaid)) };
      });
    } catch (error) {
      // A concurrent retry with the same key lost the unique-index race: return the
      // receipt the winner created (or reject a different payload for that key).
      if (error.code === "23505" && requestId) {
        const existing = await db.one("SELECT * FROM payments WHERE request_id = $1", [requestId]);
        if (existing) {
          if (!matchesRequest(existing)) {
            throw conflict("This payment request was already used with different details");
          }
          return replayReceipt(existing);
        }
      }
      throw error;
    }

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "payment.recorded",
      entityType: "student_fee",
      entityId: feeId,
      metadata: { paymentId: payment.id, amount, method: payload.method, requestId },
      ip
    });

    return {
      id: payment.id,
      receiptNo: payment.receipt_no,
      paidAt: payment.paid_at,
      amount,
      status: payment.status,
      paidAmount: payment.paidAmount,
      pendingAmount: payment.pendingAmount,
      replayed: false
    };
  }

  /**
   * A receipt written by mistake is voided, never deleted: the number stays on
   * record, the money stops counting, and the invoice re-opens by itself.
   */
  async function voidPayment(paymentId, payload, user, ip) {
    const result = await db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT p.id, p.receipt_no, p.amount, p.voided_at, p.student_fee_id, sf.net_amount, sf.status AS fee_status
         FROM payments p JOIN student_fees sf ON sf.id = p.student_fee_id
         WHERE p.id = $1 FOR UPDATE OF p`,
        [paymentId]
      );
      const payment = rows[0];
      if (!payment) throw notFound("Payment not found");
      if (payment.voided_at) throw conflict("This payment is already void");

      await tx.query(
        `UPDATE payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
        [paymentId, user.id, nullIfEmpty(payload.reason)]
      );

      const { rows: paidRows } = await tx.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payments
         WHERE student_fee_id = $1 AND voided_at IS NULL`,
        [payment.student_fee_id]
      );
      const paid = money(paidRows[0].paid);
      const net = money(payment.net_amount);
      const status =
        payment.fee_status === "waived" ? "waived" : paid >= net ? "paid" : paid > 0 ? "partial" : "pending";
      await tx.query("UPDATE student_fees SET status = $2, updated_at = now() WHERE id = $1", [
        payment.student_fee_id,
        status
      ]);

      return {
        id: paymentId,
        receiptNo: payment.receipt_no,
        amount: money(payment.amount),
        status,
        paidAmount: paid,
        pendingAmount: Math.max(0, money(net - paid))
      };
    });

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "payment.voided",
      entityType: "student_fee",
      entityId: result.id,
      metadata: { receiptNo: result.receiptNo, amount: result.amount, reason: payload.reason },
      ip
    });
    return result;
  }

  async function waiveFee(feeId, payload, user, ip) {
    const fee = await db.one(
      `SELECT sf.id, sf.status,
              COALESCE((SELECT SUM(amount) FROM payments WHERE student_fee_id = sf.id AND voided_at IS NULL), 0)::numeric AS paid
       FROM student_fees sf WHERE sf.id = $1`,
      [feeId]
    );
    if (!fee) throw notFound("Fee not found");
    if (fee.status === "waived") throw conflict("This fee is already waived");
    if (money(fee.paid) > 0) {
      throw badRequest("Money has already been collected on this fee. Void the payments instead of waiving it.");
    }

    await db.query(
      `UPDATE student_fees SET status = 'waived', waived_at = now(), waived_by = $2,
              waiver_reason = $3, updated_at = now() WHERE id = $1`,
      [feeId, user.id, payload.reason]
    );
    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "student_fee.waived",
      entityType: "student_fee",
      entityId: feeId,
      metadata: { reason: payload.reason },
      ip
    });
    return { id: feeId, status: "waived", reason: payload.reason };
  }

  async function updateStudentFee(feeId, payload, user, ip) {
    const fee = await db.one(
      `SELECT sf.id, sf.total_amount, sf.discount_amount, sf.net_amount, sf.due_date, sf.status,
              COALESCE((SELECT SUM(amount) FROM payments WHERE student_fee_id = sf.id AND voided_at IS NULL), 0)::numeric AS paid
       FROM student_fees sf WHERE sf.id = $1`,
      [feeId]
    );
    if (!fee) throw notFound("Fee not found");
    if (fee.status === "waived") throw badRequest("This fee has been waived");

    const total = money(fee.total_amount);
    const discount =
      payload.discountAmount !== undefined ? money(payload.discountAmount) : money(fee.discount_amount);
    if (discount > total) throw badRequest("Discount cannot exceed the fee amount");
    const net = money(total - discount);
    const paid = money(fee.paid);
    if (net < paid) {
      throw badRequest(`₹${paid.toFixed(2)} has already been collected, so the payable amount cannot go below that`);
    }

    const status = paid >= net ? "paid" : paid > 0 ? "partial" : "pending";
    const sets = [];
    const values = [];
    if (payload.discountAmount !== undefined) {
      sets.push(`discount_amount = $${sets.length + 1}`, `net_amount = $${sets.length + 2}`);
      values.push(discount, net);
    }
    if (payload.dueDate !== undefined) {
      sets.push(`due_date = $${sets.length + 1}`);
      values.push(nullIfEmpty(payload.dueDate));
    }
    if (payload.notes !== undefined) {
      sets.push(`notes = $${sets.length + 1}`);
      values.push(nullIfEmpty(payload.notes));
    }
    sets.push(`status = $${sets.length + 1}`);
    values.push(status);
    values.push(feeId);

    await db.query(
      `UPDATE student_fees SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
    if (payload.discountAmount !== undefined) {
      const existing = await db.one("SELECT count(*)::int AS count FROM fee_installments WHERE student_fee_id = $1", [
        feeId
      ]);
      await replaceSchedule(db, feeId, net, num(existing.count) || 1, nullIfEmpty(payload.dueDate) ?? fee.due_date);
    }

    await audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: "student_fee.updated",
      entityType: "student_fee",
      entityId: feeId,
      metadata: { fields: Object.keys(payload), status },
      ip
    });
    return { id: feeId, discountAmount: discount, netAmount: net, status };
  }

  /** Everything a printed receipt needs, in one read. */
  async function paymentReceipt(paymentId) {
    const row = await db.one(
      `SELECT p.id, p.receipt_no, p.amount, p.method, p.paid_at, p.reference, p.notes,
              p.voided_at, p.void_reason,
              u.full_name, u.email, sp.enrollment_no,
              fs.name AS structure_name, fs.academic_year,
              c.name AS course_name, sf.net_amount, sf.due_date,
              COALESCE((SELECT SUM(amount) FROM payments WHERE student_fee_id = sf.id AND voided_at IS NULL), 0)::numeric AS paid_amount
       FROM payments p
       JOIN users u ON u.id = p.student_id
       JOIN student_profiles sp ON sp.user_id = p.student_id
       JOIN student_fees sf ON sf.id = p.student_fee_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       JOIN courses c ON c.id = fs.course_id
       WHERE p.id = $1`,
      [paymentId]
    );
    if (!row) throw notFound("Payment not found");

    const net = money(row.net_amount);
    const paid = money(row.paid_amount);
    return {
      id: row.id,
      receiptNo: row.receipt_no,
      amount: money(row.amount),
      method: row.method,
      paidAt: row.paid_at,
      reference: row.reference,
      notes: row.notes,
      voidedAt: row.voided_at,
      voidReason: row.void_reason,
      studentName: row.full_name,
      studentEmail: row.email,
      enrollmentNo: row.enrollment_no,
      structureName: row.structure_name,
      academicYear: row.academic_year,
      courseName: row.course_name,
      netAmount: net,
      paidAmount: paid,
      pendingAmount: Math.max(0, money(net - paid)),
      dueDate: row.due_date
    };
  }

  /** Overdue invoices with a ready-to-send reminder message. */
  async function listReminders({ page = 1, pageSize = 20, batchId } = {}) {
    const params = [];
    const where = ["sf.status <> 'waived'", "sf.due_date IS NOT NULL", "sf.due_date < current_date"];
    if (batchId) {
      params.push(batchId);
      where.push(
        `EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = sf.student_id AND e.batch_id = $${params.length} AND e.status = 'active')`
      );
    }
    const whereSql = `WHERE ${where.join(" AND ")} AND sf.net_amount - COALESCE(p.paid, 0) > 0`;

    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM student_fees sf
         LEFT JOIN ${PAID_TOTALS} p ON p.student_fee_id = sf.id ${whereSql}`,
        params
      )
    ).count;

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT sf.id, u.full_name, u.email, sp.enrollment_no, fs.name AS structure_name,
              (sf.net_amount - COALESCE(p.paid, 0))::numeric AS pending,
              sf.due_date, (current_date - sf.due_date)::int AS days_overdue
       FROM student_fees sf
       JOIN users u ON u.id = sf.student_id
       JOIN student_profiles sp ON sp.user_id = sf.student_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       LEFT JOIN ${PAID_TOTALS} p ON p.student_fee_id = sf.id
       ${whereSql}
       ORDER BY sf.due_date, u.full_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => {
        const pending = money(row.pending);
        return {
          feeId: row.id,
          fullName: row.full_name,
          email: row.email,
          enrollmentNo: row.enrollment_no,
          structureName: row.structure_name,
          pendingAmount: pending,
          dueDate: row.due_date,
          daysOverdue: num(row.days_overdue),
          message: `Dear ${row.full_name}, ₹${pending.toFixed(2)} for ${row.structure_name} was due on ${row.due_date}. Please pay at the office or on the portal. — Coaching Institute`
        };
      }),
      page,
      pageSize,
      total: num(total)
    };
  }

  async function listPayments({ page = 1, pageSize = 20, search } = {}) {
    const params = [];
    const where = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.receipt_no ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (
      await db.one(
        `SELECT count(*)::int AS count FROM payments p JOIN users u ON u.id = p.student_id ${whereSql}`,
        params
      )
    ).count;
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await db.many(
      `SELECT p.id, p.receipt_no, p.amount, p.method, p.paid_at, p.reference, p.notes,
              p.voided_at, p.void_reason,
              u.full_name, sp.enrollment_no, fs.name AS structure_name
       FROM payments p
       JOIN users u ON u.id = p.student_id
       JOIN student_profiles sp ON sp.user_id = p.student_id
       JOIN student_fees sf ON sf.id = p.student_fee_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       ${whereSql}
       ORDER BY p.paid_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        receiptNo: row.receipt_no,
        amount: money(row.amount),
        method: row.method,
        paidAt: row.paid_at,
        reference: row.reference,
        notes: row.notes,
        voidedAt: row.voided_at,
        voidReason: row.void_reason,
        fullName: row.full_name,
        enrollmentNo: row.enrollment_no,
        structureName: row.structure_name
      })),
      page,
      pageSize,
      total: num(total)
    };
  }

  /* ----------------------------------------------------------- student view */
  async function studentFees(studentId) {
    const rows = await db.many(
      `SELECT sf.id, sf.total_amount, sf.discount_amount, sf.net_amount, sf.due_date, sf.status, sf.notes,
              fs.name AS structure_name, fs.academic_year, c.name AS course_name,
              COALESCE(p.paid, 0)::numeric AS paid_amount
       FROM student_fees sf
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       JOIN courses c ON c.id = fs.course_id
       LEFT JOIN ${PAID_TOTALS} p ON p.student_fee_id = sf.id
       WHERE sf.student_id = $1
       ORDER BY sf.due_date NULLS LAST, sf.created_at DESC`,
      [studentId]
    );

    const payments = await db.many(
      `SELECT p.id, p.receipt_no, p.amount, p.method, p.paid_at, p.reference, fs.name AS structure_name
       FROM payments p
       JOIN student_fees sf ON sf.id = p.student_fee_id
       JOIN fee_structures fs ON fs.id = sf.fee_structure_id
       WHERE p.student_id = $1
       ORDER BY p.paid_at DESC`,
      [studentId]
    );

    const installmentRows = await db.many(
      `SELECT i.student_fee_id, i.seq, i.amount, i.due_date
       FROM fee_installments i
       JOIN student_fees sf ON sf.id = i.student_fee_id
       WHERE sf.student_id = $1
       ORDER BY i.student_fee_id, i.seq`,
      [studentId]
    );
    const today = new Date().toISOString().slice(0, 10);

    const invoices = rows.map((row) => {
      const net = money(row.net_amount);
      const paid = money(row.paid_amount);

      // Instalments are paid down in order from the money actually collected.
      let unallocated = paid;
      const installments = installmentRows
        .filter((installment) => installment.student_fee_id === row.id)
        .map((installment) => {
          const amount = money(installment.amount);
          const covered = Math.min(amount, Math.max(0, unallocated));
          unallocated = money(unallocated - covered);
          const due = installment.due_date ? String(installment.due_date).slice(0, 10) : null;
          const status =
            covered >= amount ? "paid" : due && due < today ? "overdue" : covered > 0 ? "partial" : "upcoming";
          return {
            seq: installment.seq,
            amount,
            dueDate: installment.due_date,
            paidAmount: money(covered),
            status
          };
        });

      return {
        id: row.id,
        structureName: row.structure_name,
        academicYear: row.academic_year,
        courseName: row.course_name,
        totalAmount: money(row.total_amount),
        discountAmount: money(row.discount_amount),
        netAmount: net,
        paidAmount: paid,
        pendingAmount: Math.max(0, money(net - paid)),
        dueDate: row.due_date,
        status: row.status,
        notes: row.notes,
        installments
      };
    });
    const billable = invoices.filter((invoice) => invoice.status !== "waived");
    const billed = billable.reduce((sum, invoice) => sum + invoice.netAmount, 0);
    const paid = billable.reduce((sum, invoice) => sum + invoice.paidAmount, 0);

    return {
      summary: {
        billed: money(billed),
        paid: money(paid),
        pending: Math.max(0, money(billed - paid)),
        openInvoices: billable.filter((invoice) => invoice.pendingAmount > 0).length
      },
      invoices,
      payments: payments.map((row) => ({
        id: row.id,
        receiptNo: row.receipt_no,
        amount: money(row.amount),
        method: row.method,
        paidAt: row.paid_at,
        reference: row.reference,
        structureName: row.structure_name
      }))
    };
  }

  return {
    listStructures,
    createStructure,
    updateStructure,
    listDues,
    assignFee,
    recordPayment,
    voidPayment,
    waiveFee,
    updateStudentFee,
    paymentReceipt,
    listReminders,
    listPayments,
    studentFees
  };
}
