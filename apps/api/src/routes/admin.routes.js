import { Router } from "express";
import { z } from "zod";
import {
  ADMIN_ROLES,
  PERMISSIONS,
  adminStudentCreateSchema,
  adminStudentUpdateSchema,
  adminUserSchema,
  adminUserUpdateSchema,
  adminTeacherCreateSchema,
  adminTeacherUpdateSchema,
  announcementSchema,
  announcementUpdateSchema,
  assignEnrollmentSchema,
  assignTeacherSchema,
  batchScheduleSchema,
  batchSubjectSchema,
  batchTeacherSchema,
  batchUpdateSchema,
  courseSubjectsSchema,
  courseUpdateSchema,
  createBatchSchema,
  createCourseSchema,
  createSubjectSchema,
  examCreateSchema,
  examQuestionSchema,
  examQuestionUpdateSchema,
  examUpdateSchema,
  feeAssignSchema,
  feeCorrectionSchema,
  guardianAccessSchema,
  feePaymentSchema,
  feeUpdateSchema,
  feeStructureSchema,
  feeStructureUpdateSchema,
  paginationSchema,
  resetPasswordSchema,
  responseEvaluationSchema,
  settingsSchema,
  statusChangeSchema,
  subjectUpdateSchema
} from "@coaching/shared";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/AppError.js";

const listQuerySchema = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional()
});

const examListQuery = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  status: z.enum(["draft", "scheduled", "published", "closed"]).optional(),
  search: z.string().trim().max(120).optional()
});

const feeListQuery = paginationSchema.extend({
  status: z.enum(["pending", "partial", "paid", "waived"]).optional(),
  batchId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional()
});

export function createAdminRouter({
  authMiddleware,
  adminController,
  examsController,
  feesController,
  announcementsController,
  adminOpsController
}) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(...ADMIN_ROLES));

  const { requirePermission } = authMiddleware;
  const readStudents = requirePermission(PERMISSIONS.STUDENTS_READ);
  const writeStudents = requirePermission(PERMISSIONS.STUDENTS_WRITE);
  const readTeachers = requirePermission(PERMISSIONS.TEACHERS_READ);
  const writeTeachers = requirePermission(PERMISSIONS.TEACHERS_WRITE);
  const manageAcademics = requirePermission(PERMISSIONS.COURSES_MANAGE);
  const manageExams = requirePermission(PERMISSIONS.EXAMS_MANAGE);
  const readFees = requirePermission(PERMISSIONS.FEES_READ);
  const writeFees = requirePermission(PERMISSIONS.FEES_WRITE);
  const manageAnnouncements = requirePermission(PERMISSIONS.ANNOUNCEMENTS_WRITE);
  const manageAdmins = requirePermission(PERMISSIONS.ADMINS_MANAGE);
  const manageSettings = requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const readAudit = requirePermission(PERMISSIONS.AUDIT_READ);

  const idParams = z.object({ id: z.string().uuid() });
  const idAndEnrollment = z.object({ id: z.string().uuid(), enrollmentId: z.string().uuid() });
  const idAndBatch = z.object({ id: z.string().uuid(), batchId: z.string().uuid() });
  const idAndSubject = z.object({ id: z.string().uuid(), subjectId: z.string().uuid() });
  const idAndTeacher = z.object({ id: z.string().uuid(), teacherId: z.string().uuid() });
  const idAndSchedule = z.object({ id: z.string().uuid(), scheduleId: z.string().uuid() });

  router.get("/dashboard", asyncHandler(adminController.dashboard));

  /* students */
  router.get("/students/export", readStudents, asyncHandler(adminController.exportStudents));
  router.post(
    "/students/import",
    writeStudents,
    validate({ body: z.object({ csv: z.string().min(1) }) }),
    asyncHandler(adminController.importStudents)
  );
  router.get("/students", readStudents, validate({ query: listQuerySchema }), asyncHandler(adminController.listStudents));
  router.post("/students", writeStudents, validate({ body: adminStudentCreateSchema }), asyncHandler(adminController.createStudent));
  router.get("/students/:id", readStudents, validate({ params: idParams }), asyncHandler(adminController.getStudent));
  router.patch(
    "/students/:id",
    writeStudents,
    validate({ params: idParams, body: adminStudentUpdateSchema }),
    asyncHandler(adminController.updateStudent)
  );
  router.post(
    "/students/:id/status",
    writeStudents,
    validate({ params: idParams, body: statusChangeSchema }),
    asyncHandler(adminController.changeStudentStatus)
  );
  router.post(
    "/students/:id/enrollment",
    writeStudents,
    validate({ params: idParams, body: assignEnrollmentSchema }),
    asyncHandler(adminController.enrollStudent)
  );
  router.delete(
    "/students/:id/enrollment/:enrollmentId",
    writeStudents,
    validate({ params: idAndEnrollment }),
    asyncHandler(adminController.unenrollStudent)
  );
  router.post(
    "/students/:id/reset-password",
    writeStudents,
    validate({ params: idParams, body: resetPasswordSchema }),
    asyncHandler(adminController.resetStudentPassword)
  );
  router.post(
    "/students/:id/guardian-access",
    writeStudents,
    validate({ params: idParams, body: guardianAccessSchema }),
    asyncHandler(adminController.grantGuardianAccess)
  );

  /* teachers */
  router.get("/teachers", readTeachers, validate({ query: listQuerySchema }), asyncHandler(adminController.listTeachers));
  router.post("/teachers", writeTeachers, validate({ body: adminTeacherCreateSchema }), asyncHandler(adminController.createTeacher));
  router.get("/teachers/:id", readTeachers, validate({ params: idParams }), asyncHandler(adminController.getTeacher));
  router.patch(
    "/teachers/:id",
    writeTeachers,
    validate({ params: idParams, body: adminTeacherUpdateSchema }),
    asyncHandler(adminController.updateTeacher)
  );
  router.post(
    "/teachers/:id/status",
    writeTeachers,
    validate({ params: idParams, body: statusChangeSchema }),
    asyncHandler(adminController.changeTeacherStatus)
  );
  router.post(
    "/teachers/:id/batches",
    writeTeachers,
    validate({ params: idParams, body: assignTeacherSchema }),
    asyncHandler(adminController.assignTeacherBatch)
  );
  router.delete(
    "/teachers/:id/batches/:batchId",
    writeTeachers,
    validate({ params: idAndBatch }),
    asyncHandler(adminController.unassignTeacherBatch)
  );
  router.post(
    "/teachers/:id/reset-password",
    writeTeachers,
    validate({ params: idParams, body: resetPasswordSchema }),
    asyncHandler(adminController.resetTeacherPassword)
  );

  /* courses + subjects */
  router.get("/courses", manageAcademics, validate({ query: listQuerySchema }), asyncHandler(adminController.listCourses));
  router.post("/courses", manageAcademics, validate({ body: createCourseSchema }), asyncHandler(adminController.createCourse));
  router.get("/courses/:id", manageAcademics, validate({ params: idParams }), asyncHandler(adminController.getCourse));
  router.patch(
    "/courses/:id",
    manageAcademics,
    validate({ params: idParams, body: courseUpdateSchema }),
    asyncHandler(adminController.updateCourse)
  );
  router.put(
    "/courses/:id/subjects",
    manageAcademics,
    validate({ params: idParams, body: courseSubjectsSchema }),
    asyncHandler(adminController.setCourseSubjects)
  );

  router.get(
    "/subjects",
    manageAcademics,
    validate({ query: listQuerySchema }),
    asyncHandler(adminController.listSubjects)
  );
  router.post("/subjects", manageAcademics, validate({ body: createSubjectSchema }), asyncHandler(adminController.createSubject));
  router.patch(
    "/subjects/:id",
    manageAcademics,
    validate({ params: idParams, body: subjectUpdateSchema }),
    asyncHandler(adminController.updateSubject)
  );

  /* batches */
  router.get("/batches", manageAcademics, validate({ query: listQuerySchema }), asyncHandler(adminController.listBatches));
  router.post("/batches", manageAcademics, validate({ body: createBatchSchema }), asyncHandler(adminController.createBatch));
  router.get("/batches/:id", manageAcademics, validate({ params: idParams }), asyncHandler(adminController.getBatch));
  router.patch(
    "/batches/:id",
    manageAcademics,
    validate({ params: idParams, body: batchUpdateSchema }),
    asyncHandler(adminController.updateBatch)
  );
  router.post(
    "/batches/:id/subjects",
    manageAcademics,
    validate({ params: idParams, body: batchSubjectSchema }),
    asyncHandler(adminController.addBatchSubject)
  );
  router.delete(
    "/batches/:id/subjects/:subjectId",
    manageAcademics,
    validate({ params: idAndSubject }),
    asyncHandler(adminController.removeBatchSubject)
  );
  router.post(
    "/batches/:id/teachers",
    manageAcademics,
    validate({ params: idParams, body: batchTeacherSchema }),
    asyncHandler(adminController.assignBatchTeacher)
  );
  router.delete(
    "/batches/:id/teachers/:teacherId",
    manageAcademics,
    validate({ params: idAndTeacher }),
    asyncHandler(adminController.removeBatchTeacher)
  );
  router.post(
    "/batches/:id/schedule",
    manageAcademics,
    validate({ params: idParams, body: batchScheduleSchema }),
    asyncHandler(adminController.addSchedule)
  );
  router.delete(
    "/batches/:id/schedule/:scheduleId",
    manageAcademics,
    validate({ params: idAndSchedule }),
    asyncHandler(adminController.removeSchedule)
  );

  /* exams + question bank */
  router.get("/exams", manageExams, validate({ query: examListQuery }), asyncHandler(examsController.list));
  router.post("/exams", manageExams, validate({ body: examCreateSchema }), asyncHandler(examsController.create));
  router.get("/exams/:id", manageExams, validate({ params: idParams }), asyncHandler(examsController.get));
  router.patch(
    "/exams/:id",
    manageExams,
    validate({ params: idParams, body: examUpdateSchema }),
    asyncHandler(examsController.update)
  );
  router.delete("/exams/:id", manageExams, validate({ params: idParams }), asyncHandler(examsController.remove));
  router.post(
    "/exams/:id/questions",
    manageExams,
    validate({ params: idParams, body: examQuestionSchema }),
    asyncHandler(examsController.addQuestion)
  );
  router.patch(
    "/questions/:id",
    manageExams,
    validate({ params: idParams, body: examQuestionUpdateSchema }),
    asyncHandler(examsController.updateQuestion)
  );
  router.delete("/questions/:id", manageExams, validate({ params: idParams }), asyncHandler(examsController.deleteQuestion));
  router.get(
    "/attempts/:id/responses",
    manageExams,
    validate({ params: idParams }),
    asyncHandler(examsController.attemptResponses)
  );
  router.patch(
    "/responses/:id",
    manageExams,
    validate({ params: idParams, body: responseEvaluationSchema }),
    asyncHandler(examsController.evaluateResponse)
  );
  router.post(
    "/exams/:id/publish-results",
    manageExams,
    validate({ params: idParams }),
    asyncHandler(examsController.publishResults)
  );

  /* fees */
  router.get("/fees/structures", readFees, validate({ query: feeListQuery }), asyncHandler(feesController.structures));
  router.post(
    "/fees/structures",
    writeFees,
    validate({ body: feeStructureSchema }),
    asyncHandler(feesController.createStructure)
  );
  router.patch(
    "/fees/structures/:id",
    writeFees,
    validate({ params: idParams, body: feeStructureUpdateSchema }),
    asyncHandler(feesController.updateStructure)
  );
  router.get("/fees/dues", readFees, validate({ query: feeListQuery }), asyncHandler(feesController.dues));
  router.post("/fees/assign", writeFees, validate({ body: feeAssignSchema }), asyncHandler(feesController.assign));
  router.post(
    "/fees/:id/payments",
    writeFees,
    validate({ params: idParams, body: feePaymentSchema }),
    asyncHandler(feesController.recordPayment)
  );
  router.get("/fees/payments", readFees, validate({ query: feeListQuery }), asyncHandler(feesController.payments));
  router.get(
    "/fees/payments/:id/receipt",
    readFees,
    validate({ params: idParams }),
    asyncHandler(feesController.receipt)
  );
  router.post(
    "/fees/payments/:id/void",
    writeFees,
    validate({ params: idParams, body: feeCorrectionSchema }),
    asyncHandler(feesController.voidPayment)
  );
  router.get(
    "/fees/reminders",
    readFees,
    validate({ query: paginationSchema.extend({ batchId: z.string().uuid().optional() }) }),
    asyncHandler(feesController.reminders)
  );
  router.post(
    "/fees/:id/waive",
    writeFees,
    validate({ params: idParams, body: feeCorrectionSchema }),
    asyncHandler(feesController.waive)
  );
  router.patch(
    "/fees/:id",
    writeFees,
    validate({ params: idParams, body: feeUpdateSchema }),
    asyncHandler(feesController.updateFee)
  );

  /* announcements */
  router.get(
    "/announcements",
    manageAnnouncements,
    validate({ query: paginationSchema.extend({ audience: z.enum(["all", "role", "course", "batch"]).optional() }) }),
    asyncHandler(announcementsController.list)
  );
  router.post(
    "/announcements",
    manageAnnouncements,
    validate({ body: announcementSchema }),
    asyncHandler(announcementsController.create)
  );
  router.patch(
    "/announcements/:id",
    manageAnnouncements,
    validate({ params: idParams, body: announcementUpdateSchema }),
    asyncHandler(announcementsController.update)
  );
  router.delete(
    "/announcements/:id",
    manageAnnouncements,
    validate({ params: idParams }),
    asyncHandler(announcementsController.remove)
  );

  /* staff accounts (super_admin) */
  router.get("/admins", manageAdmins, validate({ query: listQuerySchema }), asyncHandler(adminOpsController.listAdmins));
  router.post("/admins", manageAdmins, validate({ body: adminUserSchema }), asyncHandler(adminOpsController.createAdmin));
  router.patch(
    "/admins/:id",
    manageAdmins,
    validate({ params: idParams, body: adminUserUpdateSchema }),
    asyncHandler(adminOpsController.updateAdmin)
  );
  router.post(
    "/admins/:id/password",
    manageAdmins,
    validate({ params: idParams, body: resetPasswordSchema }),
    asyncHandler(adminOpsController.resetAdminPassword)
  );

  /* institute settings (super_admin) */
  router.get("/settings", manageSettings, asyncHandler(adminOpsController.getSettings));
  router.patch(
    "/settings",
    manageSettings,
    validate({ body: settingsSchema }),
    asyncHandler(adminOpsController.updateSettings)
  );

  /* audit trail (super_admin) */
  router.get(
    "/audit-logs",
    readAudit,
    validate({
      query: paginationSchema.extend({
        action: z.string().trim().max(80).optional(),
        entityType: z.string().trim().max(60).optional()
      })
    }),
    asyncHandler(adminOpsController.audit)
  );

  /* reports */
  router.get("/reports/overview", readFees, asyncHandler(adminOpsController.overview));
  router.get("/reports/fees.csv", readFees, asyncHandler(adminOpsController.feesCsv));
  router.get(
    "/reports/attendance.csv",
    readFees,
    validate({
      query: z.object({
        from: z.string().trim().max(10).optional(),
        to: z.string().trim().max(10).optional()
      })
    }),
    asyncHandler(adminOpsController.attendanceCsv)
  );

  return router;
}
