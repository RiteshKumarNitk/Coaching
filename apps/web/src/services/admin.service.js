import { api, ApiError, API_BASE } from "./api.js";

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const adminService = {
  /* students */
  students: (params) => api.get(`/api/admin/students${query(params)}`),
  student: (id) => api.get(`/api/admin/students/${id}`),
  createStudent: (payload) => api.post("/api/admin/students", payload),
  updateStudent: (id, payload) => api.patch(`/api/admin/students/${id}`, payload),
  setStudentStatus: (id, status) => api.post(`/api/admin/students/${id}/status`, { status }),
  enrollStudent: (id, payload) => api.post(`/api/admin/students/${id}/enrollment`, payload),
  closeEnrollment: (id, enrollmentId, payload) =>
    api.post(`/api/admin/students/${id}/enrollment/${enrollmentId}/close`, payload),
  transferEnrollment: (id, enrollmentId, payload) =>
    api.post(`/api/admin/students/${id}/enrollment/${enrollmentId}/transfer`, payload),
  unenrollStudent: (id, enrollmentId) => api.del(`/api/admin/students/${id}/enrollment/${enrollmentId}`),
  resetStudentPassword: (id) => api.post(`/api/admin/students/${id}/reset-password`, {}),
  grantGuardianAccess: (id, payload) => api.post(`/api/admin/students/${id}/guardian-access`, payload),
  importStudents: (csv) => api.post("/api/admin/students/import", { csv }),

  async downloadStudentsCsv() {
    const response = await fetch(`${API_BASE}/api/admin/students/export`, { credentials: "include" });
    if (!response.ok) throw new ApiError(response.status, "Could not export students");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  /* teachers */
  teachers: (params) => api.get(`/api/admin/teachers${query(params)}`),
  teacher: (id) => api.get(`/api/admin/teachers/${id}`),
  createTeacher: (payload) => api.post("/api/admin/teachers", payload),
  updateTeacher: (id, payload) => api.patch(`/api/admin/teachers/${id}`, payload),
  setTeacherStatus: (id, status) => api.post(`/api/admin/teachers/${id}/status`, { status }),
  assignTeacherBatch: (id, payload) => api.post(`/api/admin/teachers/${id}/batches`, payload),
  unassignTeacherBatch: (id, batchId) => api.del(`/api/admin/teachers/${id}/batches/${batchId}`),
  resetTeacherPassword: (id) => api.post(`/api/admin/teachers/${id}/reset-password`, {}),

  /* courses */
  courses: (params) => api.get(`/api/admin/courses${query(params)}`),
  course: (id) => api.get(`/api/admin/courses/${id}`),
  createCourse: (payload) => api.post("/api/admin/courses", payload),
  updateCourse: (id, payload) => api.patch(`/api/admin/courses/${id}`, payload),
  setCourseSubjects: (id, subjectIds) => api.put(`/api/admin/courses/${id}/subjects`, { subjectIds }),

  /* subjects */
  subjects: (params) => api.get(`/api/admin/subjects${query(params)}`),
  createSubject: (payload) => api.post("/api/admin/subjects", payload),
  updateSubject: (id, payload) => api.patch(`/api/admin/subjects/${id}`, payload),

  /* batches */
  batches: (params) => api.get(`/api/admin/batches${query(params)}`),
  batch: (id) => api.get(`/api/admin/batches/${id}`),
  createBatch: (payload) => api.post("/api/admin/batches", payload),
  updateBatch: (id, payload) => api.patch(`/api/admin/batches/${id}`, payload),
  addBatchSubject: (id, subjectId) => api.post(`/api/admin/batches/${id}/subjects`, { subjectId }),
  removeBatchSubject: (id, subjectId) => api.del(`/api/admin/batches/${id}/subjects/${subjectId}`),
  assignBatchTeacher: (id, payload) => api.post(`/api/admin/batches/${id}/teachers`, payload),
  removeBatchTeacher: (id, teacherId) => api.del(`/api/admin/batches/${id}/teachers/${teacherId}`),
  addSchedule: (id, payload) => api.post(`/api/admin/batches/${id}/schedule`, payload),
  removeSchedule: (id, scheduleId) => api.del(`/api/admin/batches/${id}/schedule/${scheduleId}`)
};
