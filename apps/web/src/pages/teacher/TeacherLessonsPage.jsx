import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherLessonSchema, teacherLessonUpdateSchema } from "@coaching/shared";
import { Pencil, Plus, Trash2, Video } from "lucide-react";
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

const statusTone = (status) => (status === "published" ? "success" : status === "draft" ? "warning" : "neutral");

const emptyLesson = { subjectId: "", title: "", chapter: "", youtubeVideoId: "", durationMinutes: 30, status: "published" };

export function TeacherLessonsPage() {
  useDocumentTitle("Lectures");
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const batchesQuery = useTeacherBatches();
  const batchId = params.get("batch") ?? "";
  const batchQuery = useTeacherBatch(batchId);

  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const lessonsQuery = useQuery({
    queryKey: ["teacher", "lessons", batchId, page],
    queryFn: () => teacherService.lessons(batchId, { page, pageSize: 20 }),
    enabled: Boolean(batchId)
  });

  const createForm = useForm({ resolver: zodResolver(teacherLessonSchema), defaultValues: emptyLesson });
  const editForm = useForm({ resolver: zodResolver(teacherLessonUpdateSchema), defaultValues: {} });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      subjectId: editing.subjectId,
      title: editing.title,
      chapter: editing.chapter ?? "",
      youtubeVideoId: editing.youtubeVideoId ?? "",
      durationMinutes: editing.durationMinutes ?? undefined,
      status: editing.status
    });
  }, [editing, editForm]);

  const subjects = batchQuery.data?.subjects ?? [];

  const createMutation = useMutation({
    mutationFn: (values) => teacherService.createLesson(batchId, values),
    onSuccess: () => {
      setFormOpen(false);
      createForm.reset(emptyLesson);
      queryClient.invalidateQueries({ queryKey: ["teacher", "lessons", batchId] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => teacherService.updateLesson(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["teacher", "lessons", batchId] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => teacherService.deleteLesson(id),
    onSuccess: () => {
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["teacher", "lessons", batchId] });
    }
  });

  function openCreate() {
    createMutation.reset();
    createForm.reset({ ...emptyLesson, subjectId: subjects[0]?.id ?? "" });
    setFormOpen(true);
  }

  const columns = [
    {
      key: "title",
      header: "Lecture",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.title}</p>
          <p className="cell-sub">{row.chapter || "No chapter"}</p>
        </div>
      )
    },
    { key: "subjectName", header: "Subject", render: (row) => row.subjectName },
    {
      key: "youtubeVideoId",
      header: "Video",
      render: (row) => (row.youtubeVideoId ? <span className="mono small">{row.youtubeVideoId}</span> : <span className="muted small">—</span>)
    },
    { key: "durationMinutes", header: "Length", render: (row) => (row.durationMinutes ? `${row.durationMinutes} min` : "—") },
    { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(row)}>
            <Pencil size={13} /> Edit
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

  return (
    <div className="page-section">
      <PageHeader
        title="Lectures"
        description="Unlisted YouTube videos with a title, chapter and duration."
        actions={
          <button type="button" className="btn btn--primary btn--sm" disabled={!batchId || subjects.length === 0} onClick={openCreate}>
            <Plus size={15} /> Add lecture
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
          <EmptyState icon={Video} title="Choose a batch" description="Lectures are organised per batch and subject." />
        </SectionCard>
      ) : null}

      {batchId && lessonsQuery.isError ? <ErrorState error={lessonsQuery.error} onRetry={lessonsQuery.refetch} /> : null}

      {batchId ? (
        <SectionCard title="Lectures" subtitle={lessonsQuery.data ? `${lessonsQuery.data.total} record(s)` : undefined}>
          {deleteMutation.isError ? (
            <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
              {deleteMutation.error.message}
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={lessonsQuery.data?.items}
            loading={lessonsQuery.isPending}
            empty={
              <EmptyState
                icon={Video}
                title="No lectures yet"
                description={subjects.length === 0 ? "The office must map subjects to this batch first." : "Add the first lecture for this batch."}
              />
            }
          />
          <Pagination page={page} pageSize={20} total={lessonsQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      <Modal
        open={formOpen}
        title="Add lecture"
        onClose={() => setFormOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="lesson-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create lecture"}
            </button>
          </>
        }
      >
        <form id="lesson-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Subject" htmlFor="l-subject" required error={createForm.formState.errors.subjectId?.message}>
            <select id="l-subject" className="input" {...createForm.register("subjectId")}>
              <option value="">Select a subject</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" htmlFor="l-title" required error={createForm.formState.errors.title?.message}>
            <input id="l-title" className="input" {...createForm.register("title")} />
          </FormField>
          <FormField label="Chapter" htmlFor="l-chapter" error={createForm.formState.errors.chapter?.message}>
            <input id="l-chapter" className="input" {...createForm.register("chapter")} />
          </FormField>
          <FormField label="YouTube video id" htmlFor="l-video" hint="11 characters from the unlisted URL" error={createForm.formState.errors.youtubeVideoId?.message}>
            <input id="l-video" className="input" placeholder="dQw4w9WgXcQ" {...createForm.register("youtubeVideoId")} />
          </FormField>
          <FormField label="Duration (minutes)" htmlFor="l-duration" error={createForm.formState.errors.durationMinutes?.message}>
            <input
              id="l-duration"
              className="input"
              type="number"
              min="1"
              max="600"
              {...createForm.register("durationMinutes", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Status" htmlFor="l-status">
            <select id="l-status" className="input" {...createForm.register("status")}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit lecture"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-lesson-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-lesson-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Subject" htmlFor="el-subject">
            <select id="el-subject" className="input" {...editForm.register("subjectId")}>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" htmlFor="el-title">
            <input id="el-title" className="input" {...editForm.register("title")} />
          </FormField>
          <FormField label="Chapter" htmlFor="el-chapter">
            <input id="el-chapter" className="input" {...editForm.register("chapter")} />
          </FormField>
          <FormField label="YouTube video id" htmlFor="el-video">
            <input id="el-video" className="input" {...editForm.register("youtubeVideoId")} />
          </FormField>
          <FormField label="Duration (minutes)" htmlFor="el-duration">
            <input
              id="el-duration"
              className="input"
              type="number"
              min="1"
              max="600"
              {...editForm.register("durationMinutes", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Status" htmlFor="el-status">
            <select id="el-status" className="input" {...editForm.register("status")}>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete lecture"
        description={`Delete "${deleting?.title ?? "this lecture"}"? Student progress for it is removed too.`}
        confirmLabel="Delete lecture"
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
