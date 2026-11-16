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

export const notificationService = {
  list: (params) => api.get(`/api/me/notifications${query(params)}`),
  unreadCount: () => api.get("/api/me/notifications/unread-count"),
  markRead: (id) => api.post(`/api/me/notifications/${id}/read`, {}),
  markAllRead: () => api.post("/api/me/notifications/read-all", {})
};
