import { Router } from "express";
import { ADMIN_ROLES, ROLES } from "@coaching/shared";
import { asyncHandler } from "../utils/AppError.js";

export function createAdminRouter({ authMiddleware, dashboardController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(...ADMIN_ROLES));
  router.get("/dashboard", asyncHandler(dashboardController.admin));
  return router;
}

export function createTeacherRouter({ authMiddleware, dashboardController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(ROLES.TEACHER, ROLES.ADMIN, ROLES.SUPER_ADMIN));
  router.get("/dashboard", asyncHandler(dashboardController.teacher));
  return router;
}

export function createStudentRouter({ authMiddleware, dashboardController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(ROLES.STUDENT));
  router.get("/dashboard", asyncHandler(dashboardController.student));
  return router;
}

export function createProfileRouter({ authMiddleware, profileController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth);
  router.get("/", asyncHandler(profileController.me));
  return router;
}
