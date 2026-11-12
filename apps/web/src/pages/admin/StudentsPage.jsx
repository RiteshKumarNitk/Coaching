import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { adminStudentCreateSchema, toCsv } from "@coaching/shared";
import { Download, Plus, Search, Upload, Users } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useBatches } from "../../hooks/useAdminLookups.js";
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
import { dateInput } from "../../utils/format.js";

const statusTone = (status) => (status === "active" ? "success" : status === "suspended" ? "danger" : "neutral");

export function StudentsPage() {
  useDocumentTitle("Students");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState(null);
  const [csv, setCsv] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [actionError, setActionError] = useState(null);

  const debouncedSearch = useDebouncedValue(search);
  const batchesQuery = useBatches();

  const studentsQuery = useQuery({
    queryKey: ["admin", "students", { page, search: debouncedSearch, status }],
    queryFn: () => adminService.students({ page, pageSize: 20, search: debouncedSearch, status })
  });

  const createForm = useForm({
    resolver: zodResolver(adminStudentCreateSchema),
    defaultValues: {
      fullName: "",
      email: "",
      enrollmentNo: "",
      password: "",
      phone: "",
      admissionDate: dateInput(new Date()),
      guardianName: "",
      guardianPhone: "",
      batchId: ""
    }
  });

  const createMutation = useMutation({
    mutationFn: adminService.createStudent,
    onSuccess: (data) => {
      setTempPassword({ password: data.temporaryPassword, email: data.student.student.email });
      createForm.reset({
        fullName: "",
        email: "",
        enrollmentNo: "",
        password: "",
        phone: "",
        admissionDate: dateInput(new Date()),
        guardianName: "",
        guardianPhone: "",
        batchId: ""
      });
      queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
    }
  });

  const importMutation = useMutation({
    mutationFn: adminService.importStudents,
    onSuccess: (data) => {
      setImportResult(data);
      setCsv("");
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["admin", "students"] });
    }
  });

  const exportMutation = useMutation({
    mutationFn: adminService.downloadStudentsCsv,
    onError: (error) => setActionError(error.message)
  });

  function downloadCredentials() {
    if (!importResult?.credentials?.length) return;
    const csvText = toCsv(
      ["email", "enrollment_no", "temporary_password"],
      importResult.credentials.map((entry) => [entry.email, entry.enrollmentNo, entry.temporaryPassword])
    );
    const url = URL.createObjectURL(new Blob([csvText], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `student-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setCsv(await file.text());
  }

  const columns = [
    {
      key: "student",
      header: "Student",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.fullName}</p>
          <p className="cell-sub">{row.email}</p>
        </div>
      )
    },
    { key: "enrollmentNo", header: "Enrolment", render: (row) => <span className="mono">{row.enrollmentNo}</span> },
    {
      key: "class",
      header: "Course / batch",
      render: (row) => (
        <div>
          <p>{row.courseName || "—"}</p>
          <p className="cell-sub">{row.batchName || "Not enrolled"}</p>
        </div>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge>
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <Link className="btn btn--ghost btn--sm" to={`/admin/students/${row.id}`}>
            Open
          </Link>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Students"
        description="Search, add, import and enrol students. Every record comes from the database."
        actions={
          <>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              <Download size={15} aria-hidden="true" />
              Export CSV
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImportOpen(true)}>
              <Upload size={15} aria-hidden="true" />
              Import CSV
            </button>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} aria-hidden="true" />
              Add student
            </button>
          </>
        }
      />

      {actionError ? (
        <div className="alert alert--error" role="alert">
          {actionError}
        </div>
      ) : null}

      <SectionCard title="All students" subtitle={studentsQuery.data ? `${studentsQuery.data.total} record(s)` : undefined}>
        <div className="toolbar">
          <div className="toolbar__search">
            <Search size={15} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search name, email or enrolment number"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              aria-label="Search students"
            />
          </div>
          <select
            className="input"
            style={{ maxWidth: 180 }}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {studentsQuery.isError ? (
          <ErrorState error={studentsQuery.error} onRetry={studentsQuery.refetch} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={studentsQuery.data?.items}
              loading={studentsQuery.isPending}
              onRowClick={(row) => navigate(`/admin/students/${row.id}`)}
              empty={
                <EmptyState
                  icon={Users}
                  title="No students found"
                  description={debouncedSearch || status ? "Try a different search or filter." : "Add your first student to get started."}
                />
              }
            />
            <Pagination
              page={page}
              pageSize={20}
              total={studentsQuery.data?.total ?? 0}
              onChange={setPage}
            />
          </>
        )}
      </SectionCard>

      <Modal
        open={createOpen}
        title={tempPassword ? "Student created" : "Add student"}
        description={tempPassword ? undefined : "Creates a login account and an enrolment record."}
        onClose={() => {
          setCreateOpen(false);
          setTempPassword(null);
          createMutation.reset();
        }}
        size="lg"
        footer={
          tempPassword ? (
            <button type="button" className="btn btn--primary" onClick={() => { setCreateOpen(false); setTempPassword(null); }}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="create-student-form" className="btn btn--primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create student"}
              </button>
            </>
          )
        }
      >
        {tempPassword ? (
          <TempPasswordNotice password={tempPassword.password} email={tempPassword.email} />
        ) : (
          <form
            id="create-student-form"
            className="form-grid"
            noValidate
            onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          >
            {createMutation.isError ? (
              <div className="alert alert--error field--full" role="alert">
                {createMutation.error.message}
              </div>
            ) : null}

            <FormField label="Full name" htmlFor="s-name" required error={createForm.formState.errors.fullName?.message}>
              <input id="s-name" className="input" {...createForm.register("fullName")} />
            </FormField>
            <FormField label="Email" htmlFor="s-email" required error={createForm.formState.errors.email?.message}>
              <input id="s-email" className="input" type="email" {...createForm.register("email")} />
            </FormField>
            <FormField
              label="Enrolment number"
              htmlFor="s-enrollment"
              required
              error={createForm.formState.errors.enrollmentNo?.message}
            >
              <input id="s-enrollment" className="input" {...createForm.register("enrollmentNo")} />
            </FormField>
            <FormField label="Phone" htmlFor="s-phone" error={createForm.formState.errors.phone?.message}>
              <input id="s-phone" className="input" inputMode="tel" {...createForm.register("phone")} />
            </FormField>
            <FormField
              label="Temporary password"
              htmlFor="s-password"
              hint="Leave empty to generate a strong password shown once."
              error={createForm.formState.errors.password?.message}
            >
              <input id="s-password" className="input" type="text" autoComplete="new-password" {...createForm.register("password")} />
            </FormField>
            <FormField label="Admission date" htmlFor="s-admission" error={createForm.formState.errors.admissionDate?.message}>
              <input id="s-admission" className="input" type="date" {...createForm.register("admissionDate")} />
            </FormField>
            <FormField label="Guardian name" htmlFor="s-guardian">
              <input id="s-guardian" className="input" {...createForm.register("guardianName")} />
            </FormField>
            <FormField label="Guardian phone" htmlFor="s-guardian-phone" error={createForm.formState.errors.guardianPhone?.message}>
              <input id="s-guardian-phone" className="input" inputMode="tel" {...createForm.register("guardianPhone")} />
            </FormField>
            <FormField label="Assign to batch" htmlFor="s-batch" hint="Optional — you can enrol later.">
              <select id="s-batch" className="input" {...createForm.register("batchId")}>
                <option value="">No batch yet</option>
                {(batchesQuery.data ?? []).map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name} ({batch.code})
                  </option>
                ))}
              </select>
            </FormField>
          </form>
        )}
      </Modal>

      <Modal
        open={importOpen}
        title="Import students from CSV"
        description="Headers: full_name, email, enrollment_no, phone, guardian_name, guardian_phone, admission_date, batch_code"
        onClose={() => {
          setImportOpen(false);
          setImportResult(null);
          importMutation.reset();
        }}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setImportOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => importMutation.mutate(csv)}
              disabled={!csv || importMutation.isPending}
            >
              {importMutation.isPending ? "Importing…" : "Import students"}
            </button>
          </>
        }
      >
        {importMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            <div>
              <p>{importMutation.error.message}</p>
              {importMutation.error.details ? (
                <ul className="small" style={{ marginTop: 6 }}>
                  {importMutation.error.details.slice(0, 8).map((detail) => (
                    <li key={`${detail.row}-${detail.message}`}>
                      Row {detail.row}: {detail.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        {importResult ? (
          <div className="stack">
            <div className="alert alert--success" role="status">
              Created {importResult.created} student(s). Skipped {importResult.skipped.length} existing record(s).
            </div>
            {importResult.credentials.length > 0 ? (
              <>
                <TempPasswordNotice password={importResult.credentials[0].temporaryPassword} email={importResult.credentials[0].email} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={downloadCredentials}>
                  <Download size={14} aria-hidden="true" />
                  Download all generated passwords (CSV)
                </button>
              </>
            ) : null}
            {importResult.skipped.length > 0 ? (
              <ul className="small muted">
                {importResult.skipped.map((entry) => (
                  <li key={entry.email}>
                    Skipped {entry.email} — {entry.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="stack">
            <FormField label="CSV file" htmlFor="csv-file" hint="Or paste the CSV contents below.">
              <input id="csv-file" ref={fileRef} className="input" type="file" accept=".csv,text/csv" onChange={handleFile} />
            </FormField>
            <FormField label="CSV contents" htmlFor="csv-text">
              <textarea
                id="csv-text"
                className="input"
                rows={7}
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                placeholder="full_name,email,enrollment_no,batch_code&#10;Asha Rao,asha@example.com,ENR-2026-200,JEE-27-A"
              />
            </FormField>
            <p className="help">Rows with an existing email or enrolment number are skipped, never duplicated.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
