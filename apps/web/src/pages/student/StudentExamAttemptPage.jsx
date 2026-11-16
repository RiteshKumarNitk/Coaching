import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Flag } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";

const formatClock = (seconds) => {
  const safe = Math.max(0, seconds ?? 0);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
};

export function StudentExamAttemptPage() {
  const { id } = useParams();
  useDocumentTitle("Test attempt");
  const queryClient = useQueryClient();

  const attemptQuery = useQuery({
    queryKey: ["student", "attempt", id],
    queryFn: () => studentService.attempt(id),
    refetchOnWindowFocus: false
  });

  const [answers, setAnswers] = useState({});
  const [seconds, setSeconds] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const firstRender = useRef(true);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (!attemptQuery.data) return;
    const next = {};
    for (const response of attemptQuery.data.responses) {
      next[response.questionId] = {
        selectedOptionId: response.selectedOptionId ?? "",
        answerText: response.answerText ?? "",
        markedForReview: response.markedForReview
      };
    }
    setAnswers(next);
  }, [attemptQuery.data]);

  // The server's expires_at is the only authority on time left. A local counter loses
  // time whenever the tab is backgrounded (browsers throttle timers), which used to let
  // a student believe they had minutes left after the attempt had already expired.
  const expiresAtMs = attemptQuery.data?.attempt.expiresAt
    ? new Date(attemptQuery.data.attempt.expiresAt).getTime()
    : null;

  useEffect(() => {
    if (!attemptQuery.data) return undefined;
    const fallback = attemptQuery.data.attempt.remainingSeconds ?? 0;
    const tick = () => {
      setSeconds(expiresAtMs ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)) : fallback);
    };
    tick();
    const timer = setInterval(tick, 1000);
    // Recompute the moment the tab comes back so a throttled countdown jumps to the truth.
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tick);
    };
  }, [attemptQuery.data, expiresAtMs]);

  const saveMutation = useMutation({
    mutationFn: (payload) => studentService.saveAnswers(id, payload)
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (payload.length > 0) {
        // Best effort: if the clock has already run out the server rejects the save, but
        // whatever it did receive must still be submitted rather than left hanging.
        await studentService.saveAnswers(id, payload).catch(() => {});
      }
      return studentService.submitAttempt(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student", "exams"] });
      queryClient.invalidateQueries({ queryKey: ["student", "results"] });
    }
  });

  function buildPayload() {
    return Object.entries(answers)
      .map(([questionId, value]) => ({
        questionId,
        selectedOptionId: value.selectedOptionId || undefined,
        answerText: value.answerText || undefined,
        markedForReview: Boolean(value.markedForReview)
      }))
      .filter((answer) => answer.selectedOptionId || answer.answerText);
  }

  const result = submitMutation.data;
  const inProgress = attemptQuery.data?.attempt.status === "in_progress" && !result;

  useEffect(() => {
    if (!attemptQuery.data || !inProgress) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      // Saving after expiry only produces a "time is up" error; the submit takes over.
      if (expiresAtMs && Date.now() >= expiresAtMs) return;
      const payload = buildPayload();
      if (payload.length > 0) saveMutation.mutate(payload);
    }, 1200);
    return () => clearTimeout(timeout);
  }, [answers, expiresAtMs]);

  useEffect(() => {
    if (!inProgress || seconds === null || seconds > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    submitMutation.mutate();
  }, [seconds, inProgress, submitMutation]);

  if (attemptQuery.isPending) return <DashboardSkeleton cards={1} panels={3} />;
  if (attemptQuery.isError) return <ErrorState error={attemptQuery.error} onRetry={attemptQuery.refetch} />;

  const { attempt, exam, questions } = attemptQuery.data;
  const answeredCount = questions.filter((question) => {
    const value = answers[question.id];
    return Boolean(value?.selectedOptionId || value?.answerText);
  }).length;

  if (result) {
    return (
      <SectionCard title="Submitted" subtitle={exam.title}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="alert alert--success" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              Your answers are in. {result.pending ? "Subjective answers are waiting for your teacher's evaluation." : `Score ${result.score} / ${result.totalMarks}.`}
            </span>
          </div>
          <p className="small muted">Results become visible on the Tests page once your teacher publishes them.</p>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn btn--primary btn--sm" to="/student/exams">
              Back to tests
            </Link>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (attempt.status !== "in_progress") {
    return (
      <SectionCard title={exam.title} subtitle={`Attempt ${attempt.attemptNo}`}>
        <EmptyState
          icon={Clock}
          title="This attempt is closed"
          description={`Status: ${attempt.status}. Open the Tests page to see your result or start another attempt.`}
        />
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn--ghost btn--sm" to="/student/exams">
            Back to tests
          </Link>
        </div>
      </SectionCard>
    );
  }

  return (
    <>
      <div className="row row--between" style={{ alignItems: "center" }}>
        <div>
          <p className="cell-primary">{exam.title}</p>
          <p className="small muted">
            {answeredCount} of {questions.length} answered
          </p>
        </div>
        <Badge tone={seconds !== null && seconds < 300 ? "danger" : "brand"}>
          <Clock size={12} aria-hidden="true" /> {formatClock(seconds)}
        </Badge>
      </div>

      {exam.instructions ? (
        <div className="alert alert--info" role="note">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{exam.instructions}</span>
        </div>
      ) : null}

      {saveMutation.isError ? (
        <div className="alert alert--error" role="alert">
          Answers could not be saved: {saveMutation.error.message}
        </div>
      ) : null}

      {submitMutation.isError && !confirmOpen ? (
        <div className="alert alert--error" role="alert">
          The attempt could not be submitted: {submitMutation.error.message}. Answers already saved are kept — use
          “Submit test” to try again.
        </div>
      ) : null}

      {questions.map((question, index) => {
        const value = answers[question.id] ?? { selectedOptionId: "", answerText: "", markedForReview: false };
        return (
          <SectionCard
            key={question.id}
            title={`Question ${index + 1}`}
            subtitle={`${question.marks} marks${question.negativeMarks ? ` · −${question.negativeMarks} if wrong` : ""}`}
            action={
              <button
                type="button"
                className={value.markedForReview ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"}
                aria-pressed={value.markedForReview}
                onClick={() =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: { ...value, markedForReview: !value.markedForReview }
                  }))
                }
              >
                <Flag size={13} /> Review
              </button>
            }
          >
            <div className="stack" style={{ gap: 10 }}>
              <p>{question.questionText}</p>
              {question.questionType === "mcq" ? (
                <div className="stack" style={{ gap: 8 }}>
                  {question.options.map((option) => (
                    <label key={option.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        checked={value.selectedOptionId === option.id}
                        onChange={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: { ...value, selectedOptionId: option.id }
                          }))
                        }
                      />
                      <span className="small">{option.text}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Write your answer"
                  value={value.answerText}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: { ...value, answerText: event.target.value }
                    }))
                  }
                />
              )}
            </div>
          </SectionCard>
        );
      })}

      <div className="row row--between" style={{ gap: 8 }}>
        <span className="small muted">{saveMutation.isSuccess ? "Answers saved" : "Autosave is on"}</span>
        <button
          type="button"
          className="btn btn--primary"
          disabled={submitMutation.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {submitMutation.isPending ? "Submitting…" : "Submit test"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit test?"
        description={`You answered ${answeredCount} of ${questions.length} questions. You cannot change answers after submitting.`}
        confirmLabel="Submit test"
        tone="primary"
        busy={submitMutation.isPending}
        error={submitMutation.error?.message}
        onConfirm={() => submitMutation.mutate()}
        onClose={() => {
          setConfirmOpen(false);
          submitMutation.reset();
        }}
      />
    </>
  );
}
