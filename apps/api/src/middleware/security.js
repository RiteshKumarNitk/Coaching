import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** Origins allowed to call the API with credentials. */
export function allowedOrigins(req) {
  const list = new Set(DEV_ORIGINS);
  if (env.appOrigin) list.add(env.appOrigin);
  if (req?.get("host")) list.add(`${req.protocol}://${req.get("host")}`);
  return list;
}

export function cors(req, res, next) {
  const origin = req.get("origin");
  if (origin && allowedOrigins(req).has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, X-Request-Id");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https://i.ytimg.com",
      "media-src 'self' https://www.youtube.com",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      `connect-src 'self'${env.appOrigin ? ` ${env.appOrigin}` : ""}`
    ].join("; ")
  );
  if (env.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

/**
 * CSRF defence for cookie-authenticated mutations: SameSite=Lax cookies plus a
 * strict Origin/Referer check. Requests with no Origin header (server scripts,
 * health checks) are allowed because browsers always attach Origin on
 * cross-site state-changing fetches.
 */
export function verifyOrigin(req, _res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (!req.path.startsWith("/api")) return next();

  const origin = req.get("origin");
  const referer = req.get("referer");
  const candidates = allowedOrigins(req);

  if (origin) {
    if (!candidates.has(origin)) {
      return next(new AppError(403, "Request origin is not allowed", { code: "csrf_origin_mismatch" }));
    }
    return next();
  }

  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!candidates.has(refOrigin)) {
        return next(new AppError(403, "Request origin is not allowed", { code: "csrf_origin_mismatch" }));
      }
    } catch {
      return next(new AppError(403, "Invalid referer", { code: "csrf_origin_mismatch" }));
    }
  }

  next();
}
