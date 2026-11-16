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

export const guardianService = {
  children: () => api.get("/api/guardian/children"),
  attendance: (childId, params) => api.get(`/api/guardian/children/${childId}/attendance${query(params)}`),
  fees: (childId) => api.get(`/api/guardian/children/${childId}/fees`),
  results: (childId, params) => api.get(`/api/guardian/children/${childId}/results${query(params)}`)
};
