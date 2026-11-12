import { asyncHandler, forbidden, unauthorized } from "../utils/AppError.js";
import { readSessionToken } from "../utils/cookies.js";
import { rolesHavePermission } from "@coaching/shared";

/**
 * Session authentication + authorization. Roles always come from the database,
 * never from a request header or body.
 */
export function createAuthMiddleware({ auth }) {
  const authenticate = asyncHandler(async (req, _res, next) => {
    const token = readSessionToken(req);
    req.sessionToken = token;
    if (!token) return next();

    const session = await auth.resolveSession(token);
    if (session) {
      req.user = session.user;
      req.sessionTokenHash = session.tokenHash;
    }
    return next();
  });

  const requireAuth = (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    return next();
  };

  const requireRole =
    (...roles) =>
    (req, _res, next) => {
      if (!req.user) return next(unauthorized());
      const allowed = req.user.roles.some((role) => roles.includes(role));
      if (!allowed) return next(forbidden("Your role does not have access to this area"));
      return next();
    };

  const requirePermission = (permission) => (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!rolesHavePermission(req.user.roles, permission)) {
      return next(forbidden("You do not have permission to perform this action"));
    }
    return next();
  };

  return { authenticate, requireAuth, requireRole, requirePermission };
}
