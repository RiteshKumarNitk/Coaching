export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

const SESSION_PROBES = ["/api/auth/me", "/api/auth/login"];

/**
 * The role or account behind the tab can change (another device signs in, an admin edits
 * roles). Tell AuthProvider to re-check instead of leaving every page on a stale error.
 */
function notifySessionChanged(path, status) {
  if (typeof window === "undefined" || SESSION_PROBES.some((probe) => path.startsWith(probe))) return;
  window.dispatchEvent(new CustomEvent("auth:invalidate", { detail: { status } }));
}

/**
 * Cookie-based JSON client. `credentials: include` sends the HttpOnly session
 * cookie; no token is ever read or stored by JavaScript.
 */
async function request(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      signal,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = payload?.error?.code;
    if (response.status === 401 || (response.status === 403 && code === "role_forbidden")) {
      notifySessionChanged(path, response.status);
    }
    // A temporary password may only be used to set a real one.
    if (response.status === 403 && code === "password_change_required" && typeof window !== "undefined") {
      if (window.location.pathname !== "/change-password") window.location.assign("/change-password");
    }
    const message =
      payload?.error?.message ||
      (response.status === 401
        ? "Your session has expired. Please sign in again."
        : "The request could not be completed.");
    throw new ApiError(response.status, message, payload?.error?.details, code);
  }

  return payload;
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
  del: (path, options) => request(path, { ...options, method: "DELETE" })
};
