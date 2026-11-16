import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { adminOpsService } from "../../services/adminOps.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";
import { formatCurrency, formatNumber } from "../../utils/format.js";

const monthLabel = (month) => {
  if (!month) return "";
  const [year, value] = month.split("-");
  return new Date(Number(year), Number(value) - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

export function AdminReportsPage() {
  useDocumentTitle("Reports");
  const reportQuery = useQuery({ queryKey: ["admin", "reports"], queryFn: adminOpsService.reports });

  if (reportQuery.isError) {
    return <ErrorState error={reportQuery.error} onRetry={reportQuery.refetch} />;
  }

  const data = reportQuery.data;

  return (
    <div className="page-section">
      <PageHeader
        title="Reports"
        description="Fee collection, attendance and exam performance for the whole institute."
      />

      {!data ? (
        <Skeleton height="12rem" />
      ) : (
        <>
          <div className="grid-3">
            <div className="card">
              <div className="card__body">
                <p className="small muted">Collected (all time)</p>
                <p className="card__title">{formatCurrency(data.totals.collectedAllTime)}</p>
                <p className="small muted">{formatNumber(data.totals.receipts)} receipts</p>
              </div>
            </div>
            <div className="card">
              <div className="card__body">
                <p className="small muted">Outstanding</p>
                <p className="card__title">{formatCurrency(data.totals.outstanding)}</p>
                <p className="small muted">across all open invoices</p>
              </div>
            </div>
            <div className="card">
              <div className="card__body">
                <p className="small muted">Students · teachers · batches</p>
                <p className="card__title">
                  {formatNumber(data.totals.students)} · {formatNumber(data.totals.teachers)} ·{" "}
                  {formatNumber(data.totals.activeBatches)}
                </p>
                <p className="small muted">{formatNumber(data.totals.exams)} exams created</p>
              </div>
            </div>
          </div>

          <SectionCard
            title="Fee collection by month"
            subtitle="Last six months, voided receipts excluded"
            action={
              <a className="btn btn--ghost btn--sm" href={adminOpsService.feesCsvUrl} download>
                <Download size={14} /> Fees CSV
              </a>
            }
          >
            <DataTable
              columns={[
                { key: "month", header: "Month", render: (row) => monthLabel(row.month) },
                { key: "collected", header: "Collected", render: (row) => formatCurrency(row.collected) },
                { key: "receipts", header: "Receipts", render: (row) => formatNumber(row.receipts) }
              ]}
              rows={data.feesByMonth}
              rowKey="month"
              empty={<EmptyState title="No receipts yet" description="Collections appear here as payments are recorded." />}
            />
          </SectionCard>

          <SectionCard
            title="Attendance by batch"
            subtitle="Last 30 days"
            action={
              <a className="btn btn--ghost btn--sm" href={adminOpsService.attendanceCsvUrl} download>
                <Download size={14} /> Attendance CSV
              </a>
            }
          >
            <DataTable
              columns={[
                { key: "batch", header: "Batch", render: (row) => row.batchName },
                { key: "marked", header: "Marked", render: (row) => formatNumber(row.marked) },
                { key: "present", header: "Present", render: (row) => formatNumber(row.present) },
                { key: "absent", header: "Absent", render: (row) => formatNumber(row.absent) },
                { key: "late", header: "Late", render: (row) => formatNumber(row.late) },
                {
                  key: "rate",
                  header: "Attendance",
                  render: (row) => <Badge tone={row.rate >= 75 ? "success" : "warning"}>{row.rate}%</Badge>
                }
              ]}
              rows={data.attendanceByBatch}
              rowKey="batchId"
              empty={<EmptyState title="No attendance marked" description="Teachers mark attendance in their batch workspace." />}
            />
          </SectionCard>

          <SectionCard title="Exam performance" subtitle="Most recent exams with published results">
            <DataTable
              columns={[
                { key: "title", header: "Exam", render: (row) => row.title },
                { key: "results", header: "Results", render: (row) => formatNumber(row.results) },
                { key: "average", header: "Average", render: (row) => `${row.averagePercentage}%` },
                { key: "passed", header: "Passed", render: (row) => formatNumber(row.passed) }
              ]}
              rows={data.examPerformance}
              rowKey="examId"
              empty={<EmptyState title="No results yet" description="Publish exam results to see performance here." />}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
