import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  PlayCircle,
  Video
} from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { formatDate } from "../../utils/format.js";

const kindLabel = {
  notes: "PDF notes",
  assignment: "Assignment PDF",
  reference: "Reference PDF",
  other: "File"
};

const isHttpLink = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

function formatPosition(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function StudentLessonPage() {
  const { id } = useParams();
  useDocumentTitle("Lesson");
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
      queryClient.invalidateQueries({ queryKey: ["dashboard", "student"] });
    }
  });

  if (lessonQuery.isPending) return <DashboardSkeleton cards={1} panels={2} />;
  if (lessonQuery.isError) return <ErrorState error={lessonQuery.error} onRetry={lessonQuery.refetch} />;

  const { lesson, progress, materials, previousLessonId, nextLessonId } = lessonQuery.data;
  const resumeSeconds = progress.completed ? 0 : progress.lastPositionSeconds;
  const resumeUrl = resumeSeconds > 0 ? `?start=${Math.floor(resumeSeconds)}` : "";

  return (
    <>
      <Link className="back-link" to={`/student/lectures?batch=${lesson.batchId}&subject=${lesson.subjectId}`}>
        <ArrowLeft size={14} /> Back to lessons
      </Link>

      <div className="row row--wrap" style={{ gap: 6 }}>
        <Badge tone="brand">
          <Video size={11} aria-hidden="true" /> YouTube lesson
        </Badge>
        <Badge tone={materials.length > 0 ? "info" : "neutral"}>
          <FileText size={11} aria-hidden="true" /> {materials.length} PDF / note{materials.length === 1 ? "" : "s"}
        </Badge>
        {progress.completed ? (
          <Badge tone="success">
            <CheckCircle2 size={11} aria-hidden="true" /> Completed
          </Badge>
        ) : null}
      </div>

      {resumeSeconds > 0 && !progress.completed ? (
        <div className="alert alert--info" role="status">
          <PlayCircle size={16} aria-hidden="true" />
          <span>
            Resume from {formatPosition(resumeSeconds)}. The player starts at your last saved position.
          </span>
        </div>
      ) : null}

      {lesson.youtubeVideoId ? (
        <div className="video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${lesson.youtubeVideoId}${resumeUrl}`}
            title={lesson.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        <SectionCard>
          <EmptyState
            icon={Video}
            title="Video unavailable"
            description="Your teacher has not attached a working YouTube video to this lesson. Use the PDF notes below or ask your teacher to add the link."
          />
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

      <SectionCard title="Attached PDFs and notes" subtitle={`Shared for ${lesson.subjectName}`}>
        {materials.length === 0 ? (
          <EmptyState icon={FileText} title="No PDFs yet" description="Notes for this subject will appear here." />
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
                    {kindLabel[material.kind] ?? "File"}
                    {material.chapter ? ` · ${material.chapter}` : ""}
                  </p>
                </div>
                {isHttpLink(material.driveUrl) ? (
                  <a className="btn btn--ghost btn--sm" href={material.driveUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink size={13} /> Open PDF
                  </a>
                ) : (
                  <span className="badge badge--danger">Link unavailable</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="row row--between" style={{ gap: 8 }}>
        {previousLessonId ? (
          <Link className="btn btn--ghost btn--sm" to={`/student/lectures/${previousLessonId}`}>
            <ChevronLeft size={14} /> Previous lesson
          </Link>
        ) : (
          <span />
        )}
        {nextLessonId ? (
          <Link className="btn btn--primary btn--sm" to={`/student/lectures/${nextLessonId}`}>
            Next lesson <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
    </>
  );
}
