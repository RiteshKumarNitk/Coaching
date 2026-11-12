import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookOpen, ClipboardList, FileText, PlayCircle } from "lucide-react";
import { studentService } from "../../services/student.service.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { Badge } from "../../components/Badge.jsx";
import { formatDate } from "../../utils/format.js";

export function StudentCoursesPage() {
  useDocumentTitle("My learning");
  const coursesQuery = useQuery({ queryKey: ["student", "courses"], queryFn: studentService.courses });

  if (coursesQuery.isPending) return <DashboardSkeleton cards={2} panels={2} />;
  if (coursesQuery.isError) return <ErrorState error={coursesQuery.error} onRetry={coursesQuery.refetch} />;

  const courses = coursesQuery.data.items;

  return (
    <>
      <PageHeader title="My learning" description="Your course, lectures, notes and assignments in one place." />

      {courses.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={BookOpen}
            title="Not enrolled yet"
            description="The office will assign your batch shortly. Contact them if this looks wrong."
          />
        </SectionCard>
      ) : null}

      {courses.map((course) => {
        const percent =
          course.lessonCount > 0 ? Math.round((course.completedCount / course.lessonCount) * 100) : 0;
        return (
          <SectionCard key={course.enrollmentId} title={course.batchName} subtitle={`${course.courseName} (${course.courseCode})`}>
            <div className="stack" style={{ gap: 14 }}>
              <div className="row row--wrap" style={{ gap: 8 }}>
                <Badge tone="brand">{course.batchCode}</Badge>
                <Badge tone="neutral">
                  {formatDate(course.startDate)} → {formatDate(course.endDate)}
                </Badge>
              </div>

              <div>
                <div className="row row--between small muted">
                  <span>
                    {course.completedCount} of {course.lessonCount} lectures completed
                  </span>
                  <span>{percent}%</span>
                </div>
                <div className="progress" aria-hidden="true" style={{ marginTop: 6 }}>
                  <div className="progress__bar progress__bar--success" style={{ width: `${percent}%` }} />
                </div>
              </div>

              <div className="row row--wrap" style={{ gap: 8 }}>
                {course.subjects.map((subject) => (
                  <Link key={subject.id} className="btn btn--ghost btn--sm" to={`/student/lectures?subject=${subject.id}`}>
                    {subject.name}
                  </Link>
                ))}
              </div>

              <div className="row row--wrap" style={{ gap: 8 }}>
                <Link className="btn btn--primary btn--sm" to="/student/lectures">
                  <PlayCircle size={15} /> Lectures
                </Link>
                <Link className="btn btn--ghost btn--sm" to="/student/materials">
                  <FileText size={15} /> Notes ({course.materialCount})
                </Link>
                <Link className="btn btn--ghost btn--sm" to="/student/assignments">
                  <ClipboardList size={15} /> Assignments ({course.assignmentCount})
                </Link>
              </div>
            </div>
          </SectionCard>
        );
      })}
    </>
  );
}
