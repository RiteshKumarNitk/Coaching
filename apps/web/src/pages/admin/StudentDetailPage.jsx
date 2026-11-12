import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useParams } from "react-router-dom";
import { adminStudentUpdateSchema } from "@coaching/shared";
import { ArrowLeft, KeyRound, Pencil, Plus, Power, Receipt, Trash2, UserRound } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useBatches } from "../../hooks/useAdminLookups.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { TempPasswordNotice } from "../../components/TempPasswordNotice.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { dateInput, formatCurrency, formatDate } from "../../utils/format.js";

export function StudentDetailPage() {
  const { id } = useParams();
  useDocumentTitle("Student profile");
  const queryClient = useQueryClient();
  const batchesQuery = useBatches();

  const [editOpen, setEditOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [enrollBatchId, setEnrollBatchId] = useState("");
  const [tempPassword, setTempPassword] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pending, setPending] = useState(null);

  const detailQuery = useQuery({
    queryKey: ["admin", "student", id],
    queryFn: () => adminService.student(id),
    enabled: Boolean(id)
  });

  const editForm = useForm({
    resolver: zodResolver(adminStudentUpdateSchema),
    defaultValues: {}
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "student", id] });
    queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
  };

  const updateMutation = useMutation({
    mutationFn: (values) => adminService.updateStudent(id, values),
    onSuccess: () => {
      setEditOpen(false);
      invalidate();
    },
    onError: (error) => setActionError(error.message)
  });

  const statusMutation = useMutation({
    mutationFn: (status) => adminService.setStudentStatus(id, status),
    onSuccess: () => {
      setPending(null);
      invalidate();
    }
  });

  const enrollMutation = useMutation({
    mutationFn: (batchId) => adminService.enrollStudent(id, batchId),
    onSuccess: () => {
      setEnrollOpen(false);
      setEnrollBatchId("");
      invalidate();
    },
    onError: (error) => setActionError(error.message)
  });

  const unenrollMutation = useMutation({
    mutationFn: (enrollmentId) => adminService.unenrollStudent(id, enrollmentId),
    onSuccess: () => {
      setPending(null);
      invalidate();
    }
  });

  const resetMutation = useMutation({
    mutationFn: () => adminService.resetStudentPassword(id),
    onSuccess: (data) => setTempPassword(data.temporaryPassword),
    onError: (error) => setActionError(error.message)
  });

  const detail = detailQuery.data;
  const student = detail?.student;

  useEffect(() => {
    if (!detail) return;
    editForm.reset({
      fullName: detail.student.fullName,
      phone: detail.student.phone ?? "",
      enrollmentNo: detail.student.enrollmentNo,
      admissionDate: dateInput(detail.student.admissionDate),
      dateOfBirth: dateInput(detail.student.dateOfBirth),
      gender: detail.student.gender ?? "",
      address: detail.student.address ?? "",
      city: detail.student.city ?? "",
      state: detail.student.state ?? "",
      pincode: detail.student.pincode ?? "",
      guardianName: detail.guardians[0]?.name ?? "",
      guardianPhone: detail.guardians[0]?.phone ?? ""
    });
  }, [detail, editForm]);

  if (detailQuery.isPending) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/admin/students">
          <ArrowLeft size={14} /> Students
        </Link>
        <DashboardSkeleton cards={3} panels={2} />
      </div>
    );
  }

  if (detailQuery.isError) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/admin/students">
          <ArrowLeft size={14} /> Students
        </Link>
        <ErrorState error={detailQuery.error} onRetry={detailQuery.refetch} />
      </div>
    );
  }

  return (
    <div className="page-section">
      <Link className="back-link" to="/admin/students">
        <ArrowLeft size={14} /> Students
      </Link>

      {actionError ? (
        <div className="alert alert--error" role="alert">
          {actionError}
        </div>
      ) : null}

      <section className="detail-hero">
        <div>
          <h1>{student.fullName}</h1>
          <p>
            {student.enrollmentNo} · {student.email}
          </p>
          <div className="row row--wrap" style={{ marginTop: 8 }}>
            <Badge tone={student.status === "active" ? "success" : "danger"}>{student.status}</Badge>
            {student.phone ? <Badge tone="brand">{student.phone}</Badge> : null}
            {detail.enrollments.find((enrollment) => enrollment.status === "active") ? (
              <Badge tone="accent">{detail.enrollments.find((enrollment) => enrollment.status === "active").batchName}</Badge>
            ) : null}
          </div>
        </div>
        <div className="detail-hero__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditOpen(true)}>
            <Pencil size={14} /> Edit
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEnrollOpen(true)}>
            <Plus size={14} /> Enrol
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setTempPassword(null);
              setResetOpen(true);
            }}
          >
            <KeyRound size={14} /> Reset password
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              statusMutation.reset();
              setPending({ type: "status", next: student.status === "active" ? "inactive" : "active" });
            }}
            disabled={statusMutation.isPending}
          >
            <Power size={14} /> {student.status === "active" ? "Deactivate" : "Activate"}
          </button>
        </div>
      </section>

      <div className="grid-2">
        <SectionCard title="Profile" subtitle="Enrolment and contact details">
          <dl className="detail-list">
            <div className="detail-row">
              <dt>Enrolment number</dt>
              <dd className="mono">{student.enrollmentNo}</dd>
            </div>
            <div className="detail-row">
              <dt>Admission date</dt>
              <dd>{formatDate(student.admissionDate)}</dd>
            </div>
            <div className="detail-row">
              <dt>Date of birth</dt>
              <dd>{formatDate(student.dateOfBirth)}</dd>
            </div>
            <div className="detail-row">
              <dt>Gender</dt>
              <dd style={{ textTransform: "capitalize" }}>{student.gender || "Not recorded"}</dd>
            </div>
            <div className="detail-row">
              <dt>Phone</dt>
              <dd>{student.phone || "Not recorded"}</dd>
            </div>
            <div className="detail-row">
              <dt>Address</dt>
              <dd>
                {[student.address, student.city, student.state, student.pincode].filter(Boolean).join(", ") || "Not recorded"}
              </dd>
            </div>
          </dl>
        </SectionCard>

        <div className="stack" style={{ gap: 18 }}>
          <SectionCard title="Guardian" subtitle="Primary contact">
            {detail.guardians.length === 0 ? (
              <EmptyState icon={UserRound} title="No guardian recorded" description="Use Edit to add a guardian contact." />
            ) : (
              <dl className="detail-list">
                {detail.guardians.map((guardian) => (
                  <div className="detail-row" key={guardian.id}>
                    <dt>{guardian.relation}</dt>
                    <dd>
                      {guardian.name}
                      {guardian.phone ? ` · ${guardian.phone}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </SectionCard>

          <div className="grid-2">
            <SectionCard title="Attendance">
              <div className="metric-block">
                <div className="stat-line">
                  <span className="muted small">Overall</span>
                  <strong>{detail.attendance.percentage === null ? "—" : `${detail.attendance.percentage}%`}</strong>
                </div>
                <div className="progress" aria-hidden="true">
                  <div className="progress__bar" style={{ width: `${detail.attendance.percentage ?? 0}%` }} />
                </div>
                <div className="metric-block__row">
                  <span>Sessions</span>
                  <strong>{detail.attendance.total}</strong>
                </div>
                <div className="metric-block__row">
                  <span>Absent</span>
                  <strong>{detail.attendance.absent}</strong>
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Fees">
              <div className="metric-block">
                <div className="metric-block__row">
                  <span>Total</span>
                  <strong>{formatCurrency(detail.fees.total)}</strong>
                </div>
                <div className="metric-block__row">
                  <span>Paid</span>
                  <strong>{formatCurrency(detail.fees.paid)}</strong>
                </div>
                <div className="metric-block__row">
                  <span>Pending</span>
                  <strong>{formatCurrency(detail.fees.pending)}</strong>
                </div>
                <Badge tone={detail.fees.pending > 0 ? "warning" : "success"} icon={Receipt}>
                  {detail.fees.pending > 0 ? "Dues pending" : "Fully paid"}
                </Badge>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      <SectionCard title="Enrolments" subtitle="Batches this student belongs to">
        {detail.enrollments.length === 0 ? (
          <EmptyState icon={Plus} title="Not enrolled in a batch" description="Use Enrol to assign a batch and course." />
        ) : (
          <ul className="list">
            {detail.enrollments.map((enrollment) => (
              <li className="list__item" key={enrollment.id}>
                <div className="list__main">
                  <p className="list__title">
                    {enrollment.batchName} <span className="mono cell-sub">({enrollment.batchCode})</span>
                  </p>
                  <p className="list__meta">
                    {enrollment.courseName} · enrolled {formatDate(enrollment.enrolledAt)}
                  </p>
                </div>
                <div className="list__side row" style={{ gap: 8 }}>
                  <Badge tone={enrollment.status === "active" ? "success" : "neutral"}>{enrollment.status}</Badge>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${enrollment.batchName}`}
                    onClick={() => {
                      unenrollMutation.reset();
                      setPending({ type: "unenroll", enrollment });
                    }}
                    style={{ width: 32, height: 32 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Recent results" subtitle="Published examinations">
        {detail.results.length === 0 ? (
          <EmptyState icon={Receipt} title="No published results" description="Results appear after an exam is evaluated." />
        ) : (
          <ul className="list">
            {detail.results.map((result) => (
              <li className="list__item" key={result.id}>
                <div className="list__main">
                  <p className="list__title">{result.exam_title}</p>
                  <p className="list__meta">
                    {Number(result.obtained_marks)} / {Number(result.total_marks)} marks · {formatDate(result.published_at)}
                  </p>
                </div>
                <span className="list__side">
                  <Badge tone={result.status === "pass" ? "success" : result.status === "fail" ? "danger" : "neutral"}>
                    {Math.round(Number(result.percentage))}%
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Modal
        open={editOpen}
        title="Edit student"
        onClose={() => setEditOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="edit-student-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-student-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Full name" htmlFor="e-name" error={editForm.formState.errors.fullName?.message}>
            <input id="e-name" className="input" {...editForm.register("fullName")} />
          </FormField>
          <FormField label="Enrolment number" htmlFor="e-enrollment" error={editForm.formState.errors.enrollmentNo?.message}>
            <input id="e-enrollment" className="input" {...editForm.register("enrollmentNo")} />
          </FormField>
          <FormField label="Phone" htmlFor="e-phone" error={editForm.formState.errors.phone?.message}>
            <input id="e-phone" className="input" {...editForm.register("phone")} />
          </FormField>
          <FormField label="Admission date" htmlFor="e-admission">
            <input id="e-admission" className="input" type="date" {...editForm.register("admissionDate")} />
          </FormField>
          <FormField label="Date of birth" htmlFor="e-dob">
            <input id="e-dob" className="input" type="date" {...editForm.register("dateOfBirth")} />
          </FormField>
          <FormField label="Gender" htmlFor="e-gender">
            <select id="e-gender" className="input" {...editForm.register("gender")}>
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <FormField label="Guardian name" htmlFor="e-guardian">
            <input id="e-guardian" className="input" {...editForm.register("guardianName")} />
          </FormField>
          <FormField label="Guardian phone" htmlFor="e-guardian-phone">
            <input id="e-guardian-phone" className="input" {...editForm.register("guardianPhone")} />
          </FormField>
          <FormField label="Address" htmlFor="e-address">
            <input id="e-address" className="input" {...editForm.register("address")} />
          </FormField>
          <FormField label="City" htmlFor="e-city">
            <input id="e-city" className="input" {...editForm.register("city")} />
          </FormField>
          <FormField label="State" htmlFor="e-state">
            <input id="e-state" className="input" {...editForm.register("state")} />
          </FormField>
          <FormField label="PIN code" htmlFor="e-pincode">
            <input id="e-pincode" className="input" inputMode="numeric" {...editForm.register("pincode")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={enrollOpen}
        title="Enrol in a batch"
        description="The student is added to the batch and its course."
        onClose={() => setEnrollOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEnrollOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!enrollBatchId || enrollMutation.isPending}
              onClick={() => enrollMutation.mutate(enrollBatchId)}
            >
              {enrollMutation.isPending ? "Enrolling…" : "Enrol student"}
            </button>
          </>
        }
      >
        {enrollMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {enrollMutation.error.message}
          </div>
        ) : null}
        <FormField label="Batch" htmlFor="enroll-batch">
          <select id="enroll-batch" className="input" value={enrollBatchId} onChange={(event) => setEnrollBatchId(event.target.value)}>
            <option value="">Select a batch</option>
            {(batchesQuery.data ?? []).map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name} ({batch.code}) · {batch.courseName}
              </option>
            ))}
          </select>
        </FormField>
      </Modal>

      <Modal
        open={resetOpen}
        title="Reset password"
        description="A new temporary password is generated and every active session is signed out."
        onClose={() => {
          setResetOpen(false);
          setTempPassword(null);
          resetMutation.reset();
        }}
        footer={
          tempPassword ? (
            <button type="button" className="btn btn--primary" onClick={() => setResetOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                {resetMutation.isPending ? "Resetting…" : "Generate new password"}
              </button>
            </>
          )
        }
      >
        {resetMutation.isError ? (
          <div className="alert alert--error" role="alert">
            {resetMutation.error.message}
          </div>
        ) : null}
        {tempPassword ? (
          <TempPasswordNotice password={tempPassword} email={student.email} />
        ) : (
          <p className="small muted">The current password stops working immediately.</p>
        )}
      </Modal>

      <ConfirmDialog
        open={pending?.type === "status"}
        title={pending?.next === "active" ? "Activate student" : "Deactivate student"}
        description={
          pending?.next === "active"
            ? `${student.fullName} will be able to sign in again.`
            : `${student.fullName} will be signed out and blocked from signing in until reactivated. Enrolments, fees and results are kept.`
        }
        confirmLabel={pending?.next === "active" ? "Activate" : "Deactivate"}
        tone={pending?.next === "active" ? "primary" : "danger"}
        busy={statusMutation.isPending}
        error={statusMutation.error?.message}
        onConfirm={() => statusMutation.mutate(pending.next)}
        onClose={() => {
          setPending(null);
          statusMutation.reset();
        }}
      />

      <ConfirmDialog
        open={pending?.type === "unenroll"}
        title="Remove enrolment"
        description={`Remove ${student.fullName} from ${pending?.enrollment?.batchName ?? "this batch"}? Attendance and results already recorded are kept.`}
        confirmLabel="Remove enrolment"
        tone="danger"
        busy={unenrollMutation.isPending}
        error={unenrollMutation.error?.message}
        onConfirm={() => unenrollMutation.mutate(pending.enrollment.id)}
        onClose={() => {
          setPending(null);
          unenrollMutation.reset();
        }}
      />
    </div>
  );
}
