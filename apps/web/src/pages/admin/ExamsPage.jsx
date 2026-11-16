import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { examCreateSchema } from "@coaching/shared";
import { ClipboardList, Plus } from "lucide-react";
import { examService } from "../../services/exams.service.js";
import { useBatches, useSubjects } from "../../hooks/useAdminLookups.js";
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

export function ExamsPage() {
  useDocumentTitle("Examinations");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const batchesQuery = useBatches();
  const subjectsQuery = useSubjects();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);

  const examsQuery = useQuery({
    queryKey: ["admin", "exams", page],
    queryFn: () => examService.list({ page, pageSize: 20 })
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

  const createMutation = useMutation({
    mutationFn: examService.create,
    onSuccess: (data) => {
      setFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "exams"] });
      navigate(`/admin/exams/${data.exam.id}`);
    }
  });

  const columns = examColumns();

  return (
    <div className="page-section">
      <PageHeader
        title="Examinations"
        description="Schedule tests, build the question bank and publish results."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> New exam
          </button>
        }
      />

      <SectionCard title="All exams">
        {examsQuery.isError ? (
          <ErrorState error={examsQuery.error} onRetry={examsQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={examsQuery.data?.items}
            loading={examsQuery.isPending}
            onRowClick={(row) => navigate(`/admin/exams/${row.id}`)}
            rowKey="id"
            empty={<EmptyState icon={ClipboardList} title="No exams yet" description="Create a test for a batch to get started." />}
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
            <button type="submit" form="exam-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create exam"}
            </button>
          </>
        }
      >
        <form
          id="exam-form"
          className="form-grid"
          noValidate
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Batch" htmlFor="e-batch" required error={form.formState.errors.batchId?.message}>
            <select id="e-batch" className="input" {...form.register("batchId")}>
              <option value="">Select a batch</option>
              {(batchesQuery.data ?? []).map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name} ({batch.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Subject" htmlFor="e-subject">
            <select id="e-subject" className="input" {...form.register("subjectId")}>
              <option value="">Any / mixed</option>
              {(subjectsQuery.data ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" htmlFor="e-title" required error={form.formState.errors.title?.message}>
            <input id="e-title" className="input" {...form.register("title")} />
          </FormField>
          <FormField label="Type" htmlFor="e-type">
            <select id="e-type" className="input" {...form.register("examType")}>
              <option value="mcq">MCQ</option>
              <option value="subjective">Subjective</option>
              <option value="mixed">Mixed</option>
            </select>
          </FormField>
          <FormField label="Starts" htmlFor="e-start" required error={form.formState.errors.startsAt?.message}>
            <input id="e-start" className="input" type="datetime-local" {...form.register("startsAt")} />
          </FormField>
          <FormField label="Ends" htmlFor="e-end" required error={form.formState.errors.endsAt?.message}>
            <input id="e-end" className="input" type="datetime-local" {...form.register("endsAt")} />
          </FormField>
          <FormField label="Duration (minutes)" htmlFor="e-duration" error={form.formState.errors.durationMinutes?.message}>
            <input
              id="e-duration"
              className="input"
              type="number"
              min="1"
              max="480"
              {...form.register("durationMinutes", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Pass marks" htmlFor="e-pass" hint="Marks are summed from questions as you add them.">
            <input
              id="e-pass"
              className="input"
              type="number"
              min="0"
              step="0.5"
              {...form.register("passMarks", { setValueAs: (value) => (value === "" ? 0 : Number(value)) })}
            />
          </FormField>
          <FormField label="Attempts allowed" htmlFor="e-attempts">
            <input
              id="e-attempts"
              className="input"
              type="number"
              min="1"
              max="5"
              {...form.register("maxAttempts", { setValueAs: (value) => (value === "" ? 1 : Number(value)) })}
            />
          </FormField>
          <FormField label="Status" htmlFor="e-status">
            <select id="e-status" className="input" {...form.register("status")}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Published (students can attempt)</option>
            </select>
          </FormField>
          <FormField label="Shuffle questions" htmlFor="e-shuffle" full>
            <label className="row" style={{ gap: 8 }} htmlFor="e-shuffle">
              <input id="e-shuffle" type="checkbox" {...form.register("shuffleQuestions")} />
              <span className="small">Show questions in a different, stable order per attempt</span>
            </label>
          </FormField>
        </form>
      </Modal>

      {examsQuery.data?.items.length ? (
        <p className="small muted">
          Open an exam to add questions, evaluate attempts and publish results. <Link to="/admin/batches">Batches</Link>
        </p>
      ) : null}
    </div>
  );
}
