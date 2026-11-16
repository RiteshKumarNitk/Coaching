import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import { announcementService } from "../../services/announcements.service.js";
import { useTeacherBatches } from "../../hooks/useTeacherBatches.js";
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
import { formatDateTime } from "../../utils/format.js";

export function TeacherNoticesPage() {
  useDocumentTitle("Notices");
  const queryClient = useQueryClient();
  const batchesQuery = useTeacherBatches();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", batchId: "", isPinned: false });

  const listQuery = useQuery({
    queryKey: ["teacher", "announcements", page],
    queryFn: () => announcementService.teacherList({ page, pageSize: 20 })
  });

  const createMutation = useMutation({
    mutationFn: () => announcementService.teacherCreate(form),
    onSuccess: () => {
      setOpen(false);
      setForm({ title: "", body: "", batchId: "", isPinned: false });
      queryClient.invalidateQueries({ queryKey: ["teacher", "announcements"] });
    }
  });

  const batches = batchesQuery.data ?? [];

  return (
    <div className="page-section">
      <PageHeader
        title="Notices"
        description="Post a notice to one of your batches. Students see it in the app and get a notification."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
            <Plus size={15} /> New notice
          </button>
        }
      />

      <SectionCard title="Your notices">
        {listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={listQuery.refetch} />
        ) : (
          <DataTable
            columns={[
              {
                key: "title",
                header: "Notice",
                render: (row) => (
                  <div>
                    <p className="cell-primary">{row.title}</p>
                    <p className="cell-sub">{row.body.length > 100 ? `${row.body.slice(0, 97)}…` : row.body}</p>
                  </div>
                )
              },
              { key: "batch", header: "Batch", render: (row) => <Badge>{row.batchName ?? "All"}</Badge> },
              { key: "published", header: "Published", render: (row) => formatDateTime(row.publishedAt) }
            ]}
            rows={listQuery.data?.items}
            loading={listQuery.isPending}
            empty={<EmptyState icon={Megaphone} title="No notices yet" description="Tell your batch about a test, holiday or schedule change." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={listQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={open}
        title="New notice"
        onClose={() => {
          setOpen(false);
          createMutation.reset();
        }}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={createMutation.isPending || !form.batchId || form.title.trim().length < 3 || form.body.trim().length < 3}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Publishing…" : "Publish"}
            </button>
          </>
        }
      >
        {createMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {createMutation.error.message}
          </div>
        ) : null}

        <div className="form-grid">
          <FormField label="Batch" htmlFor="notice-batch-teacher" required>
            <select
              id="notice-batch-teacher"
              className="input"
              value={form.batchId}
              onChange={(event) => setForm((current) => ({ ...current, batchId: event.target.value }))}
            >
              <option value="">Choose a batch</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" htmlFor="notice-title-teacher" required>
            <input
              id="notice-title-teacher"
              className="input"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </FormField>
          <FormField label="Message" htmlFor="notice-body-teacher" required>
            <textarea
              id="notice-body-teacher"
              className="input"
              rows={4}
              value={form.body}
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            />
          </FormField>
          <label className="checkbox field--full">
            <input
              type="checkbox"
              checked={form.isPinned}
              onChange={(event) => setForm((current) => ({ ...current, isPinned: event.target.checked }))}
            />
            <span>Pin to the top</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
