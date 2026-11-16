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

export const announcementService = {
  list: (params) => api.get(`/api/admin/announcements${query(params)}`),
  create: (payload) => api.post("/api/admin/announcements", payload),
  update: (id, payload) => api.patch(`/api/admin/announcements/${id}`, payload),
  remove: (id) => api.del(`/api/admin/announcements/${id}`),

  teacherList: (params) => api.get(`/api/teacher/announcements${query(params)}`),
  teacherCreate: (payload) => api.post("/api/teacher/announcements", payload)
};
