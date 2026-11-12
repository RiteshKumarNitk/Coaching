import { tooManyRequests } from "../utils/AppError.js";

/**
 * Small in-memory fixed-window limiter.
 *
 * Limitation documented in docs/DEPLOYMENT.md: the counter is per process, so
 * with multiple API instances the effective limit is multiplied by the number
 * of instances. It still blocks credential stuffing / brute force on a single
 * instance, which is the Phase 1 deployment shape.
 */
export function createRateLimiter({ windowMs = 60_000, max = 300, keyFn, message } = {}) {
  const hits = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  cleanup.unref?.();

  return function rateLimiter(req, _res, next) {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return next(tooManyRequests(message));
    }
    return next();
  };
}

export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `login:${req.ip}`,
  message: "Too many sign-in attempts. Please wait 15 minutes and try again."
});

export const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 600,
  message: "Too many requests. Please slow down."
});
