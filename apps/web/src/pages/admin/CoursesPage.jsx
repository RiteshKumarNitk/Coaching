import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCourseSchema, courseUpdateSchema } from "@coaching/shared";
import { BookOpen, Pencil, Plus } from "lucide-react";
import { adminService } from "../../services/admin.service.js";
import { useSubjects } from "../../hooks/useAdminLookups.js";
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

export function CoursesPage() {
  useDocumentTitle("Courses");
  const queryClient = useQueryClient();
  const subjectsQuery = useSubjects();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [subjectCourse, setSubjectCourse] = useState(null);
  const [selectedSubjects, setSelectedSubjects] = useState([]);
  const [page, setPage] = useState(1);

  const coursesQuery = useQuery({
    queryKey: ["admin", "courses", { page }],
    queryFn: () => adminService.courses({ page, pageSize: 20 })
  });

  const createForm = useForm({
    resolver: zodResolver(createCourseSchema),
    defaultValues: { code: "", name: "", description: "", durationMonths: 12 }
  });

  const editForm = useForm({
    resolver: zodResolver(courseUpdateSchema),
    defaultValues: {}
  });

  useEffect(() => {
    if (!editing) return;
    editForm.reset({
      code: editing.code,
      name: editing.name,
      description: editing.description ?? "",
      durationMonths: editing.durationMonths,
      status: editing.status
    });
  }, [editing, editForm]);

  const createMutation = useMutation({
    mutationFn: adminService.createCourse,
    onSuccess: () => {
      setFormOpen(false);
      createForm.reset();
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (values) => adminService.updateCourse(editing.id, values),
    onSuccess: () => {
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "batches"] });
    }
  });

  const subjectsMutation = useMutation({
    mutationFn: (subjectIds) => adminService.setCourseSubjects(subjectCourse.id, subjectIds),
    onSuccess: () => {
      setSubjectCourse(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
    }
  });

  async function openSubjects(course) {
    const detail = await adminService.course(course.id);
    setSelectedSubjects(detail.subjects.map((subject) => subject.id));
    setSubjectCourse(detail);
  }

  const columns = [
    {
      key: "course",
      header: "Course",
      render: (row) => (
        <div>
          <p className="cell-primary">{row.name}</p>
          <p className="cell-sub mono">{row.code}</p>
        </div>
      )
    },
    { key: "durationMonths", header: "Duration", render: (row) => `${row.durationMonths} months` },
    { key: "subjectCount", header: "Subjects", render: (row) => <Badge tone="brand">{row.subjectCount}</Badge> },
    { key: "batchCount", header: "Batches", render: (row) => <Badge>{row.batchCount}</Badge> },
    { key: "studentCount", header: "Students", render: (row) => row.studentCount },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="cell-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => openSubjects(row)}>
            Subjects
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(row)}>
            <Pencil size={13} /> Edit
          </button>
        </div>
      )
    }
  ];

  return (
    <div className="page-section">
      <PageHeader
        title="Courses"
        description="Programmes offered by the institute, their subjects and batches."
        actions={
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setFormOpen(true)}>
            <Plus size={15} /> Add course
          </button>
        }
      />

      <SectionCard title="All courses">
        {coursesQuery.isError ? (
          <ErrorState error={coursesQuery.error} onRetry={coursesQuery.refetch} />
        ) : (
          <DataTable
            columns={columns}
            rows={coursesQuery.data?.items}
            loading={coursesQuery.isPending}
            empty={<EmptyState icon={BookOpen} title="No courses yet" description="Create a course before adding batches." />}
          />
        )}
        <Pagination page={page} pageSize={20} total={coursesQuery.data?.total ?? 0} onChange={setPage} />
      </SectionCard>

      <Modal
        open={formOpen}
        title="Add course"
        onClose={() => {
          setFormOpen(false);
          createMutation.reset();
        }}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="course-form" className="btn btn--primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Create course"}
            </button>
          </>
        }
      >
        <form id="course-form" className="form-grid" noValidate onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}>
          {createMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {createMutation.error.message}
            </div>
          ) : null}
          <FormField label="Code" htmlFor="c-code" required error={createForm.formState.errors.code?.message}>
            <input id="c-code" className="input" placeholder="JEE-2028" {...createForm.register("code")} />
          </FormField>
          <FormField label="Duration (months)" htmlFor="c-duration" error={createForm.formState.errors.durationMonths?.message}>
            <input
              id="c-duration"
              className="input"
              type="number"
              min="1"
              max="72"
              {...createForm.register("durationMonths", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Name" htmlFor="c-name" required error={createForm.formState.errors.name?.message}>
            <input id="c-name" className="input" {...createForm.register("name")} />
          </FormField>
          <FormField label="Description" htmlFor="c-description">
            <input id="c-description" className="input" {...createForm.register("description")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title="Edit course"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-course-form" className="btn btn--primary" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <form id="edit-course-form" className="form-grid" noValidate onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}>
          {updateMutation.isError ? (
            <div className="alert alert--error field--full" role="alert">
              {updateMutation.error.message}
            </div>
          ) : null}
          <FormField label="Code" htmlFor="ec-code">
            <input id="ec-code" className="input" {...editForm.register("code")} />
          </FormField>
          <FormField label="Duration (months)" htmlFor="ec-duration">
            <input
              id="ec-duration"
              className="input"
              type="number"
              min="1"
              max="72"
              {...editForm.register("durationMonths", { setValueAs: (value) => (value === "" ? undefined : Number(value)) })}
            />
          </FormField>
          <FormField label="Name" htmlFor="ec-name">
            <input id="ec-name" className="input" {...editForm.register("name")} />
          </FormField>
          <FormField label="Status" htmlFor="ec-status">
            <select id="ec-status" className="input" {...editForm.register("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
          </FormField>
          <FormField label="Description" htmlFor="ec-description">
            <input id="ec-description" className="input" {...editForm.register("description")} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={Boolean(subjectCourse)}
        title="Course subjects"
        description={subjectCourse ? `${subjectCourse.name} (${subjectCourse.code})` : ""}
        onClose={() => setSubjectCourse(null)}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => setSubjectCourse(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={subjectsMutation.isPending}
              onClick={() => subjectsMutation.mutate(selectedSubjects)}
            >
              {subjectsMutation.isPending ? "Saving…" : "Save subjects"}
            </button>
          </>
        }
      >
        {subjectsMutation.isError ? (
          <div className="alert alert--error" role="alert" style={{ marginBottom: 12 }}>
            {subjectsMutation.error.message}
          </div>
        ) : null}
        <div className="checkbox-grid">
          {(subjectsQuery.data ?? []).map((subject) => (
            <label className="checkbox-row" key={subject.id}>
              <input
                type="checkbox"
                checked={selectedSubjects.includes(subject.id)}
                onChange={(event) =>
                  setSelectedSubjects((current) =>
                    event.target.checked ? [...current, subject.id] : current.filter((id) => id !== subject.id)
                  )
                }
              />
              {subject.name}
            </label>
          ))}
        </div>
        {(subjectsQuery.data ?? []).length === 0 ? (
          <EmptyState icon={BookOpen} title="No subjects yet" description="Create subjects from the Subjects page first." />
        ) : null}
      </Modal>
    </div>
  );
}
