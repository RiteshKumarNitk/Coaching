import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Clock, PlayCircle, Trophy } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";
import { formatDateTime } from "../../utils/format.js";

const statusTone = (status) =>
  status === "published" ? "success" : status === "scheduled" ? "info" : status === "closed" ? "neutral" : "warning";

export function StudentExamsPage() {
  useDocumentTitle("Tests");
  const navigate = useNavigate();
  const examsQuery = useQuery({ queryKey: ["student", "exams"], queryFn: () => studentService.exams({ pageSize: 50 }) });

  const startMutation = useMutation({
    mutationFn: (examId) => studentService.startAttempt(examId),
    onSuccess: (data) => navigate(`/student/attempts/${data.attempt.id}`)
  });

  return (
    <>
      <PageHeader title="Tests" description="Scheduled tests for your batch, with results once published." />

      {startMutation.isError ? (
        <div className="alert alert--error" role="alert">
          {startMutation.error.message}
        </div>
      ) : null}

      {examsQuery.isError ? <ErrorState error={examsQuery.error} onRetry={examsQuery.refetch} /> : null}

      {examsQuery.isPending ? (
        <div className="stack" style={{ gap: 10 }}>
          {[0, 1].map((key) => (
            <div className="card" key={key}>
              <div className="card__body">
                <Skeleton height="1rem" width="55%" />
                <Skeleton height="0.8rem" width="35%" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {examsQuery.data && examsQuery.data.items.length === 0 ? (
        <SectionCard>
          <EmptyState icon={ClipboardList} title="No tests yet" description="Tests scheduled for your batch will appear here." />
        </SectionCard>
      ) : null}

      {examsQuery.data?.items.map((exam) => (
        <article className="card" key={exam.id}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between">
              <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
              <span className="small muted">
                {exam.batchName}
                {exam.subjectName ? ` · ${exam.subjectName}` : ""}
              </span>
            </div>
            <p className="cell-primary">{exam.title}</p>
            <p className="small muted">
              {formatDateTime(exam.startsAt)} → {formatDateTime(exam.endsAt)}
            </p>
            <div className="row row--wrap small muted" style={{ gap: 12 }}>
              <span className="row" style={{ gap: 4 }}>
                <Clock size={13} aria-hidden="true" /> {exam.durationMinutes} min
              </span>
              <span>
                {exam.totalMarks} marks · pass {exam.passMarks}
              </span>
              <span>
                Attempts {exam.myAttempts}/{exam.maxAttempts}
              </span>
            </div>

            {exam.result ? (
              <div className="alert alert--info" role="status">
                <Trophy size={16} aria-hidden="true" />
                <span>
                  {exam.result.obtainedMarks} / {exam.result.totalMarks} ({exam.result.percentage}%) ·{" "}
                  {exam.result.status === "pass" ? "Passed" : "Needs improvement"}
                </span>
              </div>
            ) : exam.myAttempts > 0 ? (
              <p className="small muted">Submitted — results will appear once your teacher publishes them.</p>
            ) : null}

            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              {exam.activeAttemptId ? (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => navigate(`/student/attempts/${exam.activeAttemptId}`)}
                >
                  <PlayCircle size={15} /> Continue attempt
                </button>
              ) : exam.canStart ? (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={startMutation.isPending}
                  onClick={() => startMutation.mutate(exam.id)}
                >
                  <PlayCircle size={15} /> {startMutation.isPending ? "Starting…" : "Start test"}
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </>
  );
}
