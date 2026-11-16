import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { adminOpsService } from "../../services/adminOps.service.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { formatDateTime } from "../../utils/format.js";

const ACTIONS = [
  "",
  "admin_user.created",
  "admin_user.updated",
  "admin_user.password_reset",
  "settings.updated",
  "student.created",
  "student.updated",
  "student.imported",
  "teacher.created",
  "payment.recorded",
  "payment.voided",
  "student_fee.waived",
  "exam.created",
  "exam.results_published",
  "announcement.published",
  "auth.login"
];

export function AdminAuditPage() {
  useDocumentTitle("Audit log");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const debouncedSearch = useDebouncedValue(search);

  const auditQuery = useQuery({
    queryKey: ["admin", "audit", { page, search: debouncedSearch, action }],
    queryFn: () =>
      adminOpsService.audit({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        action: action || undefined
      })
  });

  const columns = [
    { key: "when", header: "When", render: (row) => formatDateTime(row.createdAt) },
    { key: "actor", header: "Actor", render: (row) => row.actorEmail ?? "system" },
    { key: "action", header: "Action", render: (row) => <span className="mono small">{row.action}</span> },
    {
      key: "entity",
      header: "Entity",
      render: (row) => (
        <span className="mono small">
          {row.entityType}
          {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}
        </span>
      )
    },
    {
      key: "details",
      header: "Details",
      render: (row) =>
        Object.keys(row.metadata ?? {}).length === 0 ? (
          <span className="muted">—</span>
        ) : (
          <span className="small muted" title={JSON.stringify(row.metadata)}>
            {Object.entries(row.metadata)
              .slice(0, 3)
              .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
              .join(" · ")}
          </span>
        )
    },
    { key: "ip", header: "IP", render: (row) => <span className="mono small">{row.ip ?? "—"}</span> }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Audit log"
        description="Every administrative and authentication change, newest first. Read-only and append-only."
      />

      <SectionCard title="Events">
        <div className="toolbar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="Search actor, action or entity id"
            aria-label="Search audit log"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            className="input"
            style={{ maxWidth: 240 }}
            aria-label="Filter by action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            {ACTIONS.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "All actions"}
              </option>
            ))}
          </select>
        </div>

        {auditQuery.isError ? (
          <ErrorState error={auditQuery.error} onRetry={auditQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={auditQuery.data?.items}
            loading={auditQuery.isPending}
            empty={<EmptyState icon={ScrollText} title="No audit events" description="Actions appear here as the office works." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={auditQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>
    </div>
  );
}
