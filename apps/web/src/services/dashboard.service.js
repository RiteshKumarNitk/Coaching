import { api } from "./api.js";

export const dashboardService = {
  admin: () => api.get("/api/admin/dashboard"),
  teacher: () => api.get("/api/teacher/dashboard"),
  student: () => api.get("/api/student/dashboard")
};
