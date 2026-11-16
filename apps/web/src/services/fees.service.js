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

export const feeService = {
  structures: (params) => api.get(`/api/admin/fees/structures${query(params)}`),
  createStructure: (payload) => api.post("/api/admin/fees/structures", payload),
  dues: (params) => api.get(`/api/admin/fees/dues${query(params)}`),
  assign: (payload) => api.post("/api/admin/fees/assign", payload),
  recordPayment: (feeId, payload) => api.post(`/api/admin/fees/${feeId}/payments`, payload),
  payments: (params) => api.get(`/api/admin/fees/payments${query(params)}`),
  voidPayment: (paymentId, payload) => api.post(`/api/admin/fees/payments/${paymentId}/void`, payload),
  receipt: (paymentId) => api.get(`/api/admin/fees/payments/${paymentId}/receipt`),
  waive: (feeId, payload) => api.post(`/api/admin/fees/${feeId}/waive`, payload),
  updateFee: (feeId, payload) => api.patch(`/api/admin/fees/${feeId}`, payload),
  reminders: (params) => api.get(`/api/admin/fees/reminders${query(params)}`)
};
