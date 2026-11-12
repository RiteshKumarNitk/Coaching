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

export const studentService = {
  courses: () => api.get("/api/student/courses"),
  batch: (id) => api.get(`/api/student/batches/${id}`),

  lessons: (params) => api.get(`/api/student/lessons${query(params)}`),
  lesson: (id) => api.get(`/api/student/lessons/${id}`),
  saveProgress: (id, payload) => api.post(`/api/student/lessons/${id}/progress`, payload),

  materials: (params) => api.get(`/api/student/materials${query(params)}`),

  assignments: (params) => api.get(`/api/student/assignments${query(params)}`),
  assignment: (id) => api.get(`/api/student/assignments/${id}`),
  submitAssignment: (id, payload) => api.post(`/api/student/assignments/${id}/submissions`, payload),

  attendance: (params) => api.get(`/api/student/attendance${query(params)}`),
  announcements: (params) => api.get(`/api/student/announcements${query(params)}`)
};
