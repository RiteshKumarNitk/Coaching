import { Router } from "express";
import { z } from "zod";
import { ROLES, paginationSchema } from "@coaching/shared";
import { asyncHandler } from "../utils/AppError.js";
import { validate } from "../middleware/validate.js";

const idParams = z.object({ id: z.string().uuid() });

const attendanceQuery = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  status: z.enum(["present", "absent", "late"]).optional()
});

/**
 * Read-only guardian API. Every route is limited to the guardian role and to the
 * students linked to that guardian in SQL; unknown/unlinked child ids answer 404.
 */
export function createGuardianRouter({ authMiddleware, guardianController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(ROLES.GUARDIAN));

  router.get("/children", asyncHandler(guardianController.children));
  router.get(
    "/children/:id/attendance",
    validate({ params: idParams, query: attendanceQuery }),
    asyncHandler(guardianController.attendance)
  );
  router.get("/children/:id/fees", validate({ params: idParams }), asyncHandler(guardianController.fees));
  router.get(
    "/children/:id/results",
    validate({ params: idParams, query: paginationSchema }),
    asyncHandler(guardianController.results)
  );

  return router;
}
