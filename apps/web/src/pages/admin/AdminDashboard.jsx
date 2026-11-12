import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Layers,
  Megaphone,
  RefreshCw,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import { dashboardService } from "../../services/dashboard.service.js";
import { useAuth } from "../../hooks/useAuth.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { StatCard } from "../../components/StatCard.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { BarChart } from "../../components/BarChart.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { formatCurrency, formatDate, formatDateTime, greeting } from "../../utils/format.js";

export function AdminDashboard() {
  useDocumentTitle("Admin dashboard");
  const { user } = useAuth();

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "admin"],
    queryFn: dashboardService.admin
  });

  if (isPending) {
    return (
      <div className="page-section">
        <PageHeader title="Institute overview" description="Live numbers from your database." />
        <DashboardSkeleton cards={6} panels={2} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="page-section">
        <PageHeader title="Institute overview" />
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  const { metrics, recentAdmissions, admissionsTrend, attendanceTrend, upcomingExams, announcements } = data;
  const attendanceLabel =
    metrics.attendanceToday.percentage === null ? "Not marked" : `${metrics.attendanceToday.percentage}%`;

  return (
    <div className="page-section">
      <PageHeader
        title={`${greeting()}, ${user?.fullName?.split(" ")[0] ?? "there"}`}
        description={`Here is how the institute is doing on ${formatDate(new Date())}.`}
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={15} className={isFetching ? "spin" : undefined} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <div className="stat-grid">
        <StatCard
          icon={Users}
          label="Students"
          value={metrics.totalStudents}
          hint={`${metrics.activeStudents} active`}
        />
        <StatCard
          icon={BookOpen}
          label="Teachers"
          value={metrics.totalTeachers}
          hint={`${metrics.activeTeachers} active`}
        />
        <StatCard icon={Layers} label="Courses" value={metrics.activeCourses} hint="active courses" tone="success" />
        <StatCard icon={CalendarDays} label="Batches" value={metrics.activeBatches} hint="currently running" />
        <StatCard
          icon={CalendarCheck}
          label="Attendance today"
          value={attendanceLabel}
          hint={`${metrics.attendanceToday.present} of ${metrics.attendanceToday.marked} marked present`}
          tone="success"
        />
        <StatCard
          icon={Wallet}
          label="Pending fees"
          value={formatCurrency(metrics.pendingFees.amount)}
          hint={`${metrics.pendingFees.students} student account(s) with dues`}
          tone="accent"
        />
      </div>

      <div className="grid-2">
        <SectionCard title="Attendance trend" subtitle="Recorded attendance, last 14 days">
          <BarChart
            data={attendanceTrend.map((row) => ({
              label: formatDate(row.date, { day: "numeric", month: "short" }),
              value: row.percentage ?? 0
            }))}
            valueKey="value"
            labelKey="label"
            formatValue={(value) => `${value}%`}
            emptyLabel="No attendance recorded yet"
          />
        </SectionCard>

        <SectionCard title="Admissions" subtitle="New students in the last 6 months">
          <BarChart data={admissionsTrend} valueKey="count" labelKey="label" emptyLabel="No admissions recorded yet" />
        </SectionCard>
      </div>

      <div className="grid-2">
        <SectionCard title="Upcoming examinations" subtitle={`${metrics.upcomingExams} scheduled`}>
          {upcomingExams.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No exams scheduled"
              description="Scheduled tests will appear here for every batch."
            />
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
                      {exam.batch_name}
                      {exam.subject_name ? ` · ${exam.subject_name}` : ""} · {exam.duration_minutes} min
                    </p>
                  </div>
                  <span className="list__side">{formatDateTime(exam.starts_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent admissions" subtitle="Latest students added to the institute">
          {recentAdmissions.length === 0 ? (
            <EmptyState
              icon={UserPlus}
              title="No students yet"
              description="Add your first student from Student Management in Phase 2."
            />
          ) : (
            <ul className="list">
              {recentAdmissions.map((student) => (
                <li className="list__item" key={student.id}>
                  <span className="list__icon" aria-hidden="true">
                    <UserPlus size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{student.full_name}</p>
                    <p className="list__meta">
                      {student.enrollment_no} · {student.course_name ?? "No course"}
                      {student.batch_name ? ` · ${student.batch_name}` : ""}
                    </p>
                  </div>
                  <span className="list__side">{formatDate(student.admission_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Announcements" subtitle="Published to students and staff">
        {announcements.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements published"
            description="Notices published by the office will be listed here."
          />
        ) : (
          <ul className="list">
            {announcements.map((announcement) => (
              <li className="list__item" key={announcement.id}>
                <span className="list__icon" aria-hidden="true">
                  <Megaphone size={16} />
                </span>
                <div className="list__main">
                  <p className="list__title">
                    {announcement.title} {announcement.is_pinned ? <span className="badge badge--accent">Pinned</span> : null}
                  </p>
                  <p className="list__meta">{announcement.body}</p>
                </div>
                <span className="list__side">{formatDate(announcement.published_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
