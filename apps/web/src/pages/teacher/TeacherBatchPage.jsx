import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ClipboardCheck, FileText, Video } from "lucide-react";
import { useTeacherBatch } from "../../hooks/useTeacherBatches.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { DAY_LABELS, formatDate, formatTimeRange } from "../../utils/format.js";

const statusTone = (status) => (status === "active" ? "success" : status === "upcoming" ? "info" : "neutral");

export function TeacherBatchPage() {
  const { id } = useParams();
  useDocumentTitle("Batch workspace");
  const batchQuery = useTeacherBatch(id);

  if (batchQuery.isPending) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/teacher/batches">
          <ArrowLeft size={14} /> My batches
        </Link>
        <DashboardSkeleton cards={3} panels={2} />
      </div>
    );
  }

  if (batchQuery.isError) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/teacher/batches">
          <ArrowLeft size={14} /> My batches
        </Link>
        <ErrorState error={batchQuery.error} onRetry={batchQuery.refetch} />
      </div>
    );
  }

  const { batch, subjects, students, schedule } = batchQuery.data;

  return (
    <div className="page-section">
      <Link className="back-link" to="/teacher/batches">
        <ArrowLeft size={14} /> My batches
      </Link>

      <section className="detail-hero">
        <div>
          <h1>{batch.name}</h1>
          <p>{batch.code}</p>
          <div className="row row--wrap" style={{ marginTop: 8 }}>
            <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
            <Badge tone="brand">{batch.studentCount} students</Badge>
            <Badge tone="accent">
              {formatDate(batch.startDate)} → {formatDate(batch.endDate)}
            </Badge>
          </div>
        </div>
      </section>

      <div className="row row--wrap" style={{ gap: 8 }}>
        <Link className="btn btn--primary btn--sm" to={`/teacher/attendance?batch=${batch.id}`}>
          <ClipboardCheck size={15} /> Mark attendance
        </Link>
        <Link className="btn btn--ghost btn--sm" to={`/teacher/lectures?batch=${batch.id}`}>
          <Video size={15} /> Lectures
        </Link>
        <Link className="btn btn--ghost btn--sm" to={`/teacher/materials?batch=${batch.id}`}>
          <FileText size={15} /> Study material
        </Link>
        <Link className="btn btn--ghost btn--sm" to={`/teacher/assignments?batch=${batch.id}`}>
          <FileText size={15} /> Assignments
        </Link>
      </div>

      <div className="grid-2">
        <SectionCard title="Subjects" subtitle="Subjects mapped to this batch">
          <div className="row row--wrap" style={{ gap: 8 }}>
            {subjects.length === 0 ? (
              <p className="small muted">No subjects mapped yet. Ask the office to add them.</p>
            ) : (
              subjects.map((subject) => (
                <Badge key={subject.id} tone="brand">
                  {subject.name}
                </Badge>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard title="Timetable" subtitle="Weekly class slots">
          {schedule.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No timetable yet" description="The office sets class slots for this batch." />
          ) : (
            <ul className="list">
              {schedule.map((slot) => (
                <li className="list__item" key={slot.id}>
                  <div className="list__main">
                    <p className="list__title">
                      {DAY_LABELS[slot.day_of_week]} · {slot.subject_name || "Class"}
                    </p>
                    <p className="list__meta">
                      {formatTimeRange(slot.start_time, slot.end_time)}
                      {slot.room ? ` · ${slot.room}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Students" subtitle={`${students.length} active enrolment(s)`}>
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => (
                <div>
                  <p className="cell-primary">{row.full_name}</p>
                  <p className="cell-sub">{row.email}</p>
                </div>
              )
            },
            { key: "enrollmentNo", header: "Enrolment", render: (row) => <span className="mono">{row.enrollment_no}</span> },
            { key: "enrolledAt", header: "Enrolled", render: (row) => formatDate(row.enrolled_at) }
          ]}
          rows={students}
          rowKey="student_id"
          loading={false}
          empty={<EmptyState icon={CalendarDays} title="No students yet" description="Students appear once the office enrols them." />}
        />
      </SectionCard>
    </div>
  );
}
