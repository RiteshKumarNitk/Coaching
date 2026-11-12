import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarPlus, Plus, Trash2, UserPlus, Users } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useTeachersLookup } from "../../hooks/useAdminLookups.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { SectionCard } from "../../components/SectionCard.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { DashboardSkeleton } from "../../components/Skeleton.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { DAY_LABELS, formatDate, formatTimeRange } from "../../utils/format.js";

const statusTone = (status) => (status === "active" ? "success" : status === "upcoming" ? "info" : "neutral");

export function BatchDetailPage() {
  const { id } = useParams();
  useDocumentTitle("Batch detail");
  const queryClient = useQueryClient();
  const teachersQuery = useTeachersLookup();

  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [teacherSubjectId, setTeacherSubjectId] = useState("");
  const [slot, setSlot] = useState({ dayOfWeek: "1", startTime: "07:00", endTime: "08:30", subjectId: "", teacherId: "", room: "" });
  const [actionError, setActionError] = useState(null);

  const batchQuery = useQuery({
    queryKey: ["admin", "batch", id],
    queryFn: () => adminService.batch(id),
    enabled: Boolean(id)
  });

  const courseQuery = useQuery({
    queryKey: ["admin", "course", batchQuery.data?.batch.courseId],
    queryFn: () => adminService.course(batchQuery.data.batch.courseId),
    enabled: Boolean(batchQuery.data?.batch.courseId)
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "batch", id] });
    queryClient.invalidateQueries({ queryKey: ["admin", "batches"] });
  };

  const run = (mutation) =>
    mutation.mutate(undefined, {
      onError: (error) => setActionError(error.message),
      onSuccess: () => setActionError(null)
    });

  const addSubject = useMutation({
    mutationFn: () => adminService.addBatchSubject(id, subjectId),
    onSuccess: () => {
      setSubjectId("");
      setActionError(null);
      invalidate();
    },
    onError: (error) => setActionError(error.message)
  });

  const removeSubject = useMutation({
    mutationFn: (removeId) => adminService.removeBatchSubject(id, removeId),
    onSuccess: invalidate,
    onError: (error) => setActionError(error.message)
  });

  const addTeacher = useMutation({
    mutationFn: () => adminService.assignBatchTeacher(id, { teacherId, subjectId: teacherSubjectId }),
    onSuccess: () => {
      setTeacherId("");
      setTeacherSubjectId("");
      setActionError(null);
      invalidate();
    },
    onError: (error) => setActionError(error.message)
  });

  const removeTeacher = useMutation({
    mutationFn: (removeId) => adminService.removeBatchTeacher(id, removeId),
    onSuccess: invalidate,
    onError: (error) => setActionError(error.message)
  });

  const addSchedule = useMutation({
    mutationFn: () =>
      adminService.addSchedule(id, {
        dayOfWeek: Number(slot.dayOfWeek),
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
        room: slot.room
      }),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (error) => setActionError(error.message)
  });

  const removeSchedule = useMutation({
    mutationFn: (scheduleId) => adminService.removeSchedule(id, scheduleId),
    onSuccess: invalidate,
    onError: (error) => setActionError(error.message)
  });

  if (batchQuery.isPending) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/admin/batches">
          <ArrowLeft size={14} /> Batches
        </Link>
        <DashboardSkeleton cards={3} panels={2} />
      </div>
    );
  }

  if (batchQuery.isError) {
    return (
      <div className="page-section">
        <Link className="back-link" to="/admin/batches">
          <ArrowLeft size={14} /> Batches
        </Link>
        <ErrorState error={batchQuery.error} onRetry={batchQuery.refetch} />
      </div>
    );
  }

  const { batch, subjects, teachers, students, schedule } = batchQuery.data;

  return (
    <div className="page-section">
      <Link className="back-link" to="/admin/batches">
        <ArrowLeft size={14} /> Batches
      </Link>

      {actionError ? (
        <div className="alert alert--error" role="alert">
          {actionError}
        </div>
      ) : null}

      <section className="detail-hero">
        <div>
          <h1>{batch.name}</h1>
          <p>
            {batch.code} · {batch.courseName} ({batch.courseCode})
          </p>
          <div className="row row--wrap" style={{ marginTop: 8 }}>
            <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
            <Badge tone="brand">{batch.studentCount} students</Badge>
            <Badge tone="accent">
              {formatDate(batch.startDate)} → {formatDate(batch.endDate)}
            </Badge>
          </div>
        </div>
        <Link className="btn btn--ghost btn--sm" to="/admin/batches">
          Manage batches
        </Link>
      </section>

      <div className="grid-2">
        <SectionCard title="Subjects" subtitle="Subjects taught in this batch">
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <select className="input" style={{ maxWidth: 220 }} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} aria-label="Subject to add">
              <option value="">Choose subject…</option>
              {(courseQuery.data?.subjects ?? [])
                .filter((subject) => !subjects.some((entry) => entry.id === subject.id))
                .map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                    {subject.status !== "active" ? " (inactive)" : ""}
                  </option>
                ))}
            </select>
            <button type="button" className="btn btn--primary btn--sm" disabled={!subjectId || addSubject.isPending} onClick={() => run(addSubject)}>
              <Plus size={14} /> Add
            </button>
          </div>
          <ul className="list">
            {subjects.map((subject) => (
              <li className="list__item" key={subject.id}>
                <div className="list__main">
                  <p className="list__title">{subject.name}</p>
                  <p className="list__meta mono">{subject.code}</p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${subject.name}`}
                  onClick={() => removeSubject.mutate(subject.id)}
                  style={{ width: 32, height: 32 }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
          {subjects.length === 0 ? (
            <EmptyState icon={Plus} title="No subjects yet" description="Add a subject to schedule classes and publish content." />
          ) : null}
        </SectionCard>

        <SectionCard title="Teachers" subtitle="Assigned staff for this batch">
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <FormField label="Teacher" htmlFor="batch-teacher">
              <select id="batch-teacher" className="input" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
                <option value="">Choose teacher…</option>
                {(teachersQuery.data ?? []).map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.fullName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Subject (optional)" htmlFor="batch-teacher-subject">
              <select id="batch-teacher-subject" className="input" value={teacherSubjectId} onChange={(event) => setTeacherSubjectId(event.target.value)}>
                <option value="">All subjects</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="field field--full">
              <button type="button" className="btn btn--primary btn--sm" disabled={!teacherId || addTeacher.isPending} onClick={() => run(addTeacher)}>
                <UserPlus size={14} /> Assign teacher
              </button>
            </div>
          </div>

          {teachers.length === 0 ? (
            <EmptyState icon={UserPlus} title="No teachers assigned" description="Assign a teacher so they can see this batch." />
          ) : (
            <ul className="list">
              {teachers.map((teacher) => (
                <li className="list__item" key={teacher.id}>
                  <div className="list__main">
                    <p className="list__title">{teacher.fullName}</p>
                    <p className="list__meta">{teacher.subjectName || "All subjects"}</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${teacher.fullName}`}
                    onClick={() => removeTeacher.mutate(teacher.teacherId)}
                    style={{ width: 32, height: 32 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Timetable" subtitle="Weekly class slots used by the teacher and student dashboards">
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <FormField label="Day" htmlFor="slot-day">
            <select id="slot-day" className="input" value={slot.dayOfWeek} onChange={(event) => setSlot({ ...slot, dayOfWeek: event.target.value })}>
              {DAY_LABELS.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Room" htmlFor="slot-room">
            <input id="slot-room" className="input" value={slot.room} onChange={(event) => setSlot({ ...slot, room: event.target.value })} />
          </FormField>
          <FormField label="Start time" htmlFor="slot-start">
            <input id="slot-start" className="input" type="time" value={slot.startTime} onChange={(event) => setSlot({ ...slot, startTime: event.target.value })} />
          </FormField>
          <FormField label="End time" htmlFor="slot-end">
            <input id="slot-end" className="input" type="time" value={slot.endTime} onChange={(event) => setSlot({ ...slot, endTime: event.target.value })} />
          </FormField>
          <FormField label="Subject" htmlFor="slot-subject">
            <select id="slot-subject" className="input" value={slot.subjectId} onChange={(event) => setSlot({ ...slot, subjectId: event.target.value })}>
              <option value="">No subject</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Teacher" htmlFor="slot-teacher">
            <select id="slot-teacher" className="input" value={slot.teacherId} onChange={(event) => setSlot({ ...slot, teacherId: event.target.value })}>
              <option value="">No teacher</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.teacherId}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </FormField>
          <div className="field field--full">
            <button type="button" className="btn btn--primary btn--sm" disabled={addSchedule.isPending} onClick={() => run(addSchedule)}>
              <CalendarPlus size={14} /> Add class slot
            </button>
          </div>
        </div>

        {schedule.length === 0 ? (
          <EmptyState icon={CalendarPlus} title="No timetable yet" description="Add weekly slots so students see today's classes." />
        ) : (
          <ul className="list">
            {schedule.map((entry) => (
              <li className="list__item" key={entry.id}>
                <div className="list__main">
                  <p className="list__title">
                    {DAY_LABELS[entry.dayOfWeek]} · {entry.subjectName || "Class"}
                  </p>
                  <p className="list__meta">
                    {formatTimeRange(entry.startTime, entry.endTime)}
                    {entry.room ? ` · ${entry.room}` : ""}
                    {entry.teacherName ? ` · ${entry.teacherName}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove class slot"
                  onClick={() => removeSchedule.mutate(entry.id)}
                  style={{ width: 32, height: 32 }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Students" subtitle={`${students.filter((student) => student.status === "active").length} active enrolment(s)`}>
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => (
                <Link to={`/admin/students/${row.studentId}`} className="cell-primary" style={{ textDecoration: "none" }}>
                  {row.fullName}
                  <span className="cell-sub" style={{ display: "block" }}>
                    {row.email}
                  </span>
                </Link>
              )
            },
            { key: "enrollmentNo", header: "Enrolment", render: (row) => <span className="mono">{row.enrollmentNo}</span> },
            { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> }
          ]}
          rows={students}
          rowKey="enrollmentId"
          loading={false}
          empty={<EmptyState icon={Users} title="No students in this batch" description="Enrol students from their profile page." />}
        />
      </SectionCard>
    </div>
  );
}
