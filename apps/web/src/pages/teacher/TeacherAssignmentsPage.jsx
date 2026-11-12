import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherAssignmentSchema, teacherAssignmentUpdateSchema } from "@coaching/shared";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { teacherService } from "../../services/teacher.service.js";
import { useTeacherBatch, useTeacherBatches } from "../../hooks/useTeacherBatches.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { BatchSelect } from "../../components/BatchSelect.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { dateTimeInput, formatDate } from "../../utils/format.js";

const emptyAssignment = {
  subjectId: "",
  title: "",
  instructions: "",
  dueAt: "",
  maxMarks: 10,
  status: "published"
};

const statusTone = (status) => (status === "published" ? "success" : status === "draft" ? "warning" : "neutral");

export function TeacherAssignmentsPage() {
  useDocumentTitle("Assignments");
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const batchesQuery = useTeacherBatches();
  const batchId = params.get("batch") ?? "";
  const batchQuery = useTeacherBatch(batchId);

  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [evaluating, setEvaluating] = useState(null);
  const [marks, setMarks] = useState("");
  const [feedback, setFeedback] = useState("");

  const assignmentsQuery = useQuery({
    queryKey: ["teacher", "assignments", batchId, page],
    queryFn: () => teacherService.assignments(batchId, { page, pageSize: 20 }),
    enabled: Boolean(batchId)
  });

  const detailQuery = useQuery({
    queryKey: ["teacher", "assignment", viewing],
    queryFn: () => teacherService.assignment(viewing),
    enabled: Boolean(viewing)
  });

  const createForm = useForm({ resolver: zodResolver(teacherAssignmentSchema), defaultValues: emptyAssignment });
  const editForm = useForm({ resolver: zodResolver(teacherAssignmentUpdateSchema), defaultValues: {} });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      subjectId: editing.subjectId,
      title: editing.title,
      instructions: editing.instructions ?? "",
      dueAt: dateTimeInput(editing.dueAt),
      maxMarks: editing.maxMarks,
      status: editing.status
    });
  }, [editing, editForm]);

  const subjects = batchQuery.data?.subjects ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["teacher", "assignments", batchId] });
    if (viewing) queryClient.invalidateQueries({ queryKey: ["teacher", "assignment", viewing] });
  };

  const createMutation = useMutation({
    mutationFn: (values) => teacherService.createAssignment(batchId, values),
    onSuccess: () => {
      setFormOpen(false);
      createForm.reset(emptyAssignment);
      invalidate();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => teacherService.updateAssignment(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => teacherService.deleteAssignment(id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    }
  });

  const evaluateMutation = useMutation({
    mutationFn: () =>
      teacherService.evaluateSubmission(evaluating.id, {
        marksAwarded: Number(marks),
        feedback
      }),
    onSuccess: () => {
      setEvaluating(null);
      setMarks("");
      setFeedback("");
      invalidate();
    }
  });

  function openCreate() {
    createMutation.reset();
    createForm.reset({ ...emptyAssignment, subjectId: subjects[0]?.id ?? "" });
    setFormOpen(true);
  }

  function openEvaluate(submission) {
    evaluateMutation.reset();
    setMarks(submission.marksAwarded ?? "");
    setFeedback(submission.feedback ?? "");
    setEvaluating(submission);
  }

  const columns = [
    {
      key: "title",
      header: "Assignment",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.title}</p>
          <p className="cell-sub">{row.subjectName}</p>
        </div>
      )
    },
    { key: "dueAt", header: "Due", render: (row) => (row.dueAt ? formatDate(row.dueAt) : "No due date") },
    { key: "maxMarks", header: "Max marks", render: (row) => row.maxMarks },
    {
      key: "submissions",
      header: "Submissions",
      render: (row) => (
        <Badge tone={row.submissionCount > 0 ? "brand" : "neutral"}>
          {row.evaluatedCount}/{row.submissionCount}
        </Badge>
      )
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setViewing(row.id)}>
            Submissions
          </button>
          <button type="button" className="icon-btn" aria-label={`Edit ${row.title}`} onClick={() => setEditing(row)} style={{ width: 32, height: 32 }}>
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete ${row.title}`}
            onClick={() => {
              deleteMutation.reset();
              setDeleting(row);
            }}
            style={{ width: 32, height: 32 }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )
    }
  ];

  const fields = (form, prefix) => (
    <>
      <FormField label="Subject" htmlFor={`${prefix}-subject`} required error={form.formState.errors.subjectId?.message}>
        <select id={`${prefix}-subject`} className="input" {...form.register("subjectId")}>
          <option value="">Select a subject</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Title" htmlFor={`${prefix}-title`} required error={form.formState.errors.title?.message}>
        <input id={`${prefix}-title`} className="input" {...form.register("title")} />
      </FormField>
      <FormField label="Due date" htmlFor={`${prefix}-due`}>
        <input id={`${prefix}-due`} className="input" type="datetime-local" {...form.register("dueAt")} />
      </FormField>
      <FormField label="Max marks" htmlFor={`${prefix}-marks`} error={form.formState.errors.maxMarks?.message}>
        <input
          id={`${prefix}-marks`}
          className="input"
          type="number"
          min="1"
          max="1000"
          {...form.register("maxMarks", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
        />
      </FormField>
      <FormField label="Status" htmlFor={`${prefix}-status`}>
        <select id={`${prefix}-status`} className="input" {...form.register("status")}>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
        </select>
      </FormField>
      <FormField label="Instructions" htmlFor={`${prefix}-instructions`} full>
        <textarea id={`${prefix}-instructions`} className="input" rows={4} {...form.register("instructions")} />
      </FormField>
    </>
  );

  return (
    <div className="page-section">
      <PageHeader
        title="Assignments"
        description="Set work for a batch, then evaluate the submissions students send in."
        actions={
          <button type="button" className="btn btn--primary btn--sm" disabled={!batchId || subjects.length === 0} onClick={openCreate}>
            <Plus size={15} /> Add assignment
          </button>
        }
      />

      <SectionCard>
        <BatchSelect
          batches={batchesQuery.data}
          value={batchId}
          onChange={(value) => {
            setPage(1);
            setParams(value ? { batch: value } : {});
          }}
        />
      </SectionCard>

      {!batchId ? (
        <SectionCard>
          <EmptyState icon={ClipboardList} title="Choose a batch" description="Assignments belong to a batch and subject." />
        </SectionCard>
      ) : null}

      {batchId && assignmentsQuery.isError ? <ErrorState error={assignmentsQuery.error} onRetry={assignmentsQuery.refetch} /> : null}

      {batchId ? (
        <SectionCard title="Assignments" subtitle={assignmentsQuery.data ? `${assignmentsQuery.data.total} record(s)` : undefined}>
          {deleteMutation.isError ? (
            <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
              {deleteMutation.error.message}
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={assignmentsQuery.data?.items}
            loading={assignmentsQuery.isPending}
            empty={<EmptyState icon={ClipboardList} title="No assignments yet" description="Create one for this batch." />}
          />
          <Pagination page={page} pageSize={20} total={assignmentsQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      <Modal
        open={formOpen}
        title="Add assignment"
        onClose={() => setFormOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="assignment-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create assignment"}
            </button>
          </>
        }
      >
        <form id="assignment-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          {fields(createForm, "a")}
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit assignment"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-assignment-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-assignment-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          {fields(editForm, "ea")}
        </form>
      </Modal>

      <Modal
        open={Boolean(viewing)}
        title="Submissions"
        description={detailQuery.data?.assignment ? `${detailQuery.data.assignment.title} · ${detailQuery.data.assignment.maxMarks} marks` : "Loading…"}
        onClose={() => setViewing(null)}
        size="lg"
      >
        {detailQuery.isError ? <ErrorState error={detailQuery.error} onRetry={detailQuery.refetch} /> : null}
        {detailQuery.data ? (
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
              { key: "submittedAt", header: "Submitted", render: (row) => formatDate(row.submittedAt) },
              {
                key: "marks",
                header: "Marks",
                render: (row) => (row.marksAwarded === null ? <span className="muted small">Not graded</span> : `${row.marksAwarded} / ${detailQuery.data.assignment.maxMarks}`)
              },
              { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "evaluated" ? "success" : "warning"}>{row.status}</Badge> },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEvaluate(row)}>
                    Evaluate
                  </button>
                )
              }
            ]}
            rows={detailQuery.data.submissions}
            loading={false}
            empty={<EmptyState icon={ClipboardList} title="No submissions yet" description="Students submit from their portal." />}
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(evaluating)}
        title="Evaluate submission"
        description={evaluating ? `${evaluating.fullName} · ${evaluating.enrollmentNo}` : undefined}
        onClose={() => setEvaluating(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEvaluating(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={evaluateMutation.isPending || marks === ""}
              onClick={() => evaluateMutation.mutate()}
            >
              {evaluateMutation.isPending ? "Saving…" : "Save evaluation"}
            </button>
          </>
        }
      >
        {evaluateMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {evaluateMutation.error.message}
          </div>
        ) : null}
        <div className="form-grid">
          <FormField label="Marks awarded" htmlFor="eval-marks" hint={`Maximum ${detailQuery.data?.assignment?.maxMarks ?? "—"}`}>
            <input
              id="eval-marks"
              className="input"
              type="number"
              min="0"
              max={detailQuery.data?.assignment?.maxMarks ?? 1000}
              value={marks}
              onChange={(event) => setMarks(event.target.value)}
            />
          </FormField>
          <FormField label="Feedback" htmlFor="eval-feedback" full>
            <textarea
              id="eval-feedback"
              className="input"
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete assignment"
        description={`Delete "${deleting?.title ?? "this assignment"}" and its submissions? This cannot be undone.`}
        confirmLabel="Delete assignment"
        busy={deleteMutation.isPending}
        error={deleteMutation.error?.message}
        onConfirm={() => deleteMutation.mutate(deleting.id)}
        onClose={() => {
          setDeleting(null);
          deleteMutation.reset();
        }}
      />
    </div>
  );
}
