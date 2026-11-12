import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminTeacherCreateSchema, adminTeacherUpdateSchema } from "@coaching/shared";
import { GraduationCap, KeyRound, Pencil, Plus, Power, Search, Trash2, UserPlus } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useBatches, useSubjects } from "../../hooks/useAdminLookups.js";
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
import { TempPasswordNotice } from "../../components/TempPasswordNotice.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { dateInput } from "../../utils/format.js";

export function TeachersPage() {
  useDocumentTitle("Teachers");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [tempPassword, setTempPassword] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const [assignBatchId, setAssignBatchId] = useState("");
  const [assignSubjectId, setAssignSubjectId] = useState("");
  const [resetFor, setResetFor] = useState(null);
  const [resetTempPassword, setResetTempPassword] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const debouncedSearch = useDebouncedValue(search);

  const batchesQuery = useBatches();
  const subjectsQuery = useSubjects();

  const teachersQuery = useQuery({
    queryKey: ["admin", "teachers", { page, search: debouncedSearch }],
    queryFn: () => adminService.teachers({ page, pageSize: 20, search: debouncedSearch })
  });

  const teacherDetail = useQuery({
    queryKey: ["admin", "teacher", assignFor],
    queryFn: () => adminService.teacher(assignFor),
    enabled: Boolean(assignFor)
  });

  const createForm = useForm({
    resolver: zodResolver(adminTeacherCreateSchema),
    defaultValues: { fullName: "", email: "", employeeCode: "", phone: "", qualification: "", specialization: "", joiningDate: "", password: "" }
  });

  const editForm = useForm({
    resolver: zodResolver(adminTeacherUpdateSchema),
    defaultValues: {}
  });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      fullName: editing.fullName,
      employeeCode: editing.employeeCode,
      phone: editing.phone ?? "",
      qualification: editing.qualification ?? "",
      specialization: editing.specialization ?? "",
      joiningDate: dateInput(editing.joiningDate)
    });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: adminService.createTeacher,
    onSuccess: (data) => {
      setTempPassword({ password: data.temporaryPassword, email: data.teacher.teacher.email });
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => adminService.updateTeacher(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "teacher", assignFor] });
    }
  });

  const assignMutation = useMutation({
    mutationFn: () => adminService.assignTeacherBatch(assignFor, { batchId: assignBatchId, subjectId: assignSubjectId }),
    onSuccess: () => {
      setAssignBatchId("");
      setAssignSubjectId("");
      queryClient.invalidateQueries({ queryKey: ["admin", "teacher", assignFor] });
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "batches"] });
    }
  });

  const unassignMutation = useMutation({
    mutationFn: (batchId) => adminService.unassignTeacherBatch(assignFor, batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "teacher", assignFor] });
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
    }
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => adminService.setTeacherStatus(id, status),
    onSuccess: () => {
      setPendingStatus(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "teachers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
    }
  });

  const resetMutation = useMutation({
    mutationFn: () => adminService.resetTeacherPassword(resetFor.id),
    onSuccess: (data) => setResetTempPassword(data.temporaryPassword)
  });

  const columns = [
    {
      key: "teacher",
      header: "Teacher",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.fullName}</p>
          <p className="cell-sub">{row.email}</p>
        </div>
      )
    },
    { key: "employeeCode", header: "Employee code", render: (row) => <span className="mono">{row.employeeCode}</span> },
    {
      key: "specialization",
      header: "Specialisation",
      render: (row) => (
        <div>
          <p>{row.specialization || "—"}</p>
          <p className="cell-sub">{row.qualification || ""}</p>
        </div>
      )
    },
    { key: "batchCount", header: "Batches", render: (row) => <Badge tone="brand">{row.batchCount}</Badge> },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "danger"}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(row)}>
            <Pencil size={13} /> Edit
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAssignFor(row.id)}>
            <GraduationCap size={13} /> Batches
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`Reset password for ${row.fullName}`}
            aria-label={`Reset password for ${row.fullName}`}
            onClick={() => {
              setResetTempPassword(null);
              resetMutation.reset();
              setResetFor(row);
            }}
            style={{ width: 32, height: 32 }}
          >
            <KeyRound size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`${row.status === "active" ? "Deactivate" : "Activate"} ${row.fullName}`}
            aria-label={`${row.status === "active" ? "Deactivate" : "Activate"} ${row.fullName}`}
            disabled={statusMutation.isPending}
            onClick={() => {
              statusMutation.reset();
              setPendingStatus({ teacher: row, next: row.status === "active" ? "inactive" : "active" });
            }}
            style={{ width: 32, height: 32 }}
          >
            <Power size={14} />
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Teachers"
        description="Staff accounts, subjects and batch assignments."
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              setTempPassword(null);
              setFormOpen(true);
            }}
          >
            <Plus size={15} /> Add teacher
          </button>
        }
      />

      <SectionCard title="All teachers" subtitle={teachersQuery.data ? `${teachersQuery.data.total} record(s)` : undefined}>
        <div className="toolbar">
          <div className="toolbar__search">
            <Search size={15} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search name, email or employee code"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search teachers"
            />
          </div>
        </div>

        {teachersQuery.isError ? (
          <ErrorState error={teachersQuery.error} onRetry={teachersQuery.refetch} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={teachersQuery.data?.items}
              loading={teachersQuery.isPending}
              empty={<EmptyState icon={GraduationCap} title="No teachers yet" description="Create a teacher account to assign batches." />}
            />
            <Pagination page={page} pageSize={20} total={teachersQuery.data?.total ?? 0} onChange={setPage} />
          </>
        )}
      </SectionCard>

      <Modal
        open={formOpen}
        title={tempPassword ? "Teacher created" : "Add teacher"}
        onClose={() => {
          setFormOpen(false);
          setTempPassword(null);
          createMutation.reset();
        }}
        size="lg"
        footer={
          tempPassword ? (
            <button type="button" className="btn btn--primary" onClick={() => setFormOpen(false)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="create-teacher-form" className="btn btn--primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create teacher"}
              </button>
            </>
          )
        }
      >
        {tempPassword ? (
          <TempPasswordNotice password={tempPassword.password} email={tempPassword.email} />
        ) : (
          <form id="create-teacher-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
            {createMutation.isError ? (
              <div className="alert alert--error field--full" role="alert">
                {createMutation.error.message}
              </div>
            ) : null}
            <FormField label="Full name" htmlFor="t-name" required error={createForm.formState.errors.fullName?.message}>
              <input id="t-name" className="input" {...createForm.register("fullName")} />
            </FormField>
            <FormField label="Email" htmlFor="t-email" required error={createForm.formState.errors.email?.message}>
              <input id="t-email" className="input" type="email" {...createForm.register("email")} />
            </FormField>
            <FormField label="Employee code" htmlFor="t-code" required error={createForm.formState.errors.employeeCode?.message}>
              <input id="t-code" className="input" {...createForm.register("employeeCode")} />
            </FormField>
            <FormField label="Phone" htmlFor="t-phone" error={createForm.formState.errors.phone?.message}>
              <input id="t-phone" className="input" {...createForm.register("phone")} />
            </FormField>
            <FormField label="Qualification" htmlFor="t-qual">
              <input id="t-qual" className="input" {...createForm.register("qualification")} />
            </FormField>
            <FormField label="Specialisation" htmlFor="t-spec">
              <input id="t-spec" className="input" {...createForm.register("specialization")} />
            </FormField>
            <FormField label="Joining date" htmlFor="t-joining">
              <input id="t-joining" className="input" type="date" {...createForm.register("joiningDate")} />
            </FormField>
            <FormField label="Temporary password" htmlFor="t-password" hint="Leave empty to generate one." error={createForm.formState.errors.password?.message}>
              <input id="t-password" className="input" type="text" autoComplete="new-password" {...createForm.register("password")} />
            </FormField>
          </form>
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit teacher"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-teacher-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-teacher-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Full name" htmlFor="et-name" error={editForm.formState.errors.fullName?.message}>
            <input id="et-name" className="input" {...editForm.register("fullName")} />
          </FormField>
          <FormField label="Employee code" htmlFor="et-code">
            <input id="et-code" className="input" {...editForm.register("employeeCode")} />
          </FormField>
          <FormField label="Phone" htmlFor="et-phone">
            <input id="et-phone" className="input" {...editForm.register("phone")} />
          </FormField>
          <FormField label="Qualification" htmlFor="et-qual">
            <input id="et-qual" className="input" {...editForm.register("qualification")} />
          </FormField>
          <FormField label="Specialisation" htmlFor="et-spec">
            <input id="et-spec" className="input" {...editForm.register("specialization")} />
          </FormField>
          <FormField label="Joining date" htmlFor="et-joining">
            <input id="et-joining" className="input" type="date" {...editForm.register("joiningDate")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(assignFor)}
        title="Batch assignments"
        description={teacherDetail.data?.teacher ? `${teacherDetail.data.teacher.fullName} · ${teacherDetail.data.teacher.employeeCode}` : "Loading…"}
        onClose={() => setAssignFor(null)}
        size="lg"
      >
        {teacherDetail.isError ? <ErrorState error={teacherDetail.error} onRetry={teacherDetail.refetch} /> : null}

        {teacherDetail.data ? (
          <div className="stack" style={{ gap: 16 }}>
            {teacherDetail.data.assignments.length === 0 ? (
              <EmptyState icon={GraduationCap} title="No batches assigned" description="Assign a batch below to grant access to its students." />
            ) : (
              <ul className="list">
                {teacherDetail.data.assignments.map((assignment) => (
                  <li className="list__item" key={assignment.id}>
                    <div className="list__main">
                      <p className="list__title">{assignment.batchName}</p>
                      <p className="list__meta">
                        {assignment.batchCode}
                        {assignment.subjectName ? ` · ${assignment.subjectName}` : " · all subjects"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${assignment.batchName}`}
                      onClick={() => unassignMutation.mutate(assignment.batchId)}
                      style={{ width: 32, height: 32 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="form-grid">
              <FormField label="Batch" htmlFor="assign-batch">
                <select id="assign-batch" className="input" value={assignBatchId} onChange={(event) => setAssignBatchId(event.target.value)}>
                  <option value="">Select a batch</option>
                  {(batchesQuery.data ?? []).map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name} ({batch.code})
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Subject (optional)" htmlFor="assign-subject">
                <select id="assign-subject" className="input" value={assignSubjectId} onChange={(event) => setAssignSubjectId(event.target.value)}>
                  <option value="">All subjects</option>
                  {(subjectsQuery.data ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="field field--full">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!assignBatchId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                >
                  <UserPlus size={15} /> Assign batch
                </button>
              </div>
              {assignMutation.isError ? (
                <div className="alert alert--error field--full" role="alert">
                  {assignMutation.error.message}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(resetFor)}
        title="Reset teacher password"
        description="A new temporary password is generated and every active session is signed out."
        onClose={() => {
          setResetFor(null);
          setResetTempPassword(null);
          resetMutation.reset();
        }}
        footer={
          resetTempPassword ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setResetFor(null);
                setResetTempPassword(null);
                resetMutation.reset();
              }}
            >
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setResetFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
              >
                {resetMutation.isPending ? "Resetting…" : "Generate new password"}
              </button>
            </>
          )
        }
      >
        {resetFor ? (
          <>
            {resetMutation.isError ? (
              <div className="alert alert--error" role="alert">
                {resetMutation.error.message}
              </div>
            ) : null}
            {resetTempPassword ? (
              <TempPasswordNotice password={resetTempPassword} email={resetFor.email} />
            ) : (
              <p className="small muted">The current password stops working immediately.</p>
            )}
          </>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        title={pendingStatus?.next === "active" ? "Activate teacher" : "Deactivate teacher"}
        description={
          pendingStatus?.next === "active"
            ? `${pendingStatus?.teacher?.fullName} will be able to sign in again.`
            : `${pendingStatus?.teacher?.fullName} will be signed out and blocked from signing in. Their batch assignments are kept.`
        }
        confirmLabel={pendingStatus?.next === "active" ? "Activate" : "Deactivate"}
        tone={pendingStatus?.next === "active" ? "primary" : "danger"}
        busy={statusMutation.isPending}
        error={statusMutation.error?.message}
        onConfirm={() => statusMutation.mutate({ id: pendingStatus.teacher.id, status: pendingStatus.next })}
        onClose={() => {
          setPendingStatus(null);
          statusMutation.reset();
        }}
      />
    </div>
  );
}
