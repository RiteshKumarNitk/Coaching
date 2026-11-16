import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { feeService } from "../../services/fees.service.js";
import { adminService } from "../../services/admin.service.js";
import { useCourses } from "../../hooks/useAdminLookups.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format.js";

const statusTone = (status) =>
  status === "paid" ? "success" : status === "partial" ? "warning" : status === "waived" ? "neutral" : "danger";

const TABS = [
  { id: "dues", label: "Dues" },
  { id: "structures", label: "Fee structures" },
  { id: "payments", label: "Receipts" },
  { id: "reminders", label: "Reminders" }
];

export function FeesPage() {
  useDocumentTitle("Fees");
  const queryClient = useQueryClient();
  const coursesQuery = useCourses();
  const [tab, setTab] = useState("dues");
  const [page, setPage] = useState(1);

  const [payingFee, setPayingFee] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "cash", reference: "", notes: "" });
  const [waivingFee, setWaivingFee] = useState(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [voidingPayment, setVoidingPayment] = useState(null);
  const [voidReason, setVoidReason] = useState("");
  const [receiptId, setReceiptId] = useState(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({
    studentId: "",
    feeStructureId: "",
    discountAmount: "",
    dueDate: "",
    notes: ""
  });
  const [studentSearch, setStudentSearch] = useState("");
  const [structureSearch, setStructureSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedStructure, setSelectedStructure] = useState(null);
  const debouncedStudentSearch = useDebouncedValue(studentSearch);
  const debouncedStructureSearch = useDebouncedValue(structureSearch);

  const [structureOpen, setStructureOpen] = useState(false);
  const [structureForm, setStructureForm] = useState({
    courseId: "",
    name: "",
    academicYear: "2026-27",
    totalAmount: "",
    installments: 1
  });

  const duesQuery = useQuery({
    queryKey: ["admin", "fees", "dues", page],
    queryFn: () => feeService.dues({ page, pageSize: 20 }),
    enabled: tab === "dues"
  });

  const structuresQuery = useQuery({
    queryKey: ["admin", "fees", "structures", page],
    queryFn: () => feeService.structures({ page, pageSize: 20 })
  });

  const paymentsQuery = useQuery({
    queryKey: ["admin", "fees", "payments", page],
    queryFn: () => feeService.payments({ page, pageSize: 20 }),
    enabled: tab === "payments"
  });

  const remindersQuery = useQuery({
    queryKey: ["admin", "fees", "reminders"],
    queryFn: () => feeService.reminders({ pageSize: 50 }),
    enabled: tab === "reminders"
  });

  const receiptQuery = useQuery({
    queryKey: ["admin", "fees", "receipt", receiptId],
    queryFn: () => feeService.receipt(receiptId),
    enabled: Boolean(receiptId)
  });

  // Server-side search, so the picker is not limited to whatever page the table shows.
  const assignStudentsQuery = useQuery({
    queryKey: ["admin", "students", "fee-lookup", debouncedStudentSearch],
    queryFn: () => adminService.students({ search: debouncedStudentSearch || undefined, pageSize: 50 }),
    select: (data) => data.items,
    enabled: assignOpen
  });

  const assignStructuresQuery = useQuery({
    queryKey: ["admin", "fees", "structures", "lookup", debouncedStructureSearch],
    queryFn: () =>
      feeService.structures({ search: debouncedStructureSearch || undefined, status: "active", pageSize: 50 }),
    select: (data) => data.items,
    enabled: assignOpen
  });

  // Keep the chosen row visible even after the search text changes underneath it.
  const studentOptions = useMemo(() => {
    const items = assignStudentsQuery.data ?? [];
    return selectedStudent && !items.some((item) => item.id === selectedStudent.id)
      ? [selectedStudent, ...items]
      : items;
  }, [assignStudentsQuery.data, selectedStudent]);

  const structureChoices = useMemo(() => {
    const items = assignStructuresQuery.data ?? [];
    return selectedStructure && !items.some((item) => item.id === selectedStructure.id)
      ? [selectedStructure, ...items]
      : items;
  }, [assignStructuresQuery.data, selectedStructure]);

  const resetAssignForm = () => {
    setAssignForm({ studentId: "", feeStructureId: "", discountAmount: "", dueDate: "", notes: "" });
    setStudentSearch("");
    setStructureSearch("");
    setSelectedStudent(null);
    setSelectedStructure(null);
    assignMutation.reset();
  };

  const invalidateFees = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "fees"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
  };

  const paymentMutation = useMutation({
    mutationFn: () => feeService.recordPayment(payingFee.id, { ...paymentForm, amount: Number(paymentForm.amount) }),
    onSuccess: () => {
      setPayingFee(null);
      setPaymentForm({ amount: "", method: "cash", reference: "", notes: "" });
      invalidateFees();
    }
  });

  const waiveMutation = useMutation({
    mutationFn: () => feeService.waive(waivingFee.id, { reason: waiveReason }),
    onSuccess: () => {
      setWaivingFee(null);
      setWaiveReason("");
      invalidateFees();
    }
  });

  const voidMutation = useMutation({
    mutationFn: () => feeService.voidPayment(voidingPayment.id, { reason: voidReason }),
    onSuccess: () => {
      setVoidingPayment(null);
      setVoidReason("");
      invalidateFees();
    }
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      feeService.assign({
        ...assignForm,
        discountAmount: assignForm.discountAmount === "" ? 0 : Number(assignForm.discountAmount)
      }),
    onSuccess: () => {
      setAssignOpen(false);
      resetAssignForm();
      invalidateFees();
    }
  });

  const structureMutation = useMutation({
    mutationFn: () =>
      feeService.createStructure({
        ...structureForm,
        totalAmount: Number(structureForm.totalAmount),
        installments: Number(structureForm.installments) || 1
      }),
    onSuccess: () => {
      setStructureOpen(false);
      setStructureForm({ courseId: "", name: "", academicYear: "2026-27", totalAmount: "", installments: 1 });
      invalidateFees();
    }
  });

  const summary = duesQuery.data?.summary;
  const structureOptions = structuresQuery.data?.items ?? [];

  return (
    <div className="page-section">
      <PageHeader
        title="Fees"
        description="Fee structures, student dues and offline receipts."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                resetAssignForm();
                setAssignOpen(true);
              }}
            >
              Assign fee
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setStructureOpen(true)}>
              New structure
            </button>
          </div>
        }
      />

      {duesQuery.isError || structuresQuery.isError || paymentsQuery.isError ? (
        <ErrorState
          error={duesQuery.error ?? structuresQuery.error ?? paymentsQuery.error}
          onRetry={() => {
            duesQuery.refetch();
            structuresQuery.refetch();
            paymentsQuery.refetch();
          }}
        />
      ) : null}

      {summary ? (
        <div className="grid-3">
          <div className="card">
            <div className="card__body">
              <p className="small muted">Billed</p>
              <p className="card__title">{formatCurrency(summary.billed)}</p>
            </div>
          </div>
          <div className="card">
            <div className="card__body">
              <p className="small muted">Collected</p>
              <p className="card__title">{formatCurrency(summary.collected)}</p>
            </div>
          </div>
          <div className="card">
            <div className="card__body">
              <p className="small muted">Pending</p>
              <p className="card__title">{formatCurrency(summary.pending)}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Fee views">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "tabs__tab is-active" : "tabs__tab"}
            onClick={() => {
              setTab(item.id);
              setPage(1);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "dues" ? (
        <SectionCard title="Student dues" subtitle={duesQuery.data ? `${duesQuery.data.total} invoice(s)` : undefined}>
          <DataTable
            columns={[
              {
                key: "student",
                header: "Student",
                render: (row) => (
                  <div>
                    <p className="cell-primary">{row.fullName}</p>
                    <p className="cell-sub">{row.enrollmentNo}</p>
                  </div>
                )
              },
              {
                key: "fee",
                header: "Fee",
                render: (row) => (
                  <div>
                    <p>{row.structureName}</p>
                    <p className="cell-sub">
                      {row.courseName} · {row.academicYear}
                    </p>
                  </div>
                )
              },
              { key: "net", header: "Net", render: (row) => formatCurrency(row.netAmount) },
              { key: "paid", header: "Paid", render: (row) => formatCurrency(row.paidAmount) },
              { key: "pending", header: "Pending", render: (row) => formatCurrency(row.pendingAmount) },
              { key: "due", header: "Due", render: (row) => (row.dueDate ? formatDate(row.dueDate) : "—") },
              {
                key: "plan",
                header: "Plan",
                render: (row) =>
                  row.installmentCount > 1 ? <Badge>{row.installmentCount} instalments</Badge> : "—"
              },
              { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <div className="cell-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={row.pendingAmount <= 0 || row.status === "waived"}
                      onClick={() => {
                        paymentMutation.reset();
                        setPaymentForm({ amount: String(row.pendingAmount), method: "cash", reference: "", notes: "" });
                        setPayingFee(row);
                      }}
                    >
                      Record payment
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={row.status === "waived"}
                      onClick={() => {
                        waiveMutation.reset();
                        setWaiveReason("");
                        setWaivingFee(row);
                      }}
                    >
                      Waive
                    </button>
                  </div>
                )
              }
            ]}
            rows={duesQuery.data?.items}
            loading={duesQuery.isPending}
            rowKey="id"
            empty={<EmptyState icon={Wallet} title="No dues assigned" description="Assign a fee structure to a student to start billing." />}
          />
          <Pagination page={page} pageSize={20} total={duesQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      {tab === "structures" ? (
        <SectionCard title="Fee structures" subtitle="Per course and academic year">
          <DataTable
            columns={[
              {
                key: "name",
                header: "Structure",
                render: (row) => (
                  <div>
                    <p className="cell-primary">{row.name}</p>
                    <p className="cell-sub">
                      {row.courseName} · {row.academicYear}
                    </p>
                  </div>
                )
              },
              { key: "total", header: "Total", render: (row) => formatCurrency(row.totalAmount) },
              { key: "installments", header: "Instalments", render: (row) => row.installments },
              { key: "assigned", header: "Assigned", render: (row) => row.assignedCount },
              { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> }
            ]}
            rows={structuresQuery.data?.items}
            loading={structuresQuery.isPending}
            rowKey="id"
            empty={<EmptyState icon={Wallet} title="No fee structures" description="Create a structure to assign fees." />}
          />
          <Pagination page={page} pageSize={20} total={structuresQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      {tab === "payments" ? (
        <SectionCard title="Receipts" subtitle="Offline payments recorded by the office">
          <DataTable
            columns={[
              {
                key: "student",
                header: "Student",
                render: (row) => (
                  <div>
                    <p className="cell-primary">{row.fullName}</p>
                    <p className="cell-sub">{row.enrollmentNo}</p>
                  </div>
                )
              },
              {
                key: "receipt",
                header: "Receipt",
                render: (row) => (
                  <div>
                    <span className="mono small">{row.receiptNo}</span>
                    {row.voidedAt ? (
                      <p className="cell-sub">
                        <Badge tone="danger">void</Badge> {row.voidReason}
                      </p>
                    ) : null}
                  </div>
                )
              },
              { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
              { key: "method", header: "Method", render: (row) => row.method.replaceAll("_", " ") },
              { key: "paidAt", header: "Paid", render: (row) => formatDateTime(row.paidAt) },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <div className="cell-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setReceiptId(row.id)}
                    >
                      Receipt
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={Boolean(row.voidedAt)}
                      onClick={() => {
                        voidMutation.reset();
                        setVoidReason("");
                        setVoidingPayment(row);
                      }}
                    >
                      Void
                    </button>
                  </div>
                )
              }
            ]}
            rows={paymentsQuery.data?.items}
            loading={paymentsQuery.isPending}
            rowKey="id"
            empty={<EmptyState icon={Wallet} title="No payments yet" description="Receipts appear as the office records payments." />}
          />
          <Pagination page={page} pageSize={20} total={paymentsQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      <Modal
        open={Boolean(payingFee)}
        title="Record payment"
        description={payingFee ? `${payingFee.fullName} · pending ${formatCurrency(payingFee.pendingAmount)}` : undefined}
        onClose={() => setPayingFee(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setPayingFee(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={paymentMutation.isPending || !paymentForm.amount}
              onClick={() => paymentMutation.mutate()}
            >
              {paymentMutation.isPending ? "Saving…" : "Save receipt"}
            </button>
          </>
        }
      >
        {paymentMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {paymentMutation.error.message}
          </div>
        ) : null}
        <div className="form-grid">
          <FormField label="Amount received" htmlFor="pay-amount" required>
            <input
              id="pay-amount"
              className="input"
              type="number"
              min="1"
              value={paymentForm.amount}
              onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </FormField>
          <FormField label="Method" htmlFor="pay-method">
            <select
              id="pay-method"
              className="input"
              value={paymentForm.method}
              onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))}
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Reference" htmlFor="pay-ref" hint="UPI id, cheque number, etc.">
            <input
              id="pay-ref"
              className="input"
              value={paymentForm.reference}
              onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))}
            />
          </FormField>
          <FormField label="Notes" htmlFor="pay-notes">
            <input
              id="pay-notes"
              className="input"
              value={paymentForm.notes}
              onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={assignOpen}
        title="Assign fee to student"
        onClose={() => {
          setAssignOpen(false);
          resetAssignForm();
        }}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAssignOpen(false);
                resetAssignForm();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={assignMutation.isPending || !assignForm.studentId || !assignForm.feeStructureId}
              onClick={() => assignMutation.mutate()}
            >
              {assignMutation.isPending ? "Saving…" : "Assign fee"}
            </button>
          </>
        }
      >
        {assignMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {assignMutation.error.message}
          </div>
        ) : null}
        <div className="form-grid">
          <FormField label="Student" htmlFor="assign-student" required full hint="Searches every student, not just the current page">
            <input
              id="assign-student-search"
              className="input"
              type="search"
              placeholder="Search by name, email or enrolment number"
              value={studentSearch}
              onChange={(event) => setStudentSearch(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <select
              id="assign-student"
              className="input"
              value={assignForm.studentId}
              onChange={(event) => {
                setSelectedStudent(studentOptions.find((student) => student.id === event.target.value) ?? null);
                setAssignForm((current) => ({ ...current, studentId: event.target.value }));
              }}
            >
              <option value="">{assignStudentsQuery.isPending ? "Loading students…" : "Select a student"}</option>
              {studentOptions.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.fullName} ({student.enrollmentNo})
                </option>
              ))}
            </select>
            {!assignStudentsQuery.isPending && studentOptions.length === 0 ? (
              <p className="help">No students match “{debouncedStudentSearch}”.</p>
            ) : null}
          </FormField>
          <FormField
            label="Fee structure"
            htmlFor="assign-structure"
            required
            full
            hint="Active structures only; a student can only be billed for their own course"
          >
            <input
              id="assign-structure-search"
              className="input"
              type="search"
              placeholder="Search by name or academic year"
              value={structureSearch}
              onChange={(event) => setStructureSearch(event.target.value)}
              style={{ marginBottom: 8 }}
            />
            <select
              id="assign-structure"
              className="input"
              value={assignForm.feeStructureId}
              onChange={(event) => {
                setSelectedStructure(structureChoices.find((item) => item.id === event.target.value) ?? null);
                setAssignForm((current) => ({ ...current, feeStructureId: event.target.value }));
              }}
            >
              <option value="">{assignStructuresQuery.isPending ? "Loading structures…" : "Select a structure"}</option>
              {structureChoices.map((structure) => (
                <option key={structure.id} value={structure.id}>
                  {structure.name} · {structure.courseName} · {formatCurrency(structure.totalAmount)}
                </option>
              ))}
            </select>
            {!assignStructuresQuery.isPending && structureChoices.length === 0 ? (
              <p className="help">
                {debouncedStructureSearch
                  ? `No active structures match “${debouncedStructureSearch}”.`
                  : "No active fee structures yet — create one first."}
              </p>
            ) : null}
          </FormField>
          <FormField label="Discount" htmlFor="assign-discount">
            <input
              id="assign-discount"
              className="input"
              type="number"
              min="0"
              value={assignForm.discountAmount}
              onChange={(event) => setAssignForm((current) => ({ ...current, discountAmount: event.target.value }))}
            />
          </FormField>
          <FormField label="Due date" htmlFor="assign-due">
            <input
              id="assign-due"
              className="input"
              type="date"
              value={assignForm.dueDate}
              onChange={(event) => setAssignForm((current) => ({ ...current, dueDate: event.target.value }))}
            />
          </FormField>
          <FormField label="Notes" htmlFor="assign-notes" full>
            <input
              id="assign-notes"
              className="input"
              value={assignForm.notes}
              onChange={(event) => setAssignForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        open={structureOpen}
        title="New fee structure"
        onClose={() => setStructureOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setStructureOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={structureMutation.isPending || !structureForm.courseId || !structureForm.totalAmount}
              onClick={() => structureMutation.mutate()}
            >
              {structureMutation.isPending ? "Saving…" : "Create structure"}
            </button>
          </>
        }
      >
        {structureMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {structureMutation.error.message}
          </div>
        ) : null}
        <div className="form-grid">
          <FormField label="Course" htmlFor="struct-course" required>
            <select
              id="struct-course"
              className="input"
              value={structureForm.courseId}
              onChange={(event) => setStructureForm((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Select a course</option>
              {(coursesQuery.data ?? []).map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} ({course.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Name" htmlFor="struct-name" required>
            <input
              id="struct-name"
              className="input"
              value={structureForm.name}
              onChange={(event) => setStructureForm((current) => ({ ...current, name: event.target.value }))}
            />
          </FormField>
          <FormField label="Academic year" htmlFor="struct-year" required>
            <input
              id="struct-year"
              className="input"
              value={structureForm.academicYear}
              onChange={(event) => setStructureForm((current) => ({ ...current, academicYear: event.target.value }))}
            />
          </FormField>
          <FormField label="Total amount" htmlFor="struct-total" required>
            <input
              id="struct-total"
              className="input"
              type="number"
              min="0"
              value={structureForm.totalAmount}
              onChange={(event) => setStructureForm((current) => ({ ...current, totalAmount: event.target.value }))}
            />
          </FormField>
          <FormField label="Instalments" htmlFor="struct-installments">
            <input
              id="struct-installments"
              className="input"
              type="number"
              min="1"
              max="12"
              value={structureForm.installments}
              onChange={(event) => setStructureForm((current) => ({ ...current, installments: event.target.value }))}
            />
          </FormField>
        </div>
      </Modal>

      {tab === "reminders" ? (
        <SectionCard title="Overdue reminders" subtitle="Invoices past their due date with money still pending">
          {remindersQuery.isError ? (
            <ErrorState error={remindersQuery.error} onRetry={remindersQuery.refetch} />
          ) : (
            <DataTable
              columns={[
                {
                  key: "student",
                  header: "Student",
                  render: (row) => (
                    <div>
                      <p className="cell-primary">{row.fullName}</p>
                      <p className="cell-sub">
                        {row.enrollmentNo} · {row.email}
                      </p>
                    </div>
                  )
                },
                { key: "fee", header: "Fee", render: (row) => row.structureName },
                { key: "pending", header: "Pending", render: (row) => formatCurrency(row.pendingAmount) },
                { key: "due", header: "Due", render: (row) => formatDate(row.dueDate) },
                {
                  key: "overdue",
                  header: "Overdue",
                  render: (row) => <Badge tone="danger">{row.daysOverdue} day(s)</Badge>
                },
                {
                  key: "message",
                  header: "Message",
                  render: (row) => (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => navigator.clipboard?.writeText(row.message)}
                    >
                      Copy reminder
                    </button>
                  )
                }
              ]}
              rows={remindersQuery.data?.items}
              loading={remindersQuery.isPending}
              empty={<EmptyState icon={Wallet} title="Nothing overdue" description="Every invoice is either paid or not due yet." />}
            />
          )}
        </SectionCard>
      ) : null}

      <Modal
        open={Boolean(waivingFee)}
        title="Waive this fee?"
        description={waivingFee ? `${waivingFee.fullName} · ${formatCurrency(waivingFee.pendingAmount)} pending` : undefined}
        onClose={() => setWaivingFee(null)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setWaivingFee(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={waiveMutation.isPending || waiveReason.trim().length < 3}
              onClick={() => waiveMutation.mutate()}
            >
              {waiveMutation.isPending ? "Saving…" : "Waive fee"}
            </button>
          </>
        }
      >
        {waiveMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {waiveMutation.error.message}
          </div>
        ) : null}
        <p className="small muted">
          Waiving cancels the balance for this invoice. Money already collected must be voided first.
        </p>
        <FormField label="Reason" htmlFor="waive-reason" required>
          <textarea
            id="waive-reason"
            className="input"
            rows={3}
            value={waiveReason}
            onChange={(event) => setWaiveReason(event.target.value)}
            placeholder="Staff ward, scholarship approved by the director…"
          />
        </FormField>
      </Modal>

      <Modal
        open={Boolean(voidingPayment)}
        title="Void this receipt?"
        description={voidingPayment ? `${voidingPayment.receiptNo} · ${formatCurrency(voidingPayment.amount)}` : undefined}
        onClose={() => setVoidingPayment(null)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setVoidingPayment(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={voidMutation.isPending || voidReason.trim().length < 3}
              onClick={() => voidMutation.mutate()}
            >
              {voidMutation.isPending ? "Saving…" : "Void receipt"}
            </button>
          </>
        }
      >
        {voidMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {voidMutation.error.message}
          </div>
        ) : null}
        <p className="small muted">
          The receipt stays on record and stops counting towards the invoice. Record a fresh payment if the money is
          collected again.
        </p>
        <FormField label="Reason" htmlFor="void-reason" required>
          <textarea
            id="void-reason"
            className="input"
            rows={3}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Cheque bounced, entry made twice…"
          />
        </FormField>
      </Modal>

      <Modal
        open={Boolean(receiptId)}
        title="Fee receipt"
        onClose={() => setReceiptId(null)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setReceiptId(null)}>
              Close
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!receiptQuery.data}
              onClick={() => window.print()}
            >
              Print
            </button>
          </>
        }
      >
        {receiptQuery.isPending ? <p className="muted">Loading receipt…</p> : null}
        {receiptQuery.isError ? <p className="muted">{receiptQuery.error.message}</p> : null}
        {receiptQuery.data ? (
          <div className="receipt" id="fee-receipt">
            <p className="receipt__brand">Coaching Institute</p>
            <p className="small muted">Fee receipt · {receiptQuery.data.academicYear}</p>

            <div className="receipt__rows">
              <div className="receipt__row">
                <span>Receipt no.</span>
                <strong className="mono">{receiptQuery.data.receiptNo}</strong>
              </div>
              <div className="receipt__row">
                <span>Date</span>
                <strong>{formatDateTime(receiptQuery.data.paidAt)}</strong>
              </div>
              <div className="receipt__row">
                <span>Student</span>
                <strong>{receiptQuery.data.studentName}</strong>
              </div>
              <div className="receipt__row">
                <span>Enrolment</span>
                <strong className="mono">{receiptQuery.data.enrollmentNo}</strong>
              </div>
              <div className="receipt__row">
                <span>Fee</span>
                <strong>{receiptQuery.data.structureName}</strong>
              </div>
              <div className="receipt__row">
                <span>Method</span>
                <strong>{receiptQuery.data.method.replaceAll("_", " ")}</strong>
              </div>
              {receiptQuery.data.reference ? (
                <div className="receipt__row">
                  <span>Reference</span>
                  <strong className="mono">{receiptQuery.data.reference}</strong>
                </div>
              ) : null}
              <div className="receipt__row">
                <span>Amount received</span>
                <strong>{formatCurrency(receiptQuery.data.amount)}</strong>
              </div>
              <div className="receipt__row">
                <span>Balance after</span>
                <strong>{formatCurrency(receiptQuery.data.pendingAmount)}</strong>
              </div>
            </div>

            {receiptQuery.data.voidedAt ? (
              <p className="alert alert--error" role="alert">
                VOID · {receiptQuery.data.voidReason}
              </p>
            ) : null}

            <p className="small muted">Computer-generated receipt. Keep it for your records.</p>
          </div>
        ) : null}
      </Modal>

      {tab === "dues" && structureOptions.length === 0 ? (
        <p className="small muted">Tip: create a fee structure first, then assign it to students.</p>
      ) : null}
    </div>
  );
}
