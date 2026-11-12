import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CheckCheck, ClipboardCheck, Save } from "lucide-react";
import { teacherService } from "../../services/teacher.service.js";
import { useTeacherBatches } from "../../hooks/useTeacherBatches.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { BatchSelect } from "../../components/BatchSelect.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { todayInput } from "../../utils/format.js";

const STATUS_OPTIONS = [
  { value: "present", label: "Present" },
  { value: "absent", label: "Absent" },
  { value: "late", label: "Late" }
];

export function TeacherAttendancePage() {
  useDocumentTitle("Attendance");
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const batchesQuery = useTeacherBatches();

  const batchId = params.get("batch") ?? "";
  const [date, setDate] = useState(todayInput());
  const [statuses, setStatuses] = useState({});
  const [saved, setSaved] = useState(null);

  const attendanceQuery = useQuery({
    queryKey: ["teacher", "attendance", batchId, date],
    queryFn: () => teacherService.attendance(batchId, date),
    enabled: Boolean(batchId && date)
  });

  useEffect(() => {
    if (!attendanceQuery.data) return;
    const next = {};
    for (const student of attendanceQuery.data.students) {
      next[student.studentId] = student.status ?? "present";
    }
    setStatuses(next);
    setSaved(null);
  }, [attendanceQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      teacherService.saveAttendance(batchId, {
        date,
        records: attendanceQuery.data.students.map((student) => ({
          studentId: student.studentId,
          status: statuses[student.studentId] ?? "present"
        }))
      }),
    onSuccess: (data) => {
      setSaved(`Attendance saved for ${data.markedCount} of ${data.total} student(s).`);
      queryClient.invalidateQueries({ queryKey: ["teacher", "attendance", batchId, date] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "teacher"] });
    }
  });

  const students = attendanceQuery.data?.students ?? [];
  const markedAlready = attendanceQuery.data?.markedCount ?? 0;

  return (
    <div className="page-section">
      <PageHeader title="Attendance" description="Mark today's register; re-saving a date updates it instead of duplicating." />

      <SectionCard>
        <div className="form-grid">
          <BatchSelect
            batches={batchesQuery.data}
            value={batchId}
            onChange={(value) => setParams(value ? { batch: value } : {})}
          />
          <div className="field">
            <label className="label" htmlFor="attendance-date">
              Session date
            </label>
            <input
              id="attendance-date"
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>
      </SectionCard>

      {!batchId ? (
        <SectionCard>
          <EmptyState icon={ClipboardCheck} title="Choose a batch" description="Pick one of your batches to load its register." />
        </SectionCard>
      ) : null}

      {batchId && attendanceQuery.isError ? (
        <ErrorState error={attendanceQuery.error} onRetry={attendanceQuery.refetch} />
      ) : null}

      {batchId && attendanceQuery.data ? (
        <SectionCard
          title={`Register · ${date}`}
          subtitle={`${markedAlready} of ${students.length} already marked`}
          action={
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() =>
                  setStatuses(Object.fromEntries(students.map((student) => [student.studentId, "present"])))
                }
              >
                <CheckCheck size={14} /> All present
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={students.length === 0 || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <Save size={14} /> {saveMutation.isPending ? "Saving…" : "Save attendance"}
              </button>
            </div>
          }
        >
          {saved ? (
            <div className="alert alert--success" role="status" style={{ marginBottom: 12 }}>
              {saved}
            </div>
          ) : null}
          {saveMutation.isError ? (
            <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
              {saveMutation.error.message}
            </div>
          ) : null}

          {students.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No students enrolled" description="Attendance needs at least one active enrolment." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Enrolment</th>
                    <th scope="col">Status</th>
                    <th scope="col">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.studentId}>
                      <td data-label="Student">
                        <p className="cell-primary">{student.fullName}</p>
                      </td>
                      <td data-label="Enrolment">
                        <span className="mono">{student.enrollmentNo}</span>
                      </td>
                      <td data-label="Status">
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          {STATUS_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={
                                (statuses[student.studentId] ?? "present") === option.value
                                  ? "btn btn--primary btn--sm"
                                  : "btn btn--ghost btn--sm"
                              }
                              aria-pressed={(statuses[student.studentId] ?? "present") === option.value}
                              onClick={() =>
                                setStatuses((current) => ({ ...current, [student.studentId]: option.value }))
                              }
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td data-label="Saved">
                        {student.marked ? <Badge tone="success">{student.status}</Badge> : <span className="muted small">Not marked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}
