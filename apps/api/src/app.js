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
import { createAuthController } from "./controllers/auth.controller.js";
import { createDashboardController, createProfileController } from "./controllers/dashboard.controller.js";
import { createAdminController } from "./controllers/admin.controller.js";
import { createTeacherController } from "./controllers/teacher.controller.js";
import { createStudentController } from "./controllers/student.controller.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import {
  createProfileRouter,
  createStudentRouter,
  createTeacherRouter
} from "./routes/role.routes.js";

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

  const authMiddleware = createAuthMiddleware({ auth });
  const authController = createAuthController({ auth });
  const dashboardController = createDashboardController({ dashboards });
  const profileController = createProfileController({ auth });
  const adminController = createAdminController({ dashboards, students, teachers, academics });
  const teacherController = createTeacherController({ teacher: teacherWorkspace });
  const studentController = createStudentController({ student: studentWorkspace });

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
  app.use("/api/me", createProfileRouter({ authMiddleware, profileController }));
  app.use("/api/admin", createAdminRouter({ authMiddleware, adminController }));
  app.use("/api/teacher", createTeacherRouter({ authMiddleware, dashboardController, teacherController }));
  app.use("/api/student", createStudentRouter({ authMiddleware, dashboardController, studentController }));
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
