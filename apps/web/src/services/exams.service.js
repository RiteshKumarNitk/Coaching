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

const toIso = (value) => {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

/** Same shape for admins (`/api/admin`) and teachers (`/api/teacher`, batch-scoped). */
function buildExamService(base) {
  return {
    list: (params) => api.get(`${base}/exams${query(params)}`),
    get: (id) => api.get(`${base}/exams/${id}`),
    create: (payload) => api.post(`${base}/exams`, { ...payload, startsAt: toIso(payload.startsAt), endsAt: toIso(payload.endsAt) }),
    update: (id, payload) =>
      api.patch(`${base}/exams/${id}`, {
        ...payload,
        ...(payload.startsAt ? { startsAt: toIso(payload.startsAt) } : {}),
        ...(payload.endsAt ? { endsAt: toIso(payload.endsAt) } : {})
      }),
    addQuestion: (id, payload) => api.post(`${base}/exams/${id}/questions`, payload),
    updateQuestion: (id, payload) => api.patch(`${base}/questions/${id}`, payload),
    deleteQuestion: (id) => api.del(`${base}/questions/${id}`),
    attemptResponses: (attemptId) => api.get(`${base}/attempts/${attemptId}/responses`),
    evaluateResponse: (responseId, awardedMarks) => api.patch(`${base}/responses/${responseId}`, { awardedMarks }),
    publishResults: (id) => api.post(`${base}/exams/${id}/publish-results`, {})
  };
}

export const examService = buildExamService("/api/admin");
export const teacherExamService = buildExamService("/api/teacher");
