import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, PlayCircle, Search, Video } from "lucide-react";
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
  useDocumentTitle("Lectures");
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());

  const subjectId = params.get("subject") ?? "";

  const coursesQuery = useQuery({ queryKey: ["student", "courses"], queryFn: studentService.courses });
  const lessonsQuery = useQuery({
    queryKey: ["student", "lessons", subjectId, deferredSearch, page],
    queryFn: () => studentService.lessons({ subjectId, search: deferredSearch, page, pageSize: 20 })
  });

  const subjects = [];
  const seen = new Set();
  for (const course of coursesQuery.data?.items ?? []) {
    for (const subject of course.subjects) {
      if (seen.has(subject.id)) continue;
      seen.add(subject.id);
      subjects.push(subject);
    }
  }

  return (
    <>
      <PageHeader title="Lectures" description="Recorded classes for your batch, in teaching order." />

      <SectionCard>
        <div className="stack" style={{ gap: 10 }}>
          <label className="label" htmlFor="lecture-search">
            Search lectures
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
              onClick={() => {
                setPage(1);
                setParams({});
              }}
            >
              All subjects
            </button>
            {subjects.map((subject) => (
              <button
                key={subject.id}
                type="button"
                className={subject.id === subjectId ? "btn btn--primary btn--sm" : "btn btn--ghost btn--sm"}
                onClick={() => {
                  setPage(1);
                  setParams({ subject: subject.id });
                }}
              >
                {subject.name}
              </button>
            ))}
          </div>
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
            title="No lectures yet"
            description="Your teachers have not published a lecture for this filter."
          />
        </SectionCard>
      ) : null}

      {lessonsQuery.data?.items.map((lesson) => (
        <Link key={lesson.id} className="card lesson-card" to={`/student/lectures/${lesson.id}`}>
          <div className="card__body stack" style={{ gap: 8 }}>
            <div className="row row--between">
              <Badge tone="brand">{lesson.subjectName}</Badge>
              {lesson.completed ? (
                <span className="row small" style={{ gap: 4, color: "var(--success-700, #046c4e)" }}>
                  <CheckCircle2 size={14} aria-hidden="true" /> Completed
                </span>
              ) : lesson.progressPercent > 0 ? (
                <span className="small muted">{lesson.progressPercent}% watched</span>
              ) : null}
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
              <span className="row" style={{ gap: 4 }}>
                <PlayCircle size={14} aria-hidden="true" /> Watch
              </span>
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
