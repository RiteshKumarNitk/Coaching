import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardList, Plus, Trash2 } from "lucide-react";
import { examService } from "../../services/exams.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { formatDateTime } from "../../utils/format.js";

const statusTone = (status) =>
  status === "published" ? "success" : status === "scheduled" ? "info" : status === "closed" ? "neutral" : "warning";

const blankQuestion = {
  questionType: "mcq",
  questionText: "",
  marks: 1,
  negativeMarks: 0,
  options: ["", "", "", ""],
  correctIndex: 0,
  modelAnswer: "",
  sortOrder: 0
};

export function ExamDetailPage({ service = examService, scope = "admin", basePath = "/admin" }) {
  const { id } = useParams();
  useDocumentTitle("Exam");
  const queryClient = useQueryClient();

  const examQuery = useQuery({ queryKey: [scope, "exam", id], queryFn: () => service.get(id) });

  const [questionModal, setQuestionModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [questionForm, setQuestionForm] = useState(blankQuestion);
  const [deletingQuestion, setDeletingQuestion] = useState(null);
  const [reviewAttempt, setReviewAttempt] = useState(null);
  const [awards, setAwards] = useState({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [scope, "exam", id] });
    queryClient.invalidateQueries({ queryKey: [scope, "exams"] });
  };

  const addMutation = useMutation({
    mutationFn: (payload) => service.addQuestion(id, payload),
    onSuccess: () => {
      setQuestionModal(false);
      setEditingQuestion(null);
      setQuestionForm(blankQuestion);
      invalidate();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => service.updateQuestion(editingQuestion.id, payload),
    onSuccess: () => {
      setQuestionModal(false);
      setEditingQuestion(null);
      setQuestionForm(blankQuestion);
      invalidate();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => service.deleteQuestion(deletingQuestion.id),
    onSuccess: () => {
      setDeletingQuestion(null);
      invalidate();
    }
  });

  const statusMutation = useMutation({
    mutationFn: (status) => service.update(id, { status }),
    onSuccess: invalidate
  });

  const publishMutation = useMutation({
    mutationFn: () => service.publishResults(id),
    onSuccess: invalidate
  });

  const responsesQuery = useQuery({
    queryKey: [scope, "attempt", reviewAttempt],
    queryFn: () => service.attemptResponses(reviewAttempt),
    enabled: Boolean(reviewAttempt)
  });

  const evaluateMutation = useMutation({
    mutationFn: ({ responseId, marks }) => service.evaluateResponse(responseId, marks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [scope, "attempt", reviewAttempt] });
      invalidate();
    }
  });

  useEffect(() => {
    if (!responsesQuery.data) return;
    const next = {};
    for (const response of responsesQuery.data.responses) {
      if (response.questionType === "subjective") next[response.id] = response.awardedMarks ?? "";
    }
    setAwards(next);
  }, [responsesQuery.data]);

  if (examQuery.isPending) return <DashboardSkeleton cards={2} panels={2} />;
  if (examQuery.isError) return <ErrorState error={examQuery.error} onRetry={examQuery.refetch} />;

  const { exam, questions, attempts, results } = examQuery.data;
  const mutationError = addMutation.error || updateMutation.error || deleteMutation.error;

  function openAdd() {
    addMutation.reset();
    updateMutation.reset();
    setEditingQuestion(null);
    setQuestionForm({ ...blankQuestion, sortOrder: questions.length });
    setQuestionModal(true);
  }

  function openEdit(question) {
    addMutation.reset();
    updateMutation.reset();
    setEditingQuestion(question);
    setQuestionForm({
      questionType: question.questionType,
      questionText: question.questionText,
      marks: question.marks,
      negativeMarks: question.negativeMarks,
      options: question.options.length
        ? [...question.options.map((option) => option.text), "", "", "", ""].slice(0, 4)
        : ["", "", "", ""],
      correctIndex: Math.max(0, question.options.findIndex((option) => option.id === question.correctOptionId)),
      modelAnswer: question.modelAnswer ?? "",
      sortOrder: question.sortOrder
    });
    setQuestionModal(true);
  }

  function submitQuestion(event) {
    event.preventDefault();
    const payload = {
      questionType: questionForm.questionType,
      questionText: questionForm.questionText,
      marks: Number(questionForm.marks),
      sortOrder: Number(questionForm.sortOrder) || 0
    };
    if (questionForm.questionType === "mcq") {
      const options = questionForm.options
        .map((text, index) => ({ text: text.trim(), isCorrect: index === Number(questionForm.correctIndex) }))
        .filter((option) => option.text);
      payload.options = options;
      payload.negativeMarks = Number(questionForm.negativeMarks) || 0;
    } else {
      payload.modelAnswer = questionForm.modelAnswer;
    }
    if (editingQuestion) updateMutation.mutate(payload);
    else addMutation.mutate(payload);
  }

  return (
    <div className="page-section">
      <Link className="back-link" to={`${basePath}/exams`}>
        <ArrowLeft size={14} /> Examinations
      </Link>

      <section className="detail-hero">
        <div>
          <h1>{exam.title}</h1>
          <p>
            {exam.batchName}
            {exam.subjectName ? ` · ${exam.subjectName}` : ""} · {exam.durationMinutes} min
          </p>
          <div className="row row--wrap" style={{ marginTop: 8, gap: 6 }}>
            <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
            <Badge tone="brand">
              {exam.totalMarks} marks · pass {exam.passMarks}
            </Badge>
            <Badge tone="neutral">
              {formatDateTime(exam.startsAt)} → {formatDateTime(exam.endsAt)}
            </Badge>
            {exam.resultsPublished ? <Badge tone="success">Results published</Badge> : null}
          </div>
        </div>
      </section>

      <div className="row row--wrap" style={{ gap: 8 }}>
        {exam.status !== "published" ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={questions.length === 0 || statusMutation.isPending}
            onClick={() => statusMutation.mutate("published")}
          >
            <CheckCircle2 size={15} /> Publish exam
          </button>
        ) : null}
        {exam.status === "published" ? (
          <button type="button" className="btn btn--ghost btn--sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate("closed")}>
            Close exam
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={publishMutation.isPending || questions.length === 0}
          onClick={() => publishMutation.mutate()}
        >
          {publishMutation.isPending ? "Publishing…" : "Publish results"}
        </button>
      </div>

      {statusMutation.isError ? (
        <div className="alert alert--error" role="alert">
          {statusMutation.error.message}
        </div>
      ) : null}
      {publishMutation.isError ? (
        <div className="alert alert--error" role="alert">
          {publishMutation.error.message}
        </div>
      ) : null}
      {publishMutation.isSuccess ? (
        <div className="alert alert--success" role="status">
          Results are now visible to students.
        </div>
      ) : null}

      <SectionCard
        title="Question bank"
        subtitle={`${questions.length} question(s) · answer keys are never sent to students`}
        action={
          <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
            <Plus size={15} /> Add question
          </button>
        }
      >
        {questions.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No questions yet" description="Add questions before publishing the exam." />
        ) : (
          <ol className="stack" style={{ gap: 12, listStyle: "none", padding: 0 }}>
            {questions.map((question, index) => (
              <li className="card" key={question.id} style={{ boxShadow: "none", border: "1px solid var(--border)" }}>
                <div className="card__body stack" style={{ gap: 8 }}>
                  <div className="row row--between">
                    <span className="small muted">
                      Q{index + 1} · {question.questionType === "mcq" ? "MCQ" : "Subjective"} · {question.marks} marks
                      {question.negativeMarks ? ` · −${question.negativeMarks}` : ""}
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(question)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Delete question"
                        onClick={() => {
                          deleteMutation.reset();
                          setDeletingQuestion(question);
                        }}
                        style={{ width: 30, height: 30 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <p>{question.questionText}</p>
                  {question.questionType === "mcq" ? (
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {question.options.map((option) => (
                        <li key={option.id} style={{ fontWeight: option.id === question.correctOptionId ? 600 : 400 }}>
                          {option.text}
                          {option.id === question.correctOptionId ? " ✓" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="small muted">Model answer: {question.modelAnswer || "—"}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard title="Attempts" subtitle="Review subjective answers before publishing results">
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => (
                <div>
                  <p className="cell-primary">{row.fullName}</p>
                  <p className="cell-sub">{row.enrollmentNo}</p>
                </div>
              )
            },
            { key: "attemptNo", header: "Attempt", render: (row) => row.attemptNo },
            { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "evaluated" ? "success" : "warning"}>{row.status}</Badge> },
            { key: "score", header: "Score", render: (row) => (row.score === null ? "—" : row.score) },
            { key: "submittedAt", header: "Submitted", render: (row) => (row.submittedAt ? formatDateTime(row.submittedAt) : "—") },
            {
              key: "actions",
              header: "",
              render: (row) => (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReviewAttempt(row.id)}>
                  Review
                </button>
              )
            }
          ]}
          rows={attempts}
          loading={false}
          rowKey="id"
          empty={<EmptyState icon={ClipboardList} title="No attempts yet" description="Attempts appear once students start the exam." />}
        />
      </SectionCard>

      <SectionCard title="Results" subtitle={`${results.length} result(s)`}>
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => (
                <div>
                  <p className="cell-primary">{row.fullName}</p>
                  <p className="cell-sub">{row.enrollmentNo}</p>
                </div>
              )
            },
            { key: "marks", header: "Marks", render: (row) => `${row.obtainedMarks} / ${row.totalMarks}` },
            { key: "percentage", header: "Percent", render: (row) => `${row.percentage}%` },
            { key: "status", header: "Result", render: (row) => <Badge tone={row.status === "pass" ? "success" : row.status === "fail" ? "danger" : "neutral"}>{row.status}</Badge> },
            { key: "published", header: "Published", render: (row) => (row.publishedAt ? formatDateTime(row.publishedAt) : "Not yet") }
          ]}
          rows={results}
          loading={false}
          rowKey="id"
          empty={<EmptyState icon={ClipboardList} title="No results" description="Results are calculated when attempts are submitted." />}
        />
      </SectionCard>

      <Modal
        open={questionModal}
        title={editingQuestion ? "Edit question" : "Add question"}
        onClose={() => setQuestionModal(false)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setQuestionModal(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="question-form"
              className="btn btn--primary"
              disabled={addMutation.isPending || updateMutation.isPending}
            >
              {addMutation.isPending || updateMutation.isPending ? "Saving…" : editingQuestion ? "Save question" : "Add question"}
            </button>
          </>
        }
      >
        <form id="question-form" className="form-grid" onSubmit={submitQuestion}>
          {mutationError ? (
            <div className="alert alert--error field--full" role="alert">
              {mutationError.message}
            </div>
          ) : null}
          <FormField label="Type" htmlFor="q-type">
            <select
              id="q-type"
              className="input"
              value={questionForm.questionType}
              onChange={(event) => setQuestionForm((current) => ({ ...current, questionType: event.target.value }))}
            >
              <option value="mcq">MCQ</option>
              <option value="subjective">Subjective</option>
            </select>
          </FormField>
          <FormField label="Marks" htmlFor="q-marks">
            <input
              id="q-marks"
              className="input"
              type="number"
              min="0.5"
              step="0.5"
              value={questionForm.marks}
              onChange={(event) => setQuestionForm((current) => ({ ...current, marks: event.target.value }))}
            />
          </FormField>
          <FormField label="Question" htmlFor="q-text" full>
            <textarea
              id="q-text"
              className="input"
              rows={3}
              value={questionForm.questionText}
              onChange={(event) => setQuestionForm((current) => ({ ...current, questionText: event.target.value }))}
            />
          </FormField>

          {questionForm.questionType === "mcq" ? (
            <>
              <FormField label="Negative marks" htmlFor="q-negative" hint="Applied when the answer is wrong">
                <input
                  id="q-negative"
                  className="input"
                  type="number"
                  min="0"
                  step="0.25"
                  value={questionForm.negativeMarks}
                  onChange={(event) => setQuestionForm((current) => ({ ...current, negativeMarks: event.target.value }))}
                />
              </FormField>
              <div className="field--full stack" style={{ gap: 8 }}>
                <p className="label">Options (select the correct one)</p>
                {questionForm.options.map((option, index) => (
                  <label className="row" key={`option-${index}`} style={{ gap: 8 }}>
                    <input
                      type="radio"
                      name="correct-option"
                      checked={Number(questionForm.correctIndex) === index}
                      onChange={() => setQuestionForm((current) => ({ ...current, correctIndex: index }))}
                      aria-label={`Mark option ${index + 1} correct`}
                    />
                    <input
                      className="input"
                      placeholder={`Option ${index + 1}`}
                      value={option}
                      onChange={(event) =>
                        setQuestionForm((current) => ({
                          ...current,
                          options: current.options.map((text, position) => (position === index ? event.target.value : text))
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          ) : (
            <FormField label="Model answer" htmlFor="q-model" full hint="Only staff can see this.">
              <textarea
                id="q-model"
                className="input"
                rows={3}
                value={questionForm.modelAnswer}
                onChange={(event) => setQuestionForm((current) => ({ ...current, modelAnswer: event.target.value }))}
              />
            </FormField>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(reviewAttempt)}
        title="Attempt review"
        description={responsesQuery.data ? `${responsesQuery.data.attempt.fullName} · ${responsesQuery.data.attempt.status}` : "Loading…"}
        onClose={() => setReviewAttempt(null)}
        size="lg"
      >
        {responsesQuery.isError ? <ErrorState error={responsesQuery.error} onRetry={responsesQuery.refetch} /> : null}
        {responsesQuery.data ? (
          <div className="stack" style={{ gap: 12 }}>
            {responsesQuery.data.responses.map((response, index) => (
              <div key={response.id} className="card" style={{ boxShadow: "none", border: "1px solid var(--border)" }}>
                <div className="card__body stack" style={{ gap: 6 }}>
                  <p className="small muted">
                    Q{index + 1} · {response.questionType} · {response.marks} marks
                  </p>
                  <p>{response.questionText}</p>
                  {response.questionType === "mcq" ? (
                    <p className="small">
                      Selected: {response.selectedOptionText ?? "—"} · Awarded {response.awardedMarks ?? 0}
                    </p>
                  ) : (
                    <>
                      <p className="small">{response.answerText || "No answer"}</p>
                      <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                        <FormField label="Award marks" htmlFor={`award-${response.id}`}>
                          <input
                            id={`award-${response.id}`}
                            className="input"
                            type="number"
                            min="0"
                            max={response.marks}
                            step="0.5"
                            value={awards[response.id] ?? ""}
                            onChange={(event) =>
                              setAwards((current) => ({ ...current, [response.id]: event.target.value }))
                            }
                          />
                        </FormField>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={evaluateMutation.isPending || awards[response.id] === ""}
                          onClick={() =>
                            evaluateMutation.mutate({ responseId: response.id, marks: Number(awards[response.id]) })
                          }
                        >
                          Save
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
            {evaluateMutation.isError ? (
              <div className="alert alert--error" role="alert">
                {evaluateMutation.error.message}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingQuestion)}
        title="Delete question"
        description="This removes the question and any answers students saved for it."
        confirmLabel="Delete question"
        busy={deleteMutation.isPending}
        error={deleteMutation.error?.message}
        onConfirm={() => deleteMutation.mutate()}
        onClose={() => setDeletingQuestion(null)}
      />
    </div>
  );
}
