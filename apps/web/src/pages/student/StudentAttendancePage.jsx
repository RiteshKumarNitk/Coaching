import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { formatDate } from "../../utils/format.js";

const toneFor = (status) => (status === "present" ? "success" : status === "late" ? "warning" : "danger");

export function StudentAttendancePage() {
  useDocumentTitle("Attendance");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const attendanceQuery = useQuery({
    queryKey: ["student", "attendance", status, page],
    queryFn: () => studentService.attendance({ status, page, pageSize: 20 })
  });

  const summary = attendanceQuery.data?.summary;

  return (
    <>
      <PageHeader title="Attendance" description="Every session your teachers recorded, with your overall percentage." />

      {attendanceQuery.isError ? <ErrorState error={attendanceQuery.error} onRetry={attendanceQuery.refetch} /> : null}

      {summary ? (
        <SectionCard title="Summary" subtitle="Marked by your teachers">
          <div className="metric-block">
            <div className="stat-line">
              <span className="muted small">Overall</span>
              <strong>{summary.percentage === null ? "—" : `${summary.percentage}%`}</strong>
            </div>
            <div className="progress" aria-hidden="true">
              <div
                className={`progress__bar${summary.percentage !== null && summary.percentage >= 75 ? " progress__bar--success" : ""}`}
                style={{ width: `${summary.percentage ?? 0}%` }}
              />
            </div>
            <div className="metric-block__row">
              <span>Present / late</span>
              <strong>
                {summary.present} of {summary.total}
              </strong>
            </div>
            <div className="metric-block__row">
              <span>Absent</span>
              <strong>{summary.absent}</strong>
            </div>
            <hr className="divider" />
            <div className="metric-block__row">
              <span>This month</span>
              <strong>
                {summary.thisMonth.percentage === null ? "—" : `${summary.thisMonth.percentage}%`} ({summary.thisMonth.present}/
                {summary.thisMonth.total})
              </strong>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="History"
        subtitle={attendanceQuery.data ? `${attendanceQuery.data.total} session(s)` : undefined}
        action={
          <select
            className="input"
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            style={{ maxWidth: 140 }}
          >
            <option value="">All</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
          </select>
        }
      >
        <DataTable
          columns={[
            { key: "sessionDate", header: "Date", render: (row) => formatDate(row.sessionDate) },
            { key: "batchName", header: "Batch", render: (row) => row.batchName },
            {
              key: "status",
              header: "Status",
              render: (row) => <Badge tone={toneFor(row.status)}>{row.status}</Badge>
            },
            { key: "notes", header: "Note", render: (row) => row.notes || <span className="muted small">—</span> }
          ]}
          rows={attendanceQuery.data?.items}
          loading={attendanceQuery.isPending}
          empty={<EmptyState icon={CalendarCheck} title="No sessions recorded" description="Attendance appears once your teacher marks a class." />}
        />
        {attendanceQuery.data ? (
          <Pagination page={page} pageSize={20} total={attendanceQuery.data.total} onChange={setPage} />
        ) : null}
      </SectionCard>
    </>
  );
}
