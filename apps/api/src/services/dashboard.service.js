/**
 * Dashboard aggregates. Every number below comes from PostgreSQL for the
 * signed-in user's own scope — nothing is hardcoded or client-supplied.
 */
const num = (value) => Number(value ?? 0);

const learningEnrollment = (alias = "e") =>
  `${alias}.status = 'active'
   AND (${alias}.valid_from IS NULL OR ${alias}.valid_from <= institute_today())
   AND (${alias}.valid_until IS NULL OR ${alias}.valid_until >= institute_today())`;

export function createDashboardService(db) {
  return {
    async admin() {
      // One round trip: over a remote database the eight separate queries spent more
      // time on the wire than in Postgres, so they are assembled into a single JSON row.
      const { payload } = await db.one(`
        SELECT json_build_object(
          'counts', (
            SELECT json_build_object(
              'total_students', (SELECT count(*)::int FROM student_profiles),
              'active_students', (SELECT count(*)::int FROM student_profiles sp JOIN users u ON u.id = sp.user_id WHERE u.status = 'active'),
              'total_teachers', (SELECT count(*)::int FROM teacher_profiles),
              'active_teachers', (SELECT count(*)::int FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id WHERE u.status = 'active'),
              'active_courses', (SELECT count(*)::int FROM courses WHERE status = 'active'),
              'active_batches', (SELECT count(*)::int FROM batches WHERE status = 'active'),
              'upcoming_exams', (SELECT count(*)::int FROM exams WHERE status IN ('scheduled', 'published') AND starts_at >= now()),
              'announcements', (SELECT count(*)::int FROM announcements WHERE published_at IS NOT NULL)
            )
          ),
          'attendance_today', (
            SELECT json_build_object(
              'marked', count(*)::int,
              'present', count(*) FILTER (WHERE status IN ('present', 'late'))::int
            )
            FROM attendance WHERE session_date = CURRENT_DATE
          ),
          'pending_fees', (
            SELECT json_build_object(
              'pending_amount', COALESCE(SUM(sf.net_amount - COALESCE(p.paid, 0)), 0)::numeric,
              'pending_count', count(*) FILTER (WHERE sf.net_amount - COALESCE(p.paid, 0) > 0)::int
            )
            FROM student_fees sf
            LEFT JOIN (SELECT student_fee_id, SUM(amount) AS paid FROM payments GROUP BY student_fee_id) p
              ON p.student_fee_id = sf.id
            WHERE sf.status <> 'waived'
          ),
          'recent_admissions', (
            SELECT COALESCE(json_agg(row_to_json(admission)), '[]'::json)
            FROM (
              SELECT u.id, u.full_name, u.email, sp.enrollment_no, sp.admission_date,
                     c.name AS course_name, b.name AS batch_name
              FROM student_profiles sp
              JOIN users u ON u.id = sp.user_id
              LEFT JOIN LATERAL (
                SELECT c.name FROM enrollments e JOIN courses c ON c.id = e.course_id
                WHERE e.student_id = sp.user_id AND e.status = 'active'
                ORDER BY e.enrolled_at DESC LIMIT 1
              ) c ON true
              LEFT JOIN LATERAL (
                SELECT b.name FROM enrollments e JOIN batches b ON b.id = e.batch_id
                WHERE e.student_id = sp.user_id AND e.status = 'active'
                ORDER BY e.enrolled_at DESC LIMIT 1
              ) b ON true
              ORDER BY sp.created_at DESC
              LIMIT 5
            ) admission
          ),
          'admissions_trend', (
            SELECT COALESCE(json_agg(row_to_json(trend)), '[]'::json)
            FROM (
              SELECT to_char(date_trunc('month', sp.admission_date), 'Mon') AS label,
                     date_trunc('month', sp.admission_date) AS month,
                     count(*)::int AS count
              FROM student_profiles sp
              WHERE sp.admission_date >= date_trunc('month', CURRENT_DATE) - interval '5 months'
              GROUP BY 1, 2
              ORDER BY 2
            ) trend
          ),
          'attendance_trend', (
            SELECT COALESCE(json_agg(row_to_json(trend)), '[]'::json)
            FROM (
              SELECT session_date::text AS date,
                     count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
                     count(*)::int AS total
              FROM attendance
              WHERE session_date >= CURRENT_DATE - interval '13 days'
              GROUP BY session_date
              ORDER BY session_date
            ) trend
          ),
          'upcoming_exams', (
            SELECT COALESCE(json_agg(row_to_json(exam)), '[]'::json)
            FROM (
              SELECT e.id, e.title, e.starts_at, e.duration_minutes, b.name AS batch_name, s.name AS subject_name
              FROM exams e
              JOIN batches b ON b.id = e.batch_id
              LEFT JOIN subjects s ON s.id = e.subject_id
              WHERE e.status IN ('scheduled', 'published') AND e.starts_at >= now()
              ORDER BY e.starts_at
              LIMIT 5
            ) exam
          ),
          'announcements', (
            SELECT COALESCE(json_agg(row_to_json(notice)), '[]'::json)
            FROM (
              SELECT a.id, a.title, a.body, a.published_at, a.is_pinned
              FROM announcements a
              WHERE a.published_at IS NOT NULL AND (a.expires_at IS NULL OR a.expires_at > now())
              ORDER BY a.is_pinned DESC, a.published_at DESC
              LIMIT 4
            ) notice
          )
        ) AS payload
      `);
      const {
        counts,
        attendance_today: attendanceToday,
        pending_fees: pendingFees,
        recent_admissions: recentAdmissions,
        admissions_trend: admissionsTrend,
        attendance_trend: attendanceTrend,
        upcoming_exams: upcomingExams,
        announcements
      } = payload;

      return {
        metrics: {
          totalStudents: num(counts.total_students),
          activeStudents: num(counts.active_students),
          totalTeachers: num(counts.total_teachers),
          activeTeachers: num(counts.active_teachers),
          activeCourses: num(counts.active_courses),
          activeBatches: num(counts.active_batches),
          upcomingExams: num(counts.upcoming_exams),
          announcements: num(counts.announcements),
          attendanceToday: {
            present: num(attendanceToday.present),
            marked: num(attendanceToday.marked),
            percentage: num(attendanceToday.marked) === 0 ? null : Math.round((num(attendanceToday.present) / num(attendanceToday.marked)) * 100)
          },
          pendingFees: {
            amount: num(pendingFees.pending_amount),
            students: num(pendingFees.pending_count)
          }
        },
        recentAdmissions,
        admissionsTrend: admissionsTrend.map((row) => ({ label: row.label, count: num(row.count) })),
        attendanceTrend: attendanceTrend.map((row) => ({
          date: row.date,
          present: num(row.present),
          total: num(row.total),
          percentage: num(row.total) === 0 ? null : Math.round((num(row.present) / num(row.total)) * 100)
        })),
        upcomingExams,
        announcements
      };
    },

    async teacher(teacherId) {
      const [batches, stats, todaySchedule, upcomingExams, recentSubmissions] = await Promise.all([
        db.many(
          `SELECT b.id, b.name, b.code, c.name AS course_name,
                  count(DISTINCT e.student_id)::int AS student_count
           FROM batch_teachers bt
           JOIN batches b ON b.id = bt.batch_id
           JOIN courses c ON c.id = b.course_id
           LEFT JOIN enrollments e ON e.batch_id = b.id AND e.status = 'active'
           WHERE bt.teacher_id = $1
           GROUP BY b.id, b.name, b.code, c.name
           ORDER BY b.name`,
          [teacherId]
        ),
        db.one(
          `SELECT count(DISTINCT bt.batch_id)::int AS batch_count,
                  count(DISTINCT e.student_id)::int AS student_count
           FROM batch_teachers bt
           LEFT JOIN enrollments e ON e.batch_id = bt.batch_id AND e.status = 'active'
           WHERE bt.teacher_id = $1`,
          [teacherId]
        ),
        db.many(
          `SELECT bs.id, bs.start_time, bs.end_time, bs.room,
                  b.name AS batch_name, s.name AS subject_name
           FROM batch_schedules bs
           JOIN batches b ON b.id = bs.batch_id
           LEFT JOIN subjects s ON s.id = bs.subject_id
           WHERE bs.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::int
             AND (bs.teacher_id = $1 OR b.id IN (SELECT batch_id FROM batch_teachers WHERE teacher_id = $1))
           ORDER BY bs.start_time`,
          [teacherId]
        ),
        db.many(
          `SELECT e.id, e.title, e.starts_at, e.duration_minutes, b.name AS batch_name
           FROM exams e
           JOIN batches b ON b.id = e.batch_id
           WHERE e.starts_at >= now() AND e.status IN ('scheduled', 'published')
             AND b.id IN (SELECT batch_id FROM batch_teachers WHERE teacher_id = $1)
           ORDER BY e.starts_at
           LIMIT 5`,
          [teacherId]
        ),
        db.many(
          `SELECT sub.id, sub.status, sub.submitted_at, sub.marks_awarded,
                  a.title AS assignment_title, u.full_name AS student_name
           FROM assignment_submissions sub
           JOIN assignments a ON a.id = sub.assignment_id
           JOIN users u ON u.id = sub.student_id
           WHERE a.batch_id IN (SELECT batch_id FROM batch_teachers WHERE teacher_id = $1)
           ORDER BY sub.submitted_at DESC
           LIMIT 5`,
          [teacherId]
        )
      ]);

      return {
        metrics: {
          batches: num(stats.batch_count),
          students: num(stats.student_count),
          todayClasses: todaySchedule.length,
          upcomingExams: upcomingExams.length
        },
        batches,
        todaySchedule,
        upcomingExams,
        recentSubmissions
      };
    },

    async student(studentId) {
      const enrollment = await db.one(
        `SELECT e.id, e.enrolled_at,
                c.id AS course_id, c.name AS course_name, c.code AS course_code,
                b.id AS batch_id, b.name AS batch_name, b.code AS batch_code,
                b.start_date, b.end_date
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         JOIN batches b ON b.id = e.batch_id
         WHERE e.student_id = $1 AND ${learningEnrollment()}
         ORDER BY e.enrolled_at DESC
         LIMIT 1`,
        [studentId]
      );

      const courseId = enrollment?.course_id ?? null;
      const batchId = enrollment?.batch_id ?? null;

      const [
        profile,
        todaySchedule,
        announcements,
        upcomingExams,
        recentResults,
        attendance,
        monthlyAttendance,
        fees,
        unread,
        resumeLesson,
        nextClassRow,
        pendingAssignments,
        pendingAssignmentCount
      ] =
        await Promise.all([
          db.one(
            `SELECT u.full_name, sp.enrollment_no, sp.admission_date
             FROM student_profiles sp JOIN users u ON u.id = sp.user_id
             WHERE sp.user_id = $1`,
            [studentId]
          ),
          batchId
            ? db.many(
                `SELECT bs.start_time, bs.end_time, bs.room, s.name AS subject_name
                 FROM batch_schedules bs
                 LEFT JOIN subjects s ON s.id = bs.subject_id
                 WHERE bs.batch_id = $1 AND bs.day_of_week = EXTRACT(DOW FROM CURRENT_DATE)::int
                 ORDER BY bs.start_time`,
                [batchId]
              )
            : Promise.resolve([]),
          db.many(
            `SELECT a.id, a.title, a.body, a.published_at, a.is_pinned
             FROM announcements a
             WHERE a.published_at IS NOT NULL
               AND (a.expires_at IS NULL OR a.expires_at > now())
               AND (a.audience = 'all'
                 OR (a.audience = 'role' AND a.role_code = 'student')
                 OR (a.audience = 'course' AND a.course_id = $1::uuid)
                 OR (a.audience = 'batch' AND a.batch_id = $2::uuid))
             ORDER BY a.is_pinned DESC, a.published_at DESC
             LIMIT 5`,
            [courseId, batchId]
          ),
          batchId
            ? db.many(
                `SELECT e.id, e.title, e.starts_at, e.ends_at, e.duration_minutes,
                        s.name AS subject_name,
                        (SELECT count(*)::int FROM exam_attempts ea
                         WHERE ea.exam_id = e.id AND ea.student_id = $2) AS attempts
                 FROM exams e
                 LEFT JOIN subjects s ON s.id = e.subject_id
                 WHERE e.batch_id = $1 AND e.status IN ('scheduled', 'published') AND e.ends_at > now()
                 ORDER BY e.starts_at
                 LIMIT 5`,
                [batchId, studentId]
              )
            : Promise.resolve([]),
          db.many(
            `SELECT er.id, e.title AS exam_title, er.obtained_marks, er.total_marks,
                    er.percentage, er.status, er.published_at
             FROM exam_results er
             JOIN exams e ON e.id = er.exam_id
             WHERE er.student_id = $1 AND e.results_published = true
             ORDER BY er.published_at DESC NULLS LAST
             LIMIT 5`,
            [studentId]
          ),
          db.one(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present,
                    count(*) FILTER (WHERE status = 'absent')::int AS absent
             FROM attendance WHERE student_id = $1`,
            [studentId]
          ),
          db.one(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE status IN ('present', 'late'))::int AS present
             FROM attendance
             WHERE student_id = $1 AND session_date >= date_trunc('month', CURRENT_DATE)`,
            [studentId]
          ),
          db.one(
            `SELECT COALESCE(SUM(sf.net_amount), 0)::numeric AS total,
                    COALESCE(SUM(COALESCE(p.paid, 0)), 0)::numeric AS paid,
                    COALESCE(SUM(sf.net_amount - COALESCE(p.paid, 0)), 0)::numeric AS pending,
                    count(*) FILTER (WHERE sf.net_amount - COALESCE(p.paid, 0) > 0)::int AS open_invoices
             FROM student_fees sf
             LEFT JOIN (SELECT student_fee_id, SUM(amount) AS paid FROM payments GROUP BY student_fee_id) p
               ON p.student_fee_id = sf.id
             WHERE sf.student_id = $1 AND sf.status <> 'waived'`,
            [studentId]
          ),
          db.one("SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL", [studentId]),
          batchId
            ? db.one(
                `SELECT l.id, l.title, l.chapter, s.name AS subject_name, l.duration_minutes,
                        (l.youtube_video_id IS NOT NULL) AS has_video,
                        COALESCE(lp.last_position_seconds, 0) AS last_position_seconds, lp.updated_at
                 FROM lessons l
                 JOIN subjects s ON s.id = l.subject_id
                 LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.student_id = $2
                 WHERE l.batch_id = $1 AND l.status = 'published' AND lp.completed_at IS NULL
                 ORDER BY lp.updated_at DESC NULLS LAST, l.sort_order, l.created_at
                 LIMIT 1`,
                [batchId, studentId]
              )
            : Promise.resolve(null),
          batchId
            ? db.one(
                `WITH local_now AS (
                   SELECT now() AT TIME ZONE COALESCE(
                     NULLIF((SELECT value FROM app_settings WHERE key = 'instituteTimezone'), ''),
                     'Asia/Kolkata'
                   ) AS ts
                 ), candidates AS (
                   SELECT bs.id, bs.start_time, bs.end_time, bs.room,
                          s.name AS subject_name, b.name AS batch_name,
                          local_now.ts::date + (
                            (bs.day_of_week - EXTRACT(DOW FROM local_now.ts)::int + 7) % 7
                          ) + CASE
                            WHEN bs.day_of_week = EXTRACT(DOW FROM local_now.ts)::int
                                 AND bs.end_time <= local_now.ts::time
                            THEN 7 ELSE 0
                          END AS next_date
                   FROM batch_schedules bs
                   CROSS JOIN local_now
                   JOIN batches b ON b.id = bs.batch_id
                   LEFT JOIN subjects s ON s.id = bs.subject_id
                   WHERE bs.batch_id = $1
                 )
                 SELECT id, subject_name, batch_name, room, start_time, end_time,
                        to_char(next_date, 'YYYY-MM-DD') AS next_date
                 FROM candidates
                 ORDER BY next_date, start_time
                 LIMIT 1`,
                [batchId]
              )
            : Promise.resolve(null),
          batchId
            ? db.many(
                `SELECT a.id, a.title, a.due_at, a.max_marks, s.name AS subject_name
                 FROM assignments a
                 JOIN subjects s ON s.id = a.subject_id
                 LEFT JOIN assignment_submissions sub
                   ON sub.assignment_id = a.id AND sub.student_id = $2
                 WHERE a.batch_id = $1 AND a.status = 'published' AND sub.id IS NULL
                 ORDER BY a.due_at ASC NULLS LAST, a.created_at DESC
                 LIMIT 4`,
                [batchId, studentId]
              )
            : Promise.resolve([]),
          batchId
            ? db.one(
                `SELECT count(*)::int AS count
                 FROM assignments a
                 LEFT JOIN assignment_submissions sub
                   ON sub.assignment_id = a.id AND sub.student_id = $2
                 WHERE a.batch_id = $1 AND a.status = 'published' AND sub.id IS NULL`,
                [batchId, studentId]
              )
            : Promise.resolve({ count: 0 })
        ]);

      const attendancePercentage =
        num(attendance.total) === 0 ? null : Math.round((num(attendance.present) / num(attendance.total)) * 100);
      const pendingAmount = num(fees.pending);
      const paidAmount = num(fees.paid);

      return {
        student: {
          fullName: profile?.full_name ?? null,
          enrollmentNo: profile?.enrollment_no ?? null,
          admissionDate: profile?.admission_date ?? null
        },
        enrollment,
        todaySchedule,
        announcements,
        upcomingExams,
        recentResults,
        resumeLesson: resumeLesson
          ? {
              id: resumeLesson.id,
              title: resumeLesson.title,
              chapter: resumeLesson.chapter,
              subjectName: resumeLesson.subject_name,
              durationMinutes: resumeLesson.duration_minutes,
              hasVideo: Boolean(resumeLesson.has_video),
              lastPositionSeconds: num(resumeLesson.last_position_seconds),
              progressPercent:
                resumeLesson.duration_minutes && resumeLesson.last_position_seconds
                  ? Math.min(
                      100,
                      Math.round(
                        (num(resumeLesson.last_position_seconds) / (num(resumeLesson.duration_minutes) * 60)) * 100
                      )
                    )
                  : 0
            }
          : null,
        nextClass: nextClassRow
          ? {
              id: nextClassRow.id,
              subjectName: nextClassRow.subject_name,
              batchName: nextClassRow.batch_name,
              room: nextClassRow.room,
              startTime: nextClassRow.start_time,
              endTime: nextClassRow.end_time,
              nextDate: nextClassRow.next_date
            }
          : null,
        pendingAssignments: pendingAssignments.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          dueAt: assignment.due_at,
          maxMarks: assignment.max_marks,
          subjectName: assignment.subject_name
        })),
        pendingAssignmentsTotal: num(pendingAssignmentCount?.count),
        attendance: {
          total: num(attendance.total),
          present: num(attendance.present),
          absent: num(attendance.absent),
          percentage: attendancePercentage,
          thisMonth: {
            total: num(monthlyAttendance.total),
            present: num(monthlyAttendance.present),
            percentage:
              num(monthlyAttendance.total) === 0
                ? null
                : Math.round((num(monthlyAttendance.present) / num(monthlyAttendance.total)) * 100)
          }
        },
        fees: {
          total: num(fees.total),
          paid: paidAmount,
          pending: pendingAmount,
          openInvoices: num(fees.open_invoices),
          status: pendingAmount === 0 ? "paid" : paidAmount > 0 ? "partial" : "pending"
        },
        unreadNotifications: num(unread.count)
      };
    }
  };
}
