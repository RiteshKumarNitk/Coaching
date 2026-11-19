import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Clock, FileText, PlayCircle, Search, Video } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Skeleton } from "../../components/Skeleton.jsx";

export function StudentLecturesPage() {
  useDocumentTitle("Lessons");
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const batchId = params.get("batch") ?? "";
  const subjectId = params.get("subject") ?? "";
  const coursesQuery = useQuery({ queryKey: ["student", "courses"], queryFn: studentService.courses });
  const selectedCourse = (coursesQuery.data?.items ?? []).find((course) => course.batchId === batchId);
  const lessonsQuery = useQuery({
    queryKey: ["student", "lessons", batchId, subjectId, deferredSearch, page],
    queryFn: () => studentService.lessons({ batchId, subjectId, search: deferredSearch, page, pageSize: 20 })
  });

  const subjects = [];
  const seen = new Set();
  for (const course of coursesQuery.data?.items ?? []) {
    if (batchId && course.batchId !== batchId) continue;
    for (const subject of course.subjects) {
      if (seen.has(subject.id)) continue;
      seen.add(subject.id);
      subjects.push(subject);
    }
  }

  const selectSubject = (nextSubjectId) => {
    const next = {};
    if (batchId) next.batch = batchId;
    if (nextSubjectId) next.subject = nextSubjectId;
    setPage(1);
    setParams(next);
  };

  const selectedSubject = subjects.find((subject) => subject.id === subjectId);

  return (
    <>
      <Link className="back-link" to="/student/courses">
        <ArrowLeft size={14} /> All courses
      </Link>

      <PageHeader
        title={selectedCourse?.courseName ?? "Lessons"}
        description={
          selectedCourse
            ? `${selectedCourse.batchName} · Choose a subject, then open a lesson.`
            : "Your published lessons, grouped by subject."
        }
      />

      <SectionCard>
        <div className="stack" style={{ gap: 10 }}>
          <label className="label" htmlFor="lecture-search">
            Search lessons
          </label>
          <div className="row" style={{ gap: 8 }}>
            <Search size={16} aria-hidden="true" className="muted" />
            <input
              id="lecture-search"
              className="input"
              placeholder="Title or chapter"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className={subjectId ? "btn btn--ghost btn--sm" : "btn btn--primary btn--sm"}
              onClick={() => selectSubject("")}
            >
              All subjects
            </button>
            {subjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                className={subject.id === subjectId ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"}
                onClick={() => selectSubject(subject.id)}
              >
                {subject.name}
              </button>
            ))}
          </div>
          {selectedSubject ? (
            <p className="small muted">
              {selectedSubject.lessonCount} published {selectedSubject.lessonCount === 1 ? "lesson" : "lessons"} ·{" "}
              {selectedSubject.materialCount} attached PDF / note
              {selectedSubject.materialCount === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      </SectionCard>

      {lessonsQuery.isError ? <ErrorState error={lessonsQuery.error} onRetry={lessonsQuery.refetch} /> : null}

      {lessonsQuery.isPending ? (
        <div className="stack" style={{ gap: 10 }}>
          {[0, 1, 2].map((key) => (
            <div className="card" key={key}>
              <div className="card__body">
                <Skeleton height="1rem" width="65%" />
                <Skeleton height="0.8rem" width="40%" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {lessonsQuery.data && lessonsQuery.data.items.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Video}
            title="No lessons here yet"
            description={
              selectedSubject
                ? `${selectedSubject.name} has no published lessons yet. Try another subject or check back later.`
                : "Your teachers have not published a lesson for this course yet."
            }
          />
        </SectionCard>
      ) : null}

      {lessonsQuery.data?.items.map((lesson) => (
        <Link key={lesson.id} className="card lesson-card" to={`/student/lectures/${lesson.id}`}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between row--wrap">
              <Badge tone="brand">{lesson.subjectName}</Badge>
              <div className="row row--wrap" style={{ gap: 5 }}>
                {lesson.hasVideo ? (
                  <Badge tone="brand">
                    <Video size={11} aria-hidden="true" /> Video
                  </Badge>
                ) : (
                  <Badge tone="neutral">
                    <FileText size={11} aria-hidden="true" /> No video
                  </Badge>
                )}
                {lesson.materialCount > 0 ? (
                  <Badge tone="info">
                    <FileText size={11} aria-hidden="true" /> PDF ×{lesson.materialCount}
                  </Badge>
                ) : null}
              </div>
            </div>
            <p className="cell-primary">{lesson.title}</p>
            <p className="small muted">
              {lesson.chapter ? `${lesson.chapter} · ` : ""}
              {lesson.batchName}
            </p>
            <div className="row row--between small muted">
              <span className="row" style={{ gap: 5 }}>
                <Clock size={13} aria-hidden="true" />
                {lesson.durationMinutes ? `${lesson.durationMinutes} min` : "Duration not set"}
              </span>
              {lesson.completed ? (
                <span className="row" style={{ gap: 4, color: "var(--success-700, #046c4e)" }}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Completed
                </span>
              ) : lesson.progressPercent > 0 ? (
                <span>{lesson.progressPercent}% watched</span>
              ) : (
                <span className="row" style={{ gap: 4 }}>
                  <PlayCircle size={14} aria-hidden="true" /> Open lesson
                </span>
              )}
            </div>
            {lesson.progressPercent > 0 && !lesson.completed ? (
              <div className="progress" aria-hidden="true">
                <div className="progress__bar" style={{ width: `${lesson.progressPercent}%` }} />
              </div>
            ) : null}
          </div>
        </Link>
      ))}

      {lessonsQuery.data ? (
        <Pagination page={page} pageSize={20} total={lessonsQuery.data.total} onChange={setPage} />
      ) : null}

    </>
  );
}
