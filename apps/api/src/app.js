import fs from "node:fs";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { cors, securityHeaders, verifyOrigin } from "./middleware/security.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { apiNotFound, errorHandler } from "./middleware/errorHandler.js";
import { asyncHandler } from "./utils/AppError.js";
import { createAuditService } from "./services/audit.service.js";
import { createAuthService } from "./services/auth.service.js";
import { createDashboardService } from "./services/dashboard.service.js";
import { createStudentsService } from "./services/admin/students.service.js";
import { createTeachersService } from "./services/admin/teachers.service.js";
import { createAcademicsService } from "./services/admin/academics.service.js";
import { createTeacherService } from "./services/teacher.service.js";
import { createStudentService } from "./services/student.service.js";
import { createExamsService } from "./services/exams.service.js";
import { createFeesService } from "./services/fees.service.js";
import { createNotificationsService } from "./services/notifications.service.js";
import { createAnnouncementsService } from "./services/announcements.service.js";
import { createAdminOperationsService } from "./services/admin/operations.service.js";
import { createReportsService } from "./services/admin/reports.service.js";
import { createGuardianService } from "./services/guardian.service.js";
import { createAuthController } from "./controllers/auth.controller.js";
import { createDashboardController, createProfileController } from "./controllers/dashboard.controller.js";
import { createAdminController } from "./controllers/admin.controller.js";
import { createTeacherController } from "./controllers/teacher.controller.js";
import { createStudentController } from "./controllers/student.controller.js";
import { createExamsController, createFeesController } from "./controllers/exams.controller.js";
import {
  createAnnouncementsController,
  createNotificationsController
} from "./controllers/announcements.controller.js";
import { createAdminOpsController } from "./controllers/adminOps.controller.js";
import { createGuardianController } from "./controllers/guardian.controller.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import {
  createProfileRouter,
  createStudentRouter,
  createTeacherRouter
} from "./routes/role.routes.js";
import { createGuardianRouter } from "./routes/guardian.routes.js";

// Loaded lazily so tests can build the app without a database module side effect.
export function createApp(db) {
  const audit = createAuditService(db);
  const auth = createAuthService(db, audit);
  const dashboards = createDashboardService(db);
  const students = createStudentsService(db, audit);
  const teachers = createTeachersService(db, audit);
  const academics = createAcademicsService(db, audit);
  const teacherWorkspace = createTeacherService(db, audit);
  const studentWorkspace = createStudentService(db, audit);
  const notificationsWorkspace = createNotificationsService(db);
  const examsWorkspace = createExamsService(db, audit, notificationsWorkspace);
  const feesWorkspace = createFeesService(db, audit, notificationsWorkspace);
  const announcementsWorkspace = createAnnouncementsService(db, audit, notificationsWorkspace);
  const operationsWorkspace = createAdminOperationsService(db, audit);
  const reportsWorkspace = createReportsService(db);
  const guardianWorkspace = createGuardianService(db, studentWorkspace, feesWorkspace);

  const authMiddleware = createAuthMiddleware({ auth });
  const authController = createAuthController({ auth });
  const dashboardController = createDashboardController({ dashboards });
  const profileController = createProfileController({ auth });
  const adminController = createAdminController({ dashboards, students, teachers, academics });
  const teacherController = createTeacherController({ teacher: teacherWorkspace });
  const examsController = createExamsController({ exams: examsWorkspace });
  const feesController = createFeesController({ fees: feesWorkspace });
  const studentController = createStudentController({ student: studentWorkspace, fees: feesWorkspace });
  const announcementsController = createAnnouncementsController({ announcements: announcementsWorkspace });
  const notificationsController = createNotificationsController({ notifications: notificationsWorkspace });
  const adminOpsController = createAdminOpsController({ operations: operationsWorkspace, reports: reportsWorkspace });
  const guardianController = createGuardianController({ guardian: guardianWorkspace });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.trustProxy ? 1 : false);

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(cors);
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(cookieParser());
  app.use(verifyOrigin);
  app.use(authMiddleware.authenticate);

  app.get(
    "/api/health",
    asyncHandler(async (_req, res) => {
      try {
        await db.one("SELECT 1 AS ok");
        res.json({ status: "ok", uptime: Math.round(process.uptime()) });
      } catch {
        res.status(503).json({ status: "degraded", database: "unreachable" });
      }
    })
  );

  app.use("/api", apiLimiter);
  app.use("/api/auth", createAuthRouter({ authMiddleware, authController }));
  app.use("/api/me", createProfileRouter({ authMiddleware, profileController, notificationsController }));
  app.use(
    "/api/admin",
    createAdminRouter({
      authMiddleware,
      adminController,
      examsController,
      feesController,
      announcementsController,
      adminOpsController
    })
  );
  app.use(
    "/api/teacher",
    createTeacherRouter({
      authMiddleware,
      dashboardController,
      teacherController,
      examsController,
      announcementsController
    })
  );
  app.use("/api/student", createStudentRouter({ authMiddleware, dashboardController, studentController }));
  app.use("/api/guardian", createGuardianRouter({ authMiddleware, guardianController }));
  app.use("/api", apiNotFound);

  // Serve the built single-page app when it exists (single-origin deployment).
  if (fs.existsSync(env.webDist)) {
    app.use(
      express.static(env.webDist, {
        index: false,
        maxAge: "1y",
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (base.endsWith(".html") || base === "sw.js" || base === "manifest.webmanifest") {
            res.setHeader("Cache-Control", "no-cache");
          }
        }
      })
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(env.webDist, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
