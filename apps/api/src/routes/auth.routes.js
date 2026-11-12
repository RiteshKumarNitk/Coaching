import { Router } from "express";
import { changePasswordSchema, loginSchema } from "@coaching/shared";
import { validate } from "../middleware/validate.js";
import { loginLimiter } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/AppError.js";

export function createAuthRouter({ authMiddleware, authController }) {
  const router = Router();

  // Express 4 does not catch rejected promises: every async handler is wrapped.
  router.post("/login", loginLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));
  router.post("/logout", asyncHandler(authController.logout));
  router.get("/me", authMiddleware.requireAuth, asyncHandler(authController.me));
  router.post(
    "/change-password",
    authMiddleware.requireAuth,
    validate({ body: changePasswordSchema }),
    asyncHandler(authController.changePassword)
  );

  return router;
}
