import { AppError, notFound, unauthorized } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

export function apiNotFound(req, _res, next) {
  next(notFound(`Unknown API route: ${req.method} ${req.originalUrl.split("?")[0]}`));
}

export function errorHandler(error, req, res, _next) {
  let status = 500;
  let message = "Something went wrong on the server";
  let code = "internal_error";
  let details;

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.expose ? error.message : message;
    details = error.details;
  } else if (error?.type === "entity.parse.failed") {
    status = 400;
    code = "invalid_json";
    message = "Request body is not valid JSON";
  } else if (error?.code === "23505") {
    status = 409;
    code = "duplicate";
    message = "A record with these unique details already exists";
  } else if (error?.code === "23503") {
    status = 409;
    code = "foreign_key";
    message = "This operation references a record that does not exist or is still in use";
  } else if (error?.code === "22P02" || error?.code === "22001") {
    status = 400;
    code = "invalid_input";
    message = "One of the submitted values has an invalid format";
  } else if (error?.code === "23514") {
    status = 400;
    code = "constraint_violation";
    message = "One of the submitted values breaks a data rule";
  }

  if (status >= 500) {
    logger.error("unhandled request error", {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      error
    });
  } else if (status === 401) {
    code = error?.code || "unauthorized";
    message = error?.message || unauthorized().message;
  }

  if (res.headersSent) return;

  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}), requestId: req.id }
  });
}
