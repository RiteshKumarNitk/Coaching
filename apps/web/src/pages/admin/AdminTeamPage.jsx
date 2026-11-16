import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldCheck, UserRoundX } from "lucide-react";
import { adminOpsService } from "../../services/adminOps.service.js";
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
import { formatDate } from "../../utils/format.js";

const emptyForm = { fullName: "", email: "", phone: "", roleCode: "admin", password: "" };

export function AdminTeamPage() {
  useDocumentTitle("Staff accounts");
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [resetting, setResetting] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [tempPassword, setTempPassword] = useState(null);

  const listQuery = useQuery({
    queryKey: ["admin", "team", page],
    queryFn: () => adminOpsService.admins({ page, pageSize: 20 })
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "team"] });

  const createMutation = useMutation({
    mutationFn: () => adminOpsService.createAdmin({ ...form, password: form.password || undefined }),
    onSuccess: (result) => {
      setTempPassword(result.temporaryPassword ?? null);
      setFormOpen(false);
      setForm(emptyForm);
      invalidate();
    }
  });

  const statusMutation = useMutation({
    mutationFn: ({ row, status }) => adminOpsService.updateAdmin(row.id, { status }),
    onSuccess: invalidate
  });

  const roleMutation = useMutation({
    mutationFn: ({ row, roleCode }) => adminOpsService.updateAdmin(row.id, { roleCode }),
    onSuccess: invalidate
  });

  const resetMutation = useMutation({
    mutationFn: () => adminOpsService.resetAdminPassword(resetting.id, newPassword || undefined),
    onSuccess: (result) => {
      if (result.temporaryPassword) setTempPassword(result.temporaryPassword);
      setResetting(null);
      setNewPassword("");
    }
  });

  const columns = [
    {
      key: "person",
      header: "Person",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.fullName}</p>
          <p className="cell-sub">{row.email}</p>
        </div>
      )
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <select
          className="input input--sm"
          value={row.roles.includes("super_admin") ? "super_admin" : "admin"}
          onChange={(event) => roleMutation.mutate({ row, roleCode: event.target.value })}
          disabled={roleMutation.isPending}
        >
          <option value="admin">admin</option>
          <option value="super_admin">super_admin</option>
        </select>
      )
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "lastLogin", header: "Last sign-in", render: (row) => (row.lastLoginAt ? formatDate(row.lastLoginAt) : "—") },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setResetting(row)}>
            <KeyRound size={13} /> Reset password
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate({ row, status: row.status === "active" ? "inactive" : "active" })}
          >
            <UserRoundX size={13} /> {row.status === "active" ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Staff accounts"
        description="Admins who can sign in to the office workspace. Only a super admin can manage this list."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> Add admin
          </button>
        }
      />

      {tempPassword ? (
        <div className="alert alert--success" role="status">
          Temporary password: <strong className="mono">{tempPassword}</strong> — share it privately; it is shown once.
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTempPassword(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <SectionCard title="Everyone with office access">
        {listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={listQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={listQuery.data?.items}
            loading={listQuery.isPending}
            empty={<EmptyState icon={ShieldCheck} title="No staff accounts" description="Add an admin so the office can work without the owner's login." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={listQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={formOpen}
        title="Add admin"
        description="Leave the password blank to generate a temporary one."
        onClose={() => {
          setFormOpen(false);
          createMutation.reset();
        }}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="admin-form"
              className="btn btn--primary"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Create admin"}
            </button>
          </>
        }
      >
        <form
          id="admin-form"
          className="form-grid"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Full name" htmlFor="admin-name" required>
            <input
              id="admin-name"
              className="input"
              value={form.fullName}
              onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
            />
          </FormField>
          <FormField label="Email" htmlFor="admin-email" required>
            <input
              id="admin-email"
              className="input"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </FormField>
          <FormField label="Phone" htmlFor="admin-phone">
            <input
              id="admin-phone"
              className="input"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            />
          </FormField>
          <FormField label="Role" htmlFor="admin-role">
            <select
              id="admin-role"
              className="input"
              value={form.roleCode}
              onChange={(event) => setForm((current) => ({ ...current, roleCode: event.target.value }))}
            >
              <option value="admin">admin</option>
              <option value="super_admin">super_admin</option>
            </select>
          </FormField>
          <FormField label="Password (optional)" htmlFor="admin-password">
            <input
              id="admin-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetting)}
        title="Reset password"
        description={resetting ? `${resetting.fullName} · ${resetting.email}` : undefined}
        size="sm"
        onClose={() => setResetting(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setResetting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {resetMutation.isPending ? "Saving…" : "Reset password"}
            </button>
          </>
        }
      >
        {resetMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {resetMutation.error.message}
          </div>
        ) : null}
        <p className="small muted">Their existing sessions are signed out. Leave blank to generate a temporary password.</p>
        <FormField label="New password" htmlFor="admin-reset">
          <input
            id="admin-reset"
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </FormField>
      </Modal>
    </div>
  );
}
