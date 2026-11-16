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

export const adminOpsService = {
  admins: (params) => api.get(`/api/admin/admins${query(params)}`),
  createAdmin: (payload) => api.post("/api/admin/admins", payload),
  updateAdmin: (id, payload) => api.patch(`/api/admin/admins/${id}`, payload),
  resetAdminPassword: (id, password) => api.post(`/api/admin/admins/${id}/password`, { password }),

  settings: () => api.get("/api/admin/settings"),
  updateSettings: (payload) => api.patch("/api/admin/settings", payload),

  audit: (params) => api.get(`/api/admin/audit-logs${query(params)}`),

  reports: () => api.get("/api/admin/reports/overview"),
  feesCsvUrl: "/api/admin/reports/fees.csv",
  attendanceCsvUrl: "/api/admin/reports/attendance.csv"
};
