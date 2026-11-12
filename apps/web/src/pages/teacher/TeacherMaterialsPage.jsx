import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { teacherMaterialSchema, teacherMaterialUpdateSchema } from "@coaching/shared";
import { ExternalLink, FileText, Pencil, Plus, Trash2 } from "lucide-react";
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

const emptyMaterial = { subjectId: "", title: "", chapter: "", kind: "notes", driveUrl: "", description: "", status: "published" };

export function TeacherMaterialsPage() {
  useDocumentTitle("Study material");
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const batchesQuery = useTeacherBatches();
  const batchId = params.get("batch") ?? "";
  const batchQuery = useTeacherBatch(batchId);

  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const materialsQuery = useQuery({
    queryKey: ["teacher", "materials", batchId, page],
    queryFn: () => teacherService.materials(batchId, { page, pageSize: 20 }),
    enabled: Boolean(batchId)
  });

  const createForm = useForm({ resolver: zodResolver(teacherMaterialSchema), defaultValues: emptyMaterial });
  const editForm = useForm({ resolver: zodResolver(teacherMaterialUpdateSchema), defaultValues: {} });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      subjectId: editing.subjectId,
      title: editing.title,
      chapter: editing.chapter ?? "",
      kind: editing.kind,
      driveUrl: editing.driveUrl,
      description: editing.description ?? "",
      status: editing.status
    });
  }, [editing, editForm]);

  const subjects = batchQuery.data?.subjects ?? [];

  const createMutation = useMutation({
    mutationFn: (values) => teacherService.createMaterial(batchId, values),
    onSuccess: () => {
      setFormOpen(false);
      createForm.reset(emptyMaterial);
      queryClient.invalidateQueries({ queryKey: ["teacher", "materials", batchId] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => teacherService.updateMaterial(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["teacher", "materials", batchId] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => teacherService.deleteMaterial(id),
    onSuccess: () => {
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["teacher", "materials", batchId] });
    }
  });

  function openCreate() {
    createMutation.reset();
    createForm.reset({ ...emptyMaterial, subjectId: subjects[0]?.id ?? "" });
    setFormOpen(true);
  }

  const columns = [
    {
      key: "title",
      header: "Material",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.title}</p>
          <p className="cell-sub">{row.chapter || row.description || "—"}</p>
        </div>
      )
    },
    { key: "subjectName", header: "Subject", render: (row) => row.subjectName },
    { key: "kind", header: "Kind", render: (row) => <Badge tone="brand">{row.kind}</Badge> },
    {
      key: "driveUrl",
      header: "Link",
      render: (row) => (
        <a className="btn btn--ghost btn--sm" href={row.driveUrl} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={13} /> Open
        </a>
      )
    },
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
      <FormField label="Chapter" htmlFor={`${prefix}-chapter`}>
        <input id={`${prefix}-chapter`} className="input" {...form.register("chapter")} />
      </FormField>
      <FormField label="Kind" htmlFor={`${prefix}-kind`}>
        <select id={`${prefix}-kind`} className="input" {...form.register("kind")}>
          <option value="notes">Notes</option>
          <option value="assignment">Assignment sheet</option>
          <option value="reference">Reference</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField
        label="Google Drive link"
        htmlFor={`${prefix}-url`}
        required
        hint="Shareable https:// link — files stay in Drive, not in the database."
        error={form.formState.errors.driveUrl?.message}
      >
        <input id={`${prefix}-url`} className="input" placeholder="https://drive.google.com/…" {...form.register("driveUrl")} />
      </FormField>
      <FormField label="Status" htmlFor={`${prefix}-status`}>
        <select id={`${prefix}-status`} className="input" {...form.register("status")}>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </FormField>
      <FormField label="Description" htmlFor={`${prefix}-description`} full>
        <textarea id={`${prefix}-description`} className="input" rows={3} {...form.register("description")} />
      </FormField>
    </>
  );

  return (
    <div className="page-section">
      <PageHeader
        title="Study material"
        description="Notes and reference links shared with a batch. Files stay in Google Drive."
        actions={
          <button type="button" className="btn btn--primary btn--sm" disabled={!batchId || subjects.length === 0} onClick={openCreate}>
            <Plus size={15} /> Add material
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
          <EmptyState icon={FileText} title="Choose a batch" description="Material is organised per batch and subject." />
        </SectionCard>
      ) : null}

      {batchId && materialsQuery.isError ? <ErrorState error={materialsQuery.error} onRetry={materialsQuery.refetch} /> : null}

      {batchId ? (
        <SectionCard title="Material" subtitle={materialsQuery.data ? `${materialsQuery.data.total} record(s)` : undefined}>
          {deleteMutation.isError ? (
            <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
              {deleteMutation.error.message}
            </div>
          ) : null}
          <DataTable
            columns={columns}
            rows={materialsQuery.data?.items}
            loading={materialsQuery.isPending}
            empty={<EmptyState icon={FileText} title="No material yet" description="Add notes or a Drive link for this batch." />}
          />
          <Pagination page={page} pageSize={20} total={materialsQuery.data?.total ?? 0} onChange={setPage} />
        </SectionCard>
      ) : null}

      <Modal
        open={formOpen}
        title="Add material"
        onClose={() => setFormOpen(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="material-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create material"}
            </button>
          </>
        }
      >
        <form id="material-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          {fields(createForm, "m")}
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit material"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-material-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-material-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          {fields(editForm, "em")}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete material"
        description={`Delete "${deleting?.title ?? "this material"}"? The Drive file itself is not touched.`}
        confirmLabel="Delete material"
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
