import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { announcementSchema } from "@coaching/shared";
import { Megaphone, Pin, Plus, Trash2 } from "lucide-react";
import { announcementService } from "../../services/announcements.service.js";
import { useBatches, useCourses } from "../../hooks/useAdminLookups.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Modal } from "../../components/Modal.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { formatDate, formatDateTime } from "../../utils/format.js";

const AUDIENCES = [
  { value: "all", label: "Everyone" },
  { value: "role", label: "One role" },
  { value: "course", label: "One course" },
  { value: "batch", label: "One batch" }
];

function audienceLabel(row) {
  if (row.audience === "role") return `Role: ${row.roleCode}`;
  if (row.audience === "course") return `Course: ${row.courseName ?? "—"}`;
  if (row.audience === "batch") return `Batch: ${row.batchName ?? "—"}`;
  return "Everyone";
}

export function AnnouncementsPage() {
  useDocumentTitle("Notices");
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [composerOpen, setComposerOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const coursesQuery = useCourses();
  const batchesQuery = useBatches();

  const listQuery = useQuery({
    queryKey: ["admin", "announcements", { page }],
    queryFn: () => announcementService.list({ page, pageSize: 20 })
  });

  const form = useForm({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: "",
      body: "",
      audience: "all",
      roleCode: "student",
      courseId: "",
      batchId: "",
      expiresAt: "",
      isPinned: false
    }
  });
  const audience = form.watch("audience");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
    queryClient.invalidateQueries({ queryKey: ["student", "announcements"] });
  };

  const createMutation = useMutation({
    mutationFn: (values) =>
      announcementService.create({
        ...values,
        roleCode: values.audience === "role" ? values.roleCode : "",
        courseId: values.audience === "course" ? values.courseId : "",
        batchId: values.audience === "batch" ? values.batchId : "",
        expiresAt: values.expiresAt || ""
      }),
    onSuccess: () => {
      setComposerOpen(false);
      form.reset();
      invalidate();
    }
  });

  const pinMutation = useMutation({
    mutationFn: (row) => announcementService.update(row.id, { isPinned: !row.isPinned }),
    onSuccess: invalidate
  });

  const deleteMutation = useMutation({
    mutationFn: (row) => announcementService.remove(row.id),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    }
  });

  const columns = [
    {
      key: "title",
      header: "Notice",
      render: (row) => (
        <div>
          <p className="cell-primary">
            {row.isPinned ? <Pin size={12} aria-hidden="true" /> : null} {row.title}
          </p>
          <p className="cell-sub">{row.body.length > 90 ? `${row.body.slice(0, 87)}…` : row.body}</p>
        </div>
      )
    },
    { key: "audience", header: "Audience", render: (row) => <Badge>{audienceLabel(row)}</Badge> },
    { key: "publishedAt", header: "Published", render: (row) => formatDateTime(row.publishedAt) },
    {
      key: "expiresAt",
      header: "Expires",
      render: (row) => (row.expiresAt ? formatDate(row.expiresAt) : "—")
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => pinMutation.mutate(row)}
            disabled={pinMutation.isPending}
          >
            <Pin size={13} /> {row.isPinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDeleting(row)}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Notices"
        description="Publish announcements to everyone, a role, a course or a batch. Students see them in the app and as a notification."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setComposerOpen(true)}>
            <Plus size={15} /> New notice
          </button>
        }
      />

      <SectionCard title="Published notices">
        {listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={listQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={listQuery.data?.items}
            loading={listQuery.isPending}
            empty={<EmptyState icon={Megaphone} title="No notices yet" description="Publish the first announcement for your students." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={listQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={composerOpen}
        title="New notice"
        description="Notifications go out the moment you publish."
        onClose={() => {
          setComposerOpen(false);
          createMutation.reset();
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setComposerOpen(false);
                createMutation.reset();
              }}
            >
              Cancel
            </button>
            <button type="submit" form="notice-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Publishing…" : "Publish"}
            </button>
          </>
        }
      >
        <form
          id="notice-form"
          className="form-grid"
          noValidate
          onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
        >
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}

          <FormField label="Title" htmlFor="notice-title" required error={form.formState.errors.title?.message}>
            <input id="notice-title" className="input" {...form.register("title")} />
          </FormField>

          <FormField label="Message" htmlFor="notice-body" required error={form.formState.errors.body?.message}>
            <textarea id="notice-body" className="input" rows={4} {...form.register("body")} />
          </FormField>

          <FormField label="Audience" htmlFor="notice-audience">
            <select id="notice-audience" className="input" {...form.register("audience")}>
              {AUDIENCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          {audience === "role" ? (
            <FormField label="Role" htmlFor="notice-role" error={form.formState.errors.roleCode?.message}>
              <select id="notice-role" className="input" {...form.register("roleCode")}>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="admin">Admins</option>
              </select>
            </FormField>
          ) : null}

          {audience === "course" ? (
            <FormField label="Course" htmlFor="notice-course" error={form.formState.errors.courseId?.message}>
              <select id="notice-course" className="input" {...form.register("courseId")}>
                <option value="">Choose a course</option>
                {(coursesQuery.data ?? []).map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          {audience === "batch" ? (
            <FormField label="Batch" htmlFor="notice-batch" error={form.formState.errors.batchId?.message}>
              <select id="notice-batch" className="input" {...form.register("batchId")}>
                <option value="">Choose a batch</option>
                {(batchesQuery.data ?? []).map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          <FormField label="Expires (optional)" htmlFor="notice-expires">
            <input id="notice-expires" className="input" type="date" {...form.register("expiresAt")} />
          </FormField>

          <label className="checkbox field--full">
            <input type="checkbox" {...form.register("isPinned")} />
            <span>Pin to the top of the list</span>
          </label>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete notice?"
        description={`“${deleting?.title ?? ""}” will disappear for students. Notifications already sent stay in their inbox.`}
        confirmLabel="Delete notice"
        busy={deleteMutation.isPending}
        error={deleteMutation.error?.message}
        onConfirm={() => deleteMutation.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
