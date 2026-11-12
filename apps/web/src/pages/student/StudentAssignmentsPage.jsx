import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { formatDateTime } from "../../utils/format.js";

const submissionTone = (status) =>
  status === "evaluated" ? "success" : status === "late" ? "warning" : status === "returned" ? "danger" : "brand";

const submissionLabel = (status) =>
  status === "evaluated" ? "Evaluated" : status === "late" ? "Submitted late" : status === "returned" ? "Returned" : "Submitted";

export function StudentAssignmentsPage() {
  useDocumentTitle("Assignments");
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState(null);
  const [contentText, setContentText] = useState("");
  const [fileUrl, setFileUrl] = useState("");

  const listQuery = useQuery({
    queryKey: ["student", "assignments", page],
    queryFn: () => studentService.assignments({ page, pageSize: 20 })
  });

  const detailQuery = useQuery({
    queryKey: ["student", "assignment", activeId],
    queryFn: () => studentService.assignment(activeId),
    enabled: Boolean(activeId)
  });

  useEffect(() => {
    if (!detailQuery.data) return;
    setContentText(detailQuery.data.submission?.contentText ?? "");
    setFileUrl(detailQuery.data.submission?.fileUrl ?? "");
  }, [detailQuery.data]);

  const submitMutation = useMutation({
    mutationFn: () => studentService.submitAssignment(activeId, { contentText, fileUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "assignment", activeId] });
      queryClient.invalidateQueries({ queryKey: ["student", "assignments"] });
    }
  });

  const detail = detailQuery.data;
  const evaluated = detail?.submission?.status === "evaluated";

  return (
    <>
      <PageHeader title="Assignments" description="Work set by your teachers, with marks and feedback." />

      {listQuery.isError ? <ErrorState error={listQuery.error} onRetry={listQuery.refetch} /> : null}

      {listQuery.isPending ? (
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

      {listQuery.data && listQuery.data.items.length === 0 ? (
        <SectionCard>
          <EmptyState icon={ClipboardList} title="No assignments" description="New work from your teachers will appear here." />
        </SectionCard>
      ) : null}

      {listQuery.data?.items.map((assignment) => (
        <article className="card" key={assignment.id}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between">
              <Badge tone="brand">{assignment.subjectName}</Badge>
              {assignment.submission ? (
                <Badge tone={submissionTone(assignment.submission.status)}>
                  {submissionLabel(assignment.submission.status)}
                </Badge>
              ) : (
                <Badge tone="neutral">Not submitted</Badge>
              )}
            </div>
            <p className="cell-primary">{assignment.title}</p>
            <p className="small muted">
              Due {assignment.dueAt ? formatDateTime(assignment.dueAt) : "any time"} · {assignment.maxMarks} marks
            </p>
            {assignment.submission?.marksAwarded !== null && assignment.submission?.marksAwarded !== undefined ? (
              <p className="small">
                <strong>
                  {assignment.submission.marksAwarded} / {assignment.maxMarks}
                </strong>{" "}
                marks
              </p>
            ) : null}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  submitMutation.reset();
                  setActiveId(assignment.id);
                }}
              >
                {assignment.submission ? "View submission" : "Open & submit"}
              </button>
            </div>
          </div>
        </article>
      ))}

      {listQuery.data ? (
        <Pagination page={page} pageSize={20} total={listQuery.data.total} onChange={setPage} />
      ) : null}

      <Modal
        open={Boolean(activeId)}
        title={detail?.assignment.title ?? "Assignment"}
        description={detail ? `${detail.assignment.subjectName} · ${detail.assignment.maxMarks} marks` : "Loading…"}
        onClose={() => setActiveId(null)}
        size="lg"
        footer={
          detail && !evaluated ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setActiveId(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? "Sending…" : detail.submission ? "Resubmit" : "Submit work"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => setActiveId(null)}>
              Close
            </button>
          )
        }
      >
        {detailQuery.isError ? <ErrorState error={detailQuery.error} onRetry={detailQuery.refetch} /> : null}

        {detail ? (
          <div className="stack" style={{ gap: 14 }}>
            {detail.assignment.instructions ? (
              <div>
                <p className="label">Instructions</p>
                <p className="small">{detail.assignment.instructions}</p>
              </div>
            ) : null}

            <div className="row row--wrap small muted" style={{ gap: 10 }}>
              <span>Due {detail.assignment.dueAt ? formatDateTime(detail.assignment.dueAt) : "any time"}</span>
              {detail.submission ? <span>Submitted {formatDateTime(detail.submission.submittedAt)}</span> : null}
            </div>

            {submitMutation.isError ? (
              <div className="alert alert--error" role="alert">
                {submitMutation.error.message}
              </div>
            ) : null}

            {evaluated ? (
              <div className="alert alert--success" role="status">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>
                  Scored {detail.submission.marksAwarded} / {detail.assignment.maxMarks}
                  {detail.submission.feedback ? ` — ${detail.submission.feedback}` : ""}
                </span>
              </div>
            ) : null}

            {detail.submission ? (
              <div className="detail-list">
                <div className="detail-row">
                  <dt>Your answer</dt>
                  <dd>{detail.submission.contentText || "—"}</dd>
                </div>
                <div className="detail-row">
                  <dt>Link</dt>
                  <dd>
                    {detail.submission.fileUrl ? (
                      <a href={detail.submission.fileUrl} target="_blank" rel="noreferrer noopener">
                        {detail.submission.fileUrl}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="detail-row">
                  <dt>Status</dt>
                  <dd>{submissionLabel(detail.submission.status)}</dd>
                </div>
              </div>
            ) : null}

            {!evaluated ? (
              <div className="stack" style={{ gap: 10 }}>
                <FormField label="Your answer" htmlFor="submission-text" hint="Type your working, or paste a link below.">
                  <textarea
                    id="submission-text"
                    className="input"
                    rows={4}
                    value={contentText}
                    onChange={(event) => setContentText(event.target.value)}
                  />
                </FormField>
                <FormField label="Link to your work" htmlFor="submission-link" hint="Optional https:// Drive link.">
                  <input
                    id="submission-link"
                    className="input"
                    placeholder="https://drive.google.com/…"
                    value={fileUrl}
                    onChange={(event) => setFileUrl(event.target.value)}
                  />
                </FormField>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
