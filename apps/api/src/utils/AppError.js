export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = options.code || "error";
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
  }
}

export const badRequest = (message, details) => new AppError(400, message, { code: "bad_request", details });
export const unauthorized = (message = "Authentication required") =>
  new AppError(401, message, { code: "unauthorized" });
export const forbidden = (message = "You do not have access to this resource", code = "forbidden") =>
  new AppError(403, message, { code });
export const notFound = (message = "Resource not found") => new AppError(404, message, { code: "not_found" });
export const conflict = (message) => new AppError(409, message, { code: "conflict" });
export const attemptExpired = (message = "Time is up for this attempt") =>
  new AppError(400, message, { code: "attempt_expired" });
export const tooManyRequests = (message = "Too many requests. Try again later.") =>
  new AppError(429, message, { code: "rate_limited" });

/** Wrap async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
