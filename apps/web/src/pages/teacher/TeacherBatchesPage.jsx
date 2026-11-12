import { Link } from "react-router-dom";
import { CalendarDays, Layers, Users } from "lucide-react";
import { useTeacherBatches } from "../../hooks/useTeacherBatches.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";
import { formatDate, formatNumber } from "../../utils/format.js";

const statusTone = (status) => (status === "active" ? "success" : status === "upcoming" ? "info" : "neutral");

export function TeacherBatchesPage() {
  useDocumentTitle("My batches");
  const batchesQuery = useTeacherBatches();

  return (
    <div className="page-section">
      <PageHeader
        title="My batches"
        description="Only batches assigned to you by the office appear here."
      />

      {batchesQuery.isError ? <ErrorState error={batchesQuery.error} onRetry={batchesQuery.refetch} /> : null}

      {batchesQuery.isPending ? (
        <div className="grid-3">
          {[0, 1, 2].map((key) => (
            <div className="card" key={key}>
              <div className="card__body">
                <Skeleton height="1rem" width="70%" />
                <Skeleton height="0.8rem" width="45%" />
                <Skeleton height="0.8rem" width="60%" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {batchesQuery.data && batchesQuery.data.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Layers}
            title="No batches assigned"
            description="Ask an administrator to assign you to a batch from Admin → Teachers."
          />
        </SectionCard>
      ) : null}

      {batchesQuery.data && batchesQuery.data.length > 0 ? (
        <div className="grid-3">
          {batchesQuery.data.map((batch) => (
            <article className="card" key={batch.id}>
              <div className="card__body stack" style={{ gap: 12 }}>
                <div className="row row--between">
                  <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
                  <span className="mono small muted">{batch.code}</span>
                </div>
                <div>
                  <h2 className="card__title">{batch.name}</h2>
                  <p className="small muted">
                    {batch.courseName} ({batch.courseCode})
                  </p>
                </div>
                <div className="row row--wrap small">
                  <span className="row" style={{ gap: 6 }}>
                    <Users size={14} aria-hidden="true" /> {batch.studentCount} students
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <CalendarDays size={14} aria-hidden="true" /> {formatDate(batch.startDate)}
                  </span>
                </div>
                <div className="row row--wrap small muted">
                  <span>{formatNumber(batch.lessonCount)} lectures</span>
                  <span>·</span>
                  <span>{formatNumber(batch.assignmentCount)} assignments</span>
                </div>
                <Link className="btn btn--primary btn--sm" to={`/teacher/batches/${batch.id}`}>
                  Open workspace
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
