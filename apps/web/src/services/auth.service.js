import { api } from "./api.js";

export const authService = {
  login: (credentials) => api.post("/api/auth/login", credentials),
  logout: () => api.post("/api/auth/logout"),
  me: () => api.get("/api/auth/me"),
  changePassword: (payload) => api.post("/api/auth/change-password", payload),
  profile: () => api.get("/api/me")
};
