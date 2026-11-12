import { api } from "./api.js";

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const teacherService = {
  batches: () => api.get("/api/teacher/batches"),
  batch: (id) => api.get(`/api/teacher/batches/${id}`),

  attendance: (batchId, date) => api.get(`/api/teacher/batches/${batchId}/attendance?date=${date}`),
  saveAttendance: (batchId, payload) => api.post(`/api/teacher/batches/${batchId}/attendance`, payload),

  lessons: (batchId, params) => api.get(`/api/teacher/batches/${batchId}/lessons${query(params)}`),
  createLesson: (batchId, payload) => api.post(`/api/teacher/batches/${batchId}/lessons`, payload),
  updateLesson: (id, payload) => api.patch(`/api/teacher/lessons/${id}`, payload),
  deleteLesson: (id) => api.del(`/api/teacher/lessons/${id}`),

  materials: (batchId, params) => api.get(`/api/teacher/batches/${batchId}/materials${query(params)}`),
  createMaterial: (batchId, payload) => api.post(`/api/teacher/batches/${batchId}/materials`, payload),
  updateMaterial: (id, payload) => api.patch(`/api/teacher/materials/${id}`, payload),
  deleteMaterial: (id) => api.del(`/api/teacher/materials/${id}`),

  assignments: (batchId, params) => api.get(`/api/teacher/batches/${batchId}/assignments${query(params)}`),
  createAssignment: (batchId, payload) => api.post(`/api/teacher/batches/${batchId}/assignments`, payload),
  updateAssignment: (id, payload) => api.patch(`/api/teacher/assignments/${id}`, payload),
  deleteAssignment: (id) => api.del(`/api/teacher/assignments/${id}`),
  assignment: (id) => api.get(`/api/teacher/assignments/${id}`),
  evaluateSubmission: (id, payload) => api.patch(`/api/teacher/submissions/${id}`, payload)
};
