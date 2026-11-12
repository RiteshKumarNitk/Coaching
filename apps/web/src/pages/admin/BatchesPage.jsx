import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { batchUpdateSchema, createBatchSchema } from "@coaching/shared";
import { Link, useNavigate } from "react-router-dom";
import { Layers, Pencil, Plus } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useCourses } from "../../hooks/useAdminLookups.js";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.js";
import { PageHeader } from "../../components/PageHeader.jsx";
import { SectionCard } from "../../components/SectionCard.jsx";
import { DataTable } from "../../components/DataTable.jsx";
import { Pagination } from "../../components/Pagination.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormField } from "../../components/FormField.jsx";
import { Badge } from "../../components/Badge.jsx";
import { EmptyState } from "../../components/EmptyState.jsx";
import { ErrorState } from "../../components/ErrorState.jsx";
import { dateInput, formatDate } from "../../utils/format.js";

const statusTone = (status) => (status === "active" ? "success" : status === "upcoming" ? "info" : "neutral");

export function BatchesPage() {
  useDocumentTitle("Batches");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const coursesQuery = useCourses();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);

  const batchesQuery = useQuery({
    queryKey: ["admin", "batches", { page }],
    queryFn: () => adminService.batches({ page, pageSize: 20 })
  });

  const createForm = useForm({
    resolver: zodResolver(createBatchSchema),
    defaultValues: {
      courseId: "",
      code: "",
      name: "",
      startDate: dateInput(new Date()),
      endDate: "",
      capacity: 40,
      schedule: ""
    }
  });

  const editForm = useForm({ resolver: zodResolver(batchUpdateSchema), defaultValues: {} });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      courseId: editing.courseId,
      code: editing.code,
      name: editing.name,
      startDate: dateInput(editing.startDate),
      endDate: dateInput(editing.endDate),
      capacity: editing.capacity ?? undefined,
      schedule: editing.scheduleNote ?? "",
      status: editing.status
    });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: adminService.createBatch,
    onSuccess: (data) => {
      setFormOpen(false);
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ["admin", "batches"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "admin"] });
      navigate(`/admin/batches/${data.batch.id}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => adminService.updateBatch(editing.id, values),
    onSuccess: (data) => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "batches"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "batch", data.batch.id] });
    }
  });

  const columns = [
    {
      key: "batch",
      header: "Batch",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.name}</p>
          <p className="cell-sub mono">{row.code}</p>
        </div>
      )
    },
    { key: "courseName", header: "Course", render: (row) => row.courseName },
    {
      key: "dates",
      header: "Dates",
      render: (row) => (
        <span className="cell-sub">
          {formatDate(row.startDate)} → {formatDate(row.endDate)}
        </span>
      )
    },
    {
      key: "counts",
      header: "Students / teachers",
      render: (row) => (
        <span>
          {row.studentCount}
          {row.capacity ? ` / ${row.capacity}` : ""} · {row.teacherCount}
        </span>
      )
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <Link className="btn btn--ghost btn--sm" to={`/admin/batches/${row.id}`}>
            Open
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(row);
            }}
          >
            <Pencil size={13} /> Edit
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Batches"
        description="Class groups, their subjects, teachers, students and timetable."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> Add batch
          </button>
        }
      />

      <SectionCard title="All batches">
        {batchesQuery.isError ? (
          <ErrorState error={batchesQuery.error} onRetry={batchesQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={batchesQuery.data?.items}
            loading={batchesQuery.isPending}
            onRowClick={(row) => navigate(`/admin/batches/${row.id}`)}
            empty={<EmptyState icon={Layers} title="No batches yet" description="Create a batch for a course to start enrolling students." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={batchesQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={formOpen}
        title="Add batch"
        onClose={() => {
          setFormOpen(false);
          createMutation.reset();
        }}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="batch-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create batch"}
            </button>
          </>
        }
      >
        <form id="batch-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Course" htmlFor="b-course" required error={createForm.formState.errors.courseId?.message}>
            <select id="b-course" className="input" {...createForm.register("courseId")}>
              <option value="">Select a course</option>
              {(coursesQuery.data ?? []).map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name} ({course.code})
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Batch code" htmlFor="b-code" required error={createForm.formState.errors.code?.message}>
            <input id="b-code" className="input" placeholder="JEE-28-A" {...createForm.register("code")} />
          </FormField>
          <FormField label="Batch name" htmlFor="b-name" required error={createForm.formState.errors.name?.message}>
            <input id="b-name" className="input" {...createForm.register("name")} />
          </FormField>
          <FormField label="Capacity" htmlFor="b-capacity" error={createForm.formState.errors.capacity?.message}>
            <input
              id="b-capacity"
              className="input"
              type="number"
              min="1"
              {...createForm.register("capacity", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Start date" htmlFor="b-start" required error={createForm.formState.errors.startDate?.message}>
            <input id="b-start" className="input" type="date" {...createForm.register("startDate")} />
          </FormField>
          <FormField label="End date" htmlFor="b-end" required error={createForm.formState.errors.endDate?.message}>
            <input id="b-end" className="input" type="date" {...createForm.register("endDate")} />
          </FormField>
          <FormField label="Schedule note" htmlFor="b-schedule" hint="For example: Mon–Sat, 07:00–10:15">
            <input id="b-schedule" className="input" {...createForm.register("schedule")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit batch"
        onClose={() => setEditing(null)}
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-batch-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-batch-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Course" htmlFor="eb-course">
            <select id="eb-course" className="input" {...editForm.register("courseId")}>
              {(coursesQuery.data ?? []).map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Batch code" htmlFor="eb-code">
            <input id="eb-code" className="input" {...editForm.register("code")} />
          </FormField>
          <FormField label="Name" htmlFor="eb-name">
            <input id="eb-name" className="input" {...editForm.register("name")} />
          </FormField>
          <FormField label="Status" htmlFor="eb-status">
            <select id="eb-status" className="input" {...editForm.register("status")}>
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </FormField>
          <FormField label="Start date" htmlFor="eb-start">
            <input id="eb-start" className="input" type="date" {...editForm.register("startDate")} />
          </FormField>
          <FormField label="End date" htmlFor="eb-end">
            <input id="eb-end" className="input" type="date" {...editForm.register("endDate")} />
          </FormField>
          <FormField label="Capacity" htmlFor="eb-capacity">
            <input
              id="eb-capacity"
              className="input"
              type="number"
              min="1"
              {...editForm.register("capacity", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Schedule note" htmlFor="eb-schedule">
            <input id="eb-schedule" className="input" {...editForm.register("schedule")} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
