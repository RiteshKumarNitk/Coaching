import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Receipt, Wallet } from "lucide-react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { guardianService } from "../../services/guardian.service.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/format.js";

const attendanceTone = (status) => (status === "present" ? "success" : status === "late" ? "warning" : "danger");
const feeTone = (status) =>
  status === "paid" ? "success" : status === "partial" ? "warning" : status === "waived" ? "neutral" : "danger";

export function GuardianPage() {
  useDocumentTitle("Guardian portal");
  const [childId, setChildId] = useState("");
  const [attendancePage, setAttendancePage] = useState(1);
  const [resultsPage, setResultsPage] = useState(1);

  const childrenQuery = useQuery({ queryKey: ["guardian", "children"], queryFn: guardianService.children });
  const children = childrenQuery.data?.items ?? [];
  const activeChildId = childId || children[0]?.id || "";
  const child = children.find((row) => row.id === activeChildId);

  const attendanceQuery = useQuery({
    queryKey: ["guardian", "attendance", activeChildId, attendancePage],
    queryFn: () => guardianService.attendance(activeChildId, { page: attendancePage, pageSize: 20 }),
    enabled: Boolean(activeChildId)
  });
  const feesQuery = useQuery({
    queryKey: ["guardian", "fees", activeChildId],
    queryFn: () => guardianService.fees(activeChildId),
    enabled: Boolean(activeChildId)
  });
  const resultsQuery = useQuery({
    queryKey: ["guardian", "results", activeChildId, resultsPage],
    queryFn: () => guardianService.results(activeChildId, { page: resultsPage, pageSize: 20 }),
    enabled: Boolean(activeChildId)
  });

  if (childrenQuery.isPending) return <DashboardSkeleton cards={2} panels={2} />;
  if (childrenQuery.isError) return <ErrorState error={childrenQuery.error} onRetry={childrenQuery.refetch} />;

  if (children.length === 0) {
    return (
      <>
        <PageHeader title="Guardian portal" description="Attendance, fees and published results for your child." />
        <EmptyState
          icon={Wallet}
          title="No student linked"
          description="Ask the institute office to link your guardian account to your child's admission."
        />
      </>
    );
  }

  const summary = attendanceQuery.data?.summary;
  const fees = feesQuery.data;

  return (
    <>
      <PageHeader
        title="Guardian portal"
        description="Read-only view: attendance, fees and published results for your child."
      />

      <SectionCard
        title={child?.fullName ?? "Your child"}
        subtitle={[child?.enrollmentNo, child?.batchName, child?.courseName].filter(Boolean).join(" · ")}
        action={
          children.length > 1 ? (
            <select
              className="input"
              aria-label="Choose child"
              value={activeChildId}
              onChange={(event) => {
                setChildId(event.target.value);
                setAttendancePage(1);
                setResultsPage(1);
              }}
              style={{ maxWidth: 220 }}
            >
              {children.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.fullName}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        <p className="small muted">
          This portal is view-only. Fee payments are recorded at the institute office; contact the office for any
          correction.
        </p>
      </SectionCard>

      <div className="grid-2">
        <SectionCard title="Attendance" subtitle="Marked by teachers">
          {attendanceQuery.isError ? (
            <ErrorState error={attendanceQuery.error} onRetry={attendanceQuery.refetch} />
          ) : (
            <div className="metric-block">
              <div className="stat-line">
                <span className="muted small">Overall</span>
                <strong>{summary?.percentage === null || summary === undefined ? "—" : `${summary.percentage}%`}</strong>
              </div>
              <div className="progress" aria-hidden="true">
                <div className="progress__bar" style={{ width: `${summary?.percentage ?? 0}%` }} />
              </div>
              <div className="metric-block__row">
                <span>Present / late</span>
                <strong>
                  {summary ? `${summary.present} of ${summary.total}` : "—"}
                </strong>
              </div>
              <div className="metric-block__row">
                <span>Absent</span>
                <strong>{summary?.absent ?? "—"}</strong>
              </div>
              <div className="metric-block__row">
                <span>This month</span>
                <strong>
                  {summary?.thisMonth.percentage === null || summary === undefined
                    ? "—"
                    : `${summary.thisMonth.percentage}%`}
                </strong>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Fees" subtitle="Invoices and receipts">
          {feesQuery.isError ? <ErrorState error={feesQuery.error} onRetry={feesQuery.refetch} /> : null}
          {fees ? (
            <div className="metric-block">
              <div className="stat-line">
                <span className="muted small">Paid</span>
                <strong>{formatCurrency(fees.summary.paid)}</strong>
              </div>
              <div className="progress" aria-hidden="true">
                <div
                  className="progress__bar progress__bar--accent"
                  style={{
                    width: `${fees.summary.billed > 0 ? Math.round((fees.summary.paid / fees.summary.billed) * 100) : 0}%`
                  }}
                />
              </div>
              <div className="metric-block__row">
                <span>Total billed</span>
                <strong>{formatCurrency(fees.summary.billed)}</strong>
              </div>
              <div className="metric-block__row">
                <span>Pending</span>
                <strong>{formatCurrency(fees.summary.pending)}</strong>
              </div>
              <div className="metric-block__row">
                <span>Open invoices</span>
                <strong>{fees.summary.openInvoices}</strong>
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard title="Attendance history" subtitle={attendanceQuery.data ? `${attendanceQuery.data.total} session(s)` : undefined}>
        <DataTable
          columns={[
            { key: "sessionDate", header: "Date", render: (row) => formatDate(row.sessionDate) },
            { key: "batchName", header: "Batch", render: (row) => row.batchName },
            { key: "status", header: "Status", render: (row) => <Badge tone={attendanceTone(row.status)}>{row.status}</Badge> },
            { key: "notes", header: "Note", render: (row) => row.notes || <span className="muted small">—</span> }
          ]}
          rows={attendanceQuery.data?.items}
          loading={attendanceQuery.isPending}
          empty={<EmptyState icon={CalendarCheck} title="No sessions yet" description="Attendance appears once a teacher marks a class." />}
        />
        {attendanceQuery.data ? (
          <Pagination page={attendancePage} pageSize={20} total={attendanceQuery.data.total} onChange={setAttendancePage} />
        ) : null}
      </SectionCard>

      <SectionCard title="Invoices" subtitle={fees ? `${fees.invoices.length} invoice(s)` : undefined}>
        {fees && fees.invoices.length > 0 ? (
          <ul className="list">
            {fees.invoices.map((invoice) => (
              <li className="list__item" key={invoice.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                <div className="row row--between">
                  <p className="list__title">{invoice.structureName}</p>
                  <Badge tone={feeTone(invoice.status)}>{invoice.status}</Badge>
                </div>
                <p className="list__meta">
                  {invoice.courseName} · {invoice.academicYear}
                  {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ""}
                </p>
                <div className="row row--between small">
                  <span>
                    {formatCurrency(invoice.paidAmount)} paid of {formatCurrency(invoice.netAmount)}
                  </span>
                  <strong>{formatCurrency(invoice.pendingAmount)} pending</strong>
                </div>
                {invoice.installments?.length > 1 ? (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                    {invoice.installments.map((installment) => (
                      <li
                        key={installment.seq}
                        className="small"
                        style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                      >
                        <span>
                          #{installment.seq} · {installment.dueDate ? formatDate(installment.dueDate) : "no due date"}
                        </span>
                        <span>
                          {formatCurrency(installment.amount)}{" "}
                          <Badge
                            tone={
                              installment.status === "paid"
                                ? "success"
                                : installment.status === "overdue"
                                  ? "danger"
                                  : installment.status === "partial"
                                    ? "warning"
                                    : "neutral"
                            }
                          >
                            {installment.status}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Wallet} title="No invoices" description="Fee invoices raised by the office appear here." />
        )}
      </SectionCard>

      <SectionCard title="Receipts" subtitle={fees ? `${fees.payments.length} payment(s)` : undefined}>
        {fees && fees.payments.length > 0 ? (
          <ul className="list">
            {fees.payments.map((payment) => (
              <li className="list__item" key={payment.id}>
                <div className="list__main">
                  <p className="list__title">{payment.receiptNo}</p>
                  <p className="list__meta">
                    {formatDateTime(payment.paidAt)} · {payment.method.replaceAll("_", " ")}
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </p>
                </div>
                <span className="list__side">{formatCurrency(payment.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Receipt} title="No receipts yet" description="Receipts for office payments appear here." />
        )}
      </SectionCard>

      <SectionCard title="Results" subtitle="Published tests only">
        {resultsQuery.isError ? <ErrorState error={resultsQuery.error} onRetry={resultsQuery.refetch} /> : null}
        <DataTable
          columns={[
            { key: "title", header: "Test", render: (row) => row.title },
            { key: "subjectName", header: "Subject", render: (row) => row.subjectName || "—" },
            {
              key: "marks",
              header: "Marks",
              render: (row) => `${row.obtainedMarks} / ${row.totalMarks}`
            },
            { key: "percentage", header: "%", render: (row) => `${row.percentage}%` },
            { key: "status", header: "Result", render: (row) => <Badge tone={row.status === "pass" ? "success" : "danger"}>{row.status}</Badge> },
            { key: "publishedAt", header: "Published", render: (row) => formatDate(row.publishedAt) }
          ]}
          rows={resultsQuery.data?.items}
          loading={resultsQuery.isPending}
          empty={
            <EmptyState
              icon={CalendarCheck}
              title="No published results"
              description="Results appear here after the teacher publishes them."
            />
          }
        />
        {resultsQuery.data ? (
          <Pagination page={resultsPage} pageSize={20} total={resultsQuery.data.total} onChange={setResultsPage} />
        ) : null}
      </SectionCard>
    </>
  );
}
