import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export function requestLogger(req, res, next) {
  req.id = req.get("x-request-id") || randomUUID();
  res.setHeader("x-request-id", req.id);

  if (req.path === "/api/health") return next();

  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info("request", {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      userId: req.user?.id ?? null,
      ip: req.ip
    });
  });

  next();
}
