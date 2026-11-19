import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  Megaphone,
  PlayCircle,
  Receipt,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet
} from "lucide-react";
import { dashboardService } from "../../services/dashboard.service.js";
import { useAuth } from "../../hooks/useAuth.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { Badge } from "../../components/Badge.jsx";
import { formatCurrency, formatDate, formatDateTime, formatTimeRange, greeting, relativeDay } from "../../utils/format.js";

function ScoreRow({ result }) {
  const percentage = Math.max(0, Math.min(100, Number(result.percentage ?? 0)));
  const tone = result.status === "pass" ? "success" : result.status === "fail" ? "danger" : "neutral";
  return (
    <li className="list__item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div className="row row--between">
        <p className="list__title">{result.exam_title}</p>
        <Badge tone={tone}>{result.status === "pass" ? "Passed" : result.status === "fail" ? "Needs work" : "Pending"}</Badge>
      </div>
      <div className="row row--between small muted">
        <span>
          {Number(result.obtained_marks)} / {Number(result.total_marks)} marks
        </span>
        <span>{percentage}%</span>
      </div>
      <div className="progress" aria-hidden="true">
        <div className={`progress__bar${result.status === "pass" ? " progress__bar--success" : ""}`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="small muted">{formatDate(result.published_at)}</span>
    </li>
  );
}

export function StudentDashboard() {
  useDocumentTitle("Home");
  const { user } = useAuth();

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", "student"],
    queryFn: dashboardService.student
  });

  if (isPending) {
    return (
      <div className="stack" style={{ gap: 14 }}>
        <DashboardSkeleton cards={3} panels={2} />
      </div>
    );
  }

  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const {
    student,
    enrollment,
    announcements,
    upcomingExams,
    recentResults,
    attendance,
    fees,
    unreadNotifications,
    resumeLesson,
    nextClass,
    pendingAssignments,
    pendingAssignmentsTotal
  } = data;
  const firstName = (student.fullName ?? user?.fullName ?? "Student").split(" ")[0];
  const feePaidPercent = fees.total > 0 ? Math.round((fees.paid / fees.total) * 100) : 0;
  const attendancePercent = attendance.percentage;
  const resumeMinutes = resumeLesson ? Math.floor(resumeLesson.lastPositionSeconds / 60) : 0;
  const nextRoom = nextClass?.room
    ? /^room\b/i.test(nextClass.room)
      ? nextClass.room
      : `Room ${nextClass.room}`
    : "Room to be announced";

  return (
    <>
      <section className="hero-card">
        <p className="hero-card__eyebrow">{greeting()}</p>
        <h1>{firstName}</h1>
        <div className="hero-card__chips">
          {enrollment ? (
            <>
              <span className="hero-chip">{enrollment.course_name}</span>
              <span className="hero-chip">{enrollment.batch_name}</span>
            </>
          ) : (
            <span className="hero-chip">No active batch</span>
          )}
          {student.enrollmentNo ? <span className="hero-chip">{student.enrollmentNo}</span> : null}
        </div>
        <div className="hero-metrics">
          <div className="hero-metric">
            <strong>{attendancePercent === null ? "—" : `${attendancePercent}%`}</strong>
            <span>Attendance</span>
          </div>
          <div className="hero-metric">
            <strong>{fees.pending > 0 ? formatCurrency(fees.pending) : "Paid"}</strong>
            <span>Fees due</span>
          </div>
          <div className="hero-metric">
            <strong>{unreadNotifications}</strong>
            <span>New notices</span>
          </div>
        </div>
      </section>

      {!enrollment ? (
        <div className="alert alert--info" role="status">
          <BookOpen size={16} aria-hidden="true" />
          <span>You are not enrolled in a batch yet. Please contact the institute office.</span>
        </div>
      ) : null}

      <div className="grid-2">
        <SectionCard
          title="Resume learning"
          subtitle="Your next published lesson"
          action={
            <Link className="btn btn--ghost btn--sm" to="/student/courses">
              Learn
            </Link>
          }
        >
          {resumeLesson ? (
            <Link className="resume-card" to={`/student/lectures/${resumeLesson.id}`}>
              <span className="list__icon" aria-hidden="true">
                <PlayCircle size={17} />
              </span>
              <span className="resume-card__main">
                <span className="resume-card__subject">{resumeLesson.subjectName}</span>
                <strong>{resumeLesson.title}</strong>
                <span className="small muted">
                  {resumeLesson.progressPercent > 0
                    ? `${resumeLesson.progressPercent}% watched${resumeMinutes > 0 ? ` · resume at ${resumeMinutes} min` : ""}`
                    : resumeLesson.durationMinutes
                      ? `${resumeLesson.durationMinutes} min ${resumeLesson.hasVideo ? "video" : "lesson · PDF notes"}`
                      : resumeLesson.hasVideo
                        ? "Video lesson"
                        : "PDF notes"}
                </span>
              </span>
              <span className="resume-card__action">
                {resumeLesson.progressPercent > 0 ? "Resume" : "Start"} <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No lesson waiting"
              description="Published lessons for your batch will appear here."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Next class"
          subtitle={nextClass ? nextClass.batchName : "Your batch timetable"}
          action={
            <button
              type="button"
              className="icon-btn"
              onClick={() => refetch()}
              aria-label="Refresh dashboard"
              disabled={isFetching}
              style={{ width: 34, height: 34 }}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          }
        >
          {nextClass ? (
            <div className="next-class">
              <span className="next-class__day">
                <span className="eyebrow">{relativeDay(nextClass.nextDate)}</span>
                <strong>{formatDate(nextClass.nextDate, { weekday: "long", day: "numeric", month: "short" })}</strong>
              </span>
              <div className="next-class__details">
                <p className="list__title">{nextClass.subjectName ?? "Class"}</p>
                <p className="list__meta">{nextRoom}</p>
                <p className="small muted">
                  <Clock size={13} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
                  {formatTimeRange(nextClass.startTime, nextClass.endTime)}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming class"
              description="The batch timetable will appear here once it is scheduled."
            />
          )}
        </SectionCard>
      </div>

      <div className="grid-2">
        <SectionCard
          title="Pending assignments"
          subtitle={pendingAssignmentsTotal > 0 ? `${pendingAssignmentsTotal} to complete` : "Nothing due right now"}
          action={
            <Link className="btn btn--ghost btn--sm" to="/student/assignments">
              All assignments
            </Link>
          }
        >
          {pendingAssignments.length === 0 ? (
            <EmptyState icon={ClipboardList} title="All caught up" description="New work from your teachers will appear here." />
          ) : (
            <ul className="list">
              {pendingAssignments.map((assignment) => (
                <li className="list__item" key={assignment.id}>
                  <span className="list__icon" aria-hidden="true">
                    <FileText size={16} />
                  </span>
                  <div className="list__main">
                    <p className="list__title">{assignment.title}</p>
                    <p className="list__meta">
                      {assignment.subjectName} · {assignment.maxMarks} marks
                    </p>
                  </div>
                  <span className="list__side">{assignment.dueAt ? formatDateTime(assignment.dueAt) : "No due date"}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Fees"
          subtitle={`${fees.openInvoices} open invoice(s)`}
          action={
            <Link className="btn btn--ghost btn--sm" to="/student/fees">
              Details
            </Link>
          }
        >
          <div className="metric-block">
            <div className="stat-line">
              <span className="muted small">Paid</span>
              <strong>{formatCurrency(fees.paid)}</strong>
            </div>
            <div className="progress" aria-hidden="true">
              <div className="progress__bar progress__bar--accent" style={{ width: `${feePaidPercent}%` }} />
            </div>
            <div className="metric-block__row">
              <span>Total fees</span>
              <strong>{formatCurrency(fees.total)}</strong>
            </div>
            <div className="metric-block__row">
              <span>Pending</span>
              <strong>{formatCurrency(fees.pending)}</strong>
            </div>
            <div className="row" style={{ marginTop: 4 }}>
              <Badge tone={fees.status === "paid" ? "success" : fees.status === "partial" ? "warning" : "danger"}>
                <Receipt size={12} aria-hidden="true" />
                {fees.status === "paid" ? "Fully paid" : fees.status === "partial" ? "Partially paid" : "Payment pending"}
              </Badge>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid-2">
        <SectionCard
          title="Upcoming tests"
          subtitle="Scheduled for your batch"
          action={
            <Link className="btn btn--ghost btn--sm" to="/student/exams">
              All tests
            </Link>
          }
        >
          {upcomingExams.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No tests scheduled" description="New tests appear here with their timing." />
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
                      {exam.subject_name ? `${exam.subject_name} · ` : ""}
                      {exam.duration_minutes} min
                    </p>
                    <p className="list__meta">{formatDateTime(exam.starts_at)}</p>
                  </div>
                  {exam.attempts > 0 ? (
                    <span className="list__side">
                      <Badge tone="success">Attempted</Badge>
                    </span>
                  ) : (
                    <span className="list__side">
                      <Badge tone="brand">Upcoming</Badge>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Recent results" subtitle="Published by your teachers">
          {recentResults.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No results yet" description="Results appear after your teacher publishes them." />
          ) : (
            <ul className="list">
              {recentResults.map((result) => (
                <ScoreRow key={result.id} result={result} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Notice board"
        subtitle="Announcements for you and your batch"
        action={
          <Link className="btn btn--ghost btn--sm" to="/student/announcements">
            All notices
          </Link>
        }
      >
        {announcements.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements" description="Notices from the institute will show up here." />
        ) : (
          <ul className="list">
            {announcements.map((announcement) => (
              <li className="notice-item" key={announcement.id}>
                <span className="notice-item__dot" aria-hidden="true" />
                <div className="list__main">
                  <p className="notice-item__title">
                    {announcement.title} {announcement.is_pinned ? <Badge tone="accent">Pinned</Badge> : null}
                  </p>
                  <p className="notice-item__body">{announcement.body}</p>
                  <p className="notice-item__meta">{formatDate(announcement.published_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid-2">
        <SectionCard title="Attendance" subtitle="All recorded sessions">
          <div className="metric-block">
            <div className="stat-line">
              <span className="muted small">Overall</span>
              <strong>{attendancePercent === null ? "—" : `${attendancePercent}%`}</strong>
            </div>
            <div className="progress" aria-hidden="true">
              <div
                className={`progress__bar${attendancePercent !== null && attendancePercent >= 75 ? " progress__bar--success" : ""}`}
                style={{ width: `${attendancePercent ?? 0}%` }}
              />
            </div>
            <div className="metric-block__row">
              <span>Present</span>
              <strong>{attendance.present} days</strong>
            </div>
            <div className="metric-block__row">
              <span>Absent</span>
              <strong>{attendance.absent} days</strong>
            </div>
            <hr className="divider" />
            <div className="metric-block__row">
              <span>This month</span>
              <strong>
                {attendance.thisMonth.percentage === null ? "—" : `${attendance.thisMonth.percentage}%`} (
                {attendance.thisMonth.present}/{attendance.thisMonth.total})
              </strong>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="My course" subtitle="Enrolment details">
          {enrollment ? (
            <div className="detail-list">
              <div className="detail-row">
                <dt>Course</dt>
                <dd>
                  {enrollment.course_name} ({enrollment.course_code})
                </dd>
              </div>
              <div className="detail-row">
                <dt>Batch</dt>
                <dd>
                  {enrollment.batch_name} ({enrollment.batch_code})
                </dd>
              </div>
              <div className="detail-row">
                <dt>Batch duration</dt>
                <dd>
                  {formatDate(enrollment.start_date)} – {formatDate(enrollment.end_date)}
                </dd>
              </div>
              <div className="detail-row">
                <dt>Enrolled on</dt>
                <dd>{formatDate(enrollment.enrolled_at)}</dd>
              </div>
            </div>
          ) : (
            <EmptyState icon={Target} title="No course assigned" description="The office will enrol you in a batch shortly." />
          )}
        </SectionCard>
      </div>

      <p className="small muted" style={{ textAlign: "center", paddingBottom: 6 }}>
        <Wallet size={12} aria-hidden="true" style={{ display: "inline", verticalAlign: "-1px" }} /> Fee receipts are issued
        by the office for offline payments.
      </p>
    </>
  );
}
