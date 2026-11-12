import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSubjectSchema, subjectUpdateSchema } from "@coaching/shared";
import { Library, Pencil, Plus } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
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

export function SubjectsPage() {
  useDocumentTitle("Subjects");
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);

  const subjectsQuery = useQuery({
    queryKey: ["admin", "subjects", { page }],
    queryFn: () => adminService.subjects({ page, pageSize: 20 })
  });

  const createForm = useForm({
    resolver: zodResolver(createSubjectSchema),
    defaultValues: { code: "", name: "", description: "" }
  });

  const editForm = useForm({ resolver: zodResolver(subjectUpdateSchema), defaultValues: {} });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      code: editing.code,
      name: editing.name,
      description: editing.description ?? "",
      status: editing.status
    });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: adminService.createSubject,
    onSuccess: () => {
      setFormOpen(false);
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ["admin", "subjects"] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => adminService.updateSubject(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "subjects"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    }
  });

  const columns = [
    { key: "code", header: "Code", render: (row) => <span className="mono">{row.code}</span> },
    {
      key: "name",
      header: "Subject",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.name}</p>
          {row.description ? <p className="cell-sub">{row.description}</p> : null}
        </div>
      )
    },
    { key: "courseCount", header: "Courses", render: (row) => <Badge tone="brand">{row.courseCount}</Badge> },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(row)}>
            <Pencil size={13} /> Edit
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Subjects"
        description="Subjects are shared across courses and mapped to batches."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> Add subject
          </button>
        }
      />

      <SectionCard title="All subjects">
        {subjectsQuery.isError ? (
          <ErrorState error={subjectsQuery.error} onRetry={subjectsQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={subjectsQuery.data?.items}
            loading={subjectsQuery.isPending}
            empty={<EmptyState icon={Library} title="No subjects yet" description="Add Physics, Chemistry, Mathematics and so on." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={subjectsQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={formOpen}
        title="Add subject"
        onClose={() => {
          setFormOpen(false);
          createMutation.reset();
        }}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="subject-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create subject"}
            </button>
          </>
        }
      >
        <form id="subject-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Code" htmlFor="sub-code" required error={createForm.formState.errors.code?.message}>
            <input id="sub-code" className="input" placeholder="PHY" {...createForm.register("code")} />
          </FormField>
          <FormField label="Name" htmlFor="sub-name" required error={createForm.formState.errors.name?.message}>
            <input id="sub-name" className="input" placeholder="Physics" {...createForm.register("name")} />
          </FormField>
          <FormField label="Description" htmlFor="sub-desc">
            <input id="sub-desc" className="input" {...createForm.register("description")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit subject"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-subject-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-subject-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Code" htmlFor="es-code">
            <input id="es-code" className="input" {...editForm.register("code")} />
          </FormField>
          <FormField label="Name" htmlFor="es-name">
            <input id="es-name" className="input" {...editForm.register("name")} />
          </FormField>
          <FormField label="Status" htmlFor="es-status">
            <select id="es-status" className="input" {...editForm.register("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FormField>
          <FormField label="Description" htmlFor="es-desc">
            <input id="es-desc" className="input" {...editForm.register("description")} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
