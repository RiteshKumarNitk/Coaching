import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { examCreateSchema } from "@coaching/shared";
import { ClipboardList, Plus } from "lucide-react";
import { teacherExamService } from "../../services/exams.service.js";
import { useTeacherBatch, useTeacherBatches } from "../../hooks/useTeacherBatches.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { examColumns } from "../../components/exams/examColumns.jsx";
import { dateTimeInput } from "../../utils/format.js";

export function TeacherExamsPage() {
  useDocumentTitle("Exams");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const batchesQuery = useTeacherBatches();

  const [page, setPage] = useState(1);
  const [batchFilter, setBatchFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const examsQuery = useQuery({
    queryKey: ["teacher", "exams", page, batchFilter],
    queryFn: () => teacherExamService.list({ page, pageSize: 20, batchId: batchFilter || undefined })
  });

  const form = useForm({
    resolver: zodResolver(examCreateSchema),
    defaultValues: {
      batchId: "",
      subjectId: "",
      title: "",
      examType: "mcq",
      startsAt: dateTimeInput(new Date()),
      endsAt: dateTimeInput(new Date(Date.now() + 86400_000)),
      durationMinutes: 60,
      passMarks: 0,
      maxAttempts: 1,
      shuffleQuestions: true,
      status: "draft"
    }
  });

  const selectedBatchId = form.watch("batchId");
  const selectedBatch = useTeacherBatch(selectedBatchId);
  const availableSubjects = selectedBatch.data?.subjects ?? [];

  const createMutation = useMutation({
    mutationFn: teacherExamService.create,
    onSuccess: (data) => {
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["teacher", "exams"] });
      navigate(`/teacher/exams/${data.exam.id}`);
    }
  });

  const columns = examColumns();

  return (
    <div className="page-section">
      <PageHeader
        title="Exams"
        description="Tests for the batches you teach — questions, attempts and results."
        actions={
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              createMutation.reset();
              form.reset();
              setFormOpen(true);
            }}
          >
            <Plus size={15} /> New exam
          </button>
        }
      />

      <SectionCard
        title="Exams for my batches"
        action={
          <select
            className="input"
            style={{ maxWidth: 260 }}
            aria-label="Filter by batch"
            value={batchFilter}
            onChange={(event) => {
              setBatchFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All my batches</option>
            {(batchesQuery.data ?? []).map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name}
              </option>
            ))}
          </select>
        }
      >
        {examsQuery.isError ? (
          <ErrorState error={examsQuery.error} onRetry={examsQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={examsQuery.data?.items}
            loading={examsQuery.isPending}
            onRowClick={(row) => navigate(`/teacher/exams/${row.id}`)}
            rowKey="id"
            empty={
              <EmptyState
                icon={ClipboardList}
                title="No exams yet"
                description="Create a test for one of your batches to get started."
              />
            }
          />
        )}
        <Pagination page={page} pageSize={20} total={examsQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={formOpen}
        title="New exam"
        onClose={() => {
          setFormOpen(false);
          createMutation.reset();
        }}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="teacher-exam-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create exam"}
            </button>
          </>
        }
      >
        <form
          id="teacher-exam-form"
          className="form-grid"
          noValidate
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Batch" htmlFor="t-batch" required error={form.formState.errors.batchId?.message}>
            <select
              id="t-batch"
              className="input"
              {...form.register("batchId", {
                onChange: () => form.setValue("subjectId", "")
              })}
            >
              <option value="">Select a batch</option>
              {(batchesQuery.data ?? []).map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name} ({batch.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Subject" htmlFor="t-subject" hint={selectedBatchId ? undefined : "Pick a batch first"}>
            <select id="t-subject" className="input" disabled={!selectedBatchId} {...form.register("subjectId")}>
              <option value="">Any / mixed</option>
              {availableSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" htmlFor="t-title" required error={form.formState.errors.title?.message}>
            <input id="t-title" className="input" {...form.register("title")} />
          </FormField>
          <FormField label="Type" htmlFor="t-type">
            <select id="t-type" className="input" {...form.register("examType")}>
              <option value="mcq">MCQ</option>
              <option value="subjective">Subjective</option>
              <option value="mixed">Mixed</option>
            </select>
          </FormField>
          <FormField label="Starts" htmlFor="t-start" required error={form.formState.errors.startsAt?.message}>
            <input id="t-start" className="input" type="datetime-local" {...form.register("startsAt")} />
          </FormField>
          <FormField label="Ends" htmlFor="t-end" required error={form.formState.errors.endsAt?.message}>
            <input id="t-end" className="input" type="datetime-local" {...form.register("endsAt")} />
          </FormField>
          <FormField label="Duration (minutes)" htmlFor="t-duration" error={form.formState.errors.durationMinutes?.message}>
            <input
              id="t-duration"
              className="input"
              type="number"
              min="1"
              max="480"
              {...form.register("durationMinutes", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Pass marks" htmlFor="t-pass" hint="Total marks are summed from the questions you add.">
            <input
              id="t-pass"
              className="input"
              type="number"
              min="0"
              step="0.5"
              {...form.register("passMarks", { setValueAs: (value) => (value === "" ? 0 : Number(value)) })}
            />
          </FormField>
          <FormField label="Attempts allowed" htmlFor="t-attempts">
            <input
              id="t-attempts"
              className="input"
              type="number"
              min="1"
              max="5"
              {...form.register("maxAttempts", { setValueAs: (value) => (value === "" ? 1 : Number(value)) })}
            />
          </FormField>
          <FormField label="Status" htmlFor="t-status">
            <select id="t-status" className="input" {...form.register("status")}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published (students can attempt)</option>
            </select>
          </FormField>
          <FormField label="Shuffle questions" htmlFor="t-shuffle" full>
            <label className="row" style={{ gap: 8 }} htmlFor="t-shuffle">
              <input id="t-shuffle" type="checkbox" {...form.register("shuffleQuestions")} />
              <span className="small">Show questions in a different, stable order per attempt</span>
            </label>
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
