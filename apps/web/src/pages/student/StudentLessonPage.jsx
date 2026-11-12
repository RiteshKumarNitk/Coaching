import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { formatDate } from "../../utils/format.js";

export function StudentLessonPage() {
  const { id } = useParams();
  useDocumentTitle("Lecture");
  const queryClient = useQueryClient();

  const lessonQuery = useQuery({ queryKey: ["student", "lesson", id], queryFn: () => studentService.lesson(id) });

  const progressMutation = useMutation({
    mutationFn: (payload) => studentService.saveProgress(id, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(["student", "lesson", id], (current) =>
        current ? { ...current, progress: { ...current.progress, ...data } } : current
      );
      queryClient.invalidateQueries({ queryKey: ["student", "lessons"] });
      queryClient.invalidateQueries({ queryKey: ["student", "courses"] });
    }
  });

  if (lessonQuery.isPending) return <DashboardSkeleton cards={1} panels={2} />;
  if (lessonQuery.isError) return <ErrorState error={lessonQuery.error} onRetry={lessonQuery.refetch} />;

  const { lesson, progress, materials, previousLessonId, nextLessonId } = lessonQuery.data;

  return (
    <>
      <Link className="back-link" to="/student/lectures">
        <ArrowLeft size={14} /> All lectures
      </Link>

      {lesson.youtubeVideoId ? (
        <div className="video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${lesson.youtubeVideoId}`}
            title={lesson.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        <SectionCard>
          <EmptyState icon={FileText} title="Video not attached" description="Your teacher has not linked a video for this lecture yet." />
        </SectionCard>
      )}

      <SectionCard
        title={lesson.title}
        subtitle={`${lesson.subjectName}${lesson.chapter ? ` · ${lesson.chapter}` : ""}`}
        action={
          progress.completed ? (
            <Badge tone="success">
              <CheckCircle2 size={12} aria-hidden="true" /> Completed
            </Badge>
          ) : (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={progressMutation.isPending}
              onClick={() =>
                progressMutation.mutate({
                  positionSeconds: Math.max(progress.lastPositionSeconds, (lesson.durationMinutes ?? 0) * 60),
                  completed: true
                })
              }
            >
              <CheckCircle2 size={14} /> {progressMutation.isPending ? "Saving…" : "Mark watched"}
            </button>
          )
        }
      >
        <div className="stack" style={{ gap: 10 }}>
          {lesson.description ? <p className="small">{lesson.description}</p> : null}
          <div className="row row--wrap small muted" style={{ gap: 10 }}>
            {lesson.durationMinutes ? <span>{lesson.durationMinutes} min</span> : null}
            {lesson.publishedAt ? <span>Published {formatDate(lesson.publishedAt)}</span> : null}
            {progress.completedAt ? <span>Completed {formatDate(progress.completedAt)}</span> : null}
          </div>
          {progressMutation.isError ? (
            <div className="alert alert--error" role="alert">
              {progressMutation.error.message}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Notes for this subject" subtitle="Shared by your teacher">
        {materials.length === 0 ? (
          <EmptyState icon={FileText} title="No notes yet" description="Study material for this subject appears here." />
        ) : (
          <ul className="list">
            {materials.map((material) => (
              <li className="list__item" key={material.id}>
                <span className="list__icon" aria-hidden="true">
                  <FileText size={16} />
                </span>
                <div className="list__main">
                  <p className="list__title">{material.title}</p>
                  <p className="list__meta">
                    {material.kind}
                    {material.chapter ? ` · ${material.chapter}` : ""}
                  </p>
                </div>
                <a className="btn btn--ghost btn--sm" href={material.driveUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink size={13} /> Open
                </a>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="row row--between" style={{ gap: 8 }}>
        {previousLessonId ? (
          <Link className="btn btn--ghost btn--sm" to={`/student/lectures/${previousLessonId}`}>
            <ChevronLeft size={14} /> Previous
          </Link>
        ) : (
          <span />
        )}
        {nextLessonId ? (
          <Link className="btn btn--primary btn--sm" to={`/student/lectures/${nextLessonId}`}>
            Next lecture <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
    </>
  );
}
