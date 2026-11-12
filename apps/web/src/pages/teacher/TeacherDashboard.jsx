import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileCheck2,
  GraduationCap,
  RefreshCw,
  Users
} from "lucide-react";
import { dashboardService } from "../../services/dashboard.service.js";
import { useAuth } from "../../hooks/useAuth.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { StatCard } from "../../components/StatCard.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { Badge } from "../../components/Badge.jsx";
import { formatDate, formatDateTime, formatTimeRange, greeting } from "../../utils/format.js";

export function TeacherDashboard() {
  useDocumentTitle("Teaching desk");
  const { user } = useAuth();

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "teacher"],
    queryFn: dashboardService.teacher
  });

  if (isPending) {
    return (
      <div className="page-section">
        <PageHeader title="Teaching desk" description="Your batches and classes." />
        <DashboardSkeleton cards={4} panels={2} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-section">
        <PageHeader title="Teaching desk" />
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  const { metrics, batches, todaySchedule, upcomingExams, recentSubmissions } = data;

  return (
    <div className="page-section">
      <PageHeader
        title={`${greeting()}, ${user?.fullName?.split(" ")[0] ?? "teacher"}`}
        description="Your assigned batches, today's timetable and pending evaluations."
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard icon={BookOpen} label="My batches" value={metrics.batches} hint="assigned to you" />
        <StatCard icon={Users} label="My students" value={metrics.students} hint="active enrolments" tone="success" />
        <StatCard icon={Clock} label="Classes today" value={metrics.todayClasses} hint="on your timetable" />
        <StatCard icon={ClipboardList} label="Upcoming tests" value={metrics.upcomingExams} hint="in your batches" tone="accent" />
      </div>

      <div className="grid-2">
        <SectionCard title="Today's classes" subtitle={formatDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}>
          {todaySchedule.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No classes scheduled today"
              description="Your timetable for the selected day will appear here."
            />
          ) : (
            <ul className="list">
              {todaySchedule.map((slot) => (
                <li className="list__item" key={slot.id}>
                  <span className="list__icon" aria-hidden="true">
                    <Clock size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{slot.subject_name ?? "Class"}</p>
                    <p className="list__meta">
                      {slot.batch_name}
                      {slot.room ? ` · ${slot.room}` : ""}
                    </p>
                  </div>
                  <span className="list__side">{formatTimeRange(slot.start_time, slot.end_time)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="My batches" subtitle="Students enrolled per batch">
          {batches.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No batches assigned yet"
              description="Ask an administrator to assign you to a batch."
            />
          ) : (
            <ul className="list">
              {batches.map((batch) => (
                <li className="list__item" key={batch.id}>
                  <span className="list__icon" aria-hidden="true">
                    <GraduationCap size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{batch.name}</p>
                    <p className="list__meta">
                      {batch.code} · {batch.course_name}
                    </p>
                  </div>
                  <span className="list__side">
                    <Badge tone="brand">{batch.student_count} students</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid-2">
        <SectionCard title="Upcoming tests" subtitle="Scheduled in your batches">
          {upcomingExams.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No tests scheduled" description="Create a test when your batch is ready." />
          ) : (
            <ul className="list">
              {upcomingExams.map((exam) => (
                <li className="list__item" key={exam.id}>
                  <span className="list__icon" aria-hidden="true">
                    <ClipboardList size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{exam.title}</p>
                    <p className="list__meta">
                      {exam.batch_name} · {exam.duration_minutes} min
                    </p>
                  </div>
                  <span className="list__side">{formatDateTime(exam.starts_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent submissions" subtitle="Assignments submitted by your students">
          {recentSubmissions.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title="No submissions yet"
              description="Submissions appear here once students upload their work."
            />
          ) : (
            <ul className="list">
              {recentSubmissions.map((submission) => (
                <li className="list__item" key={submission.id}>
                  <span className="list__icon" aria-hidden="true">
                    <ClipboardCheck size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{submission.student_name}</p>
                    <p className="list__meta">{submission.assignment_title}</p>
                  </div>
                  <span className="list__side">
                    <Badge tone={submission.status === "evaluated" ? "success" : "warning"}>
                      {submission.status === "evaluated" ? "Evaluated" : "Pending"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
