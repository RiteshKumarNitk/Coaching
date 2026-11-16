import { Router } from "express";
import { z } from "zod";
import {
  PERMISSIONS,
  ROLES,
  assignmentSubmitSchema,
  attendanceSaveSchema,
  examAnswerSaveSchema,
  examCreateSchema,
  examQuestionSchema,
  examQuestionUpdateSchema,
  examUpdateSchema,
  lessonProgressSchema,
  paginationSchema,
  responseEvaluationSchema,
  submissionEvaluationSchema,
  teacherAssignmentSchema,
  teacherAssignmentUpdateSchema,
  teacherLessonSchema,
  teacherLessonUpdateSchema,
  teacherAnnouncementSchema,
  teacherMaterialSchema,
  teacherMaterialUpdateSchema
} from "@coaching/shared";
import { asyncHandler } from "../utils/AppError.js";
import { validate } from "../middleware/validate.js";

const idParams = z.object({ id: z.string().uuid() });
const attendanceQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export function createTeacherRouter({
  authMiddleware,
  dashboardController,
  teacherController,
  examsController,
  announcementsController
}) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(ROLES.TEACHER, ROLES.ADMIN, ROLES.SUPER_ADMIN));

  const { requirePermission } = authMiddleware;
  const read = requirePermission(PERMISSIONS.STUDENTS_READ);
  const writeContent = requirePermission(PERMISSIONS.CONTENT_WRITE);
  const writeAttendance = requirePermission(PERMISSIONS.ATTENDANCE_WRITE);
  const writeAnnouncements = requirePermission(PERMISSIONS.ANNOUNCEMENTS_WRITE);

  router.get("/dashboard", asyncHandler(dashboardController.teacher));

  /* batches scoped to the signed-in teacher */
  router.get("/batches", read, asyncHandler(teacherController.listBatches));
  router.get("/batches/:id", read, validate({ params: idParams }), asyncHandler(teacherController.getBatch));

  /* attendance */
  router.get(
    "/batches/:id/attendance",
    read,
    validate({ params: idParams, query: attendanceQuery }),
    asyncHandler(teacherController.attendance)
  );
  router.post(
    "/batches/:id/attendance",
    writeAttendance,
    validate({ params: idParams, body: attendanceSaveSchema }),
    asyncHandler(teacherController.saveAttendance)
  );

  /* lectures */
  router.get(
    "/batches/:id/lessons",
    read,
    validate({ params: idParams, query: paginationSchema.extend({ subjectId: z.string().uuid().optional() }) }),
    asyncHandler(teacherController.listLessons)
  );
  router.post(
    "/batches/:id/lessons",
    writeContent,
    validate({ params: idParams, body: teacherLessonSchema }),
    asyncHandler(teacherController.createLesson)
  );
  router.patch(
    "/lessons/:id",
    writeContent,
    validate({ params: idParams, body: teacherLessonUpdateSchema }),
    asyncHandler(teacherController.updateLesson)
  );
  router.delete("/lessons/:id", writeContent, validate({ params: idParams }), asyncHandler(teacherController.deleteLesson));

  /* study material */
  router.get(
    "/batches/:id/materials",
    read,
    validate({ params: idParams, query: paginationSchema }),
    asyncHandler(teacherController.listMaterials)
  );
  router.post(
    "/batches/:id/materials",
    writeContent,
    validate({ params: idParams, body: teacherMaterialSchema }),
    asyncHandler(teacherController.createMaterial)
  );
  router.patch(
    "/materials/:id",
    writeContent,
    validate({ params: idParams, body: teacherMaterialUpdateSchema }),
    asyncHandler(teacherController.updateMaterial)
  );
  router.delete(
    "/materials/:id",
    writeContent,
    validate({ params: idParams }),
    asyncHandler(teacherController.deleteMaterial)
  );

  /* assignments + evaluation */
  router.get(
    "/batches/:id/assignments",
    read,
    validate({ params: idParams, query: paginationSchema }),
    asyncHandler(teacherController.listAssignments)
  );
  router.post(
    "/batches/:id/assignments",
    writeContent,
    validate({ params: idParams, body: teacherAssignmentSchema }),
    asyncHandler(teacherController.createAssignment)
  );
  router.get("/assignments/:id", read, validate({ params: idParams }), asyncHandler(teacherController.getAssignment));
  router.patch(
    "/assignments/:id",
    writeContent,
    validate({ params: idParams, body: teacherAssignmentUpdateSchema }),
    asyncHandler(teacherController.updateAssignment)
  );
  router.delete(
    "/assignments/:id",
    writeContent,
    validate({ params: idParams }),
    asyncHandler(teacherController.deleteAssignment)
  );
  router.patch(
    "/submissions/:id",
    writeContent,
    validate({ params: idParams, body: submissionEvaluationSchema }),
    asyncHandler(teacherController.evaluateSubmission)
  );

  /* exams for assigned batches */
  const manageExams = requirePermission(PERMISSIONS.EXAMS_MANAGE);
  const evaluateExams = requirePermission(PERMISSIONS.EXAMS_EVALUATE);

  router.get(
    "/exams",
    read,
    validate({
      query: paginationSchema.extend({
        batchId: z.string().uuid().optional(),
        status: z.enum(["draft", "scheduled", "published", "closed"]).optional(),
        search: z.string().trim().max(120).optional()
      })
    }),
    asyncHandler(examsController.list)
  );
  router.get("/exams/:id", read, validate({ params: idParams }), asyncHandler(examsController.get));
  router.post("/exams", manageExams, validate({ body: examCreateSchema }), asyncHandler(examsController.create));
  router.patch(
    "/exams/:id",
    manageExams,
    validate({ params: idParams, body: examUpdateSchema }),
    asyncHandler(examsController.update)
  );
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
    evaluateExams,
    validate({ params: idParams }),
    asyncHandler(examsController.attemptResponses)
  );
  router.patch(
    "/responses/:id",
    evaluateExams,
    validate({ params: idParams, body: responseEvaluationSchema }),
    asyncHandler(examsController.evaluateResponse)
  );
  router.post(
    "/exams/:id/publish-results",
    manageExams,
    validate({ params: idParams }),
    asyncHandler(examsController.publishResults)
  );

  /* notices to the teacher's own batches */
  router.get(
    "/announcements",
    read,
    validate({ query: paginationSchema }),
    asyncHandler(announcementsController.teacherList)
  );
  router.post(
    "/announcements",
    writeAnnouncements,
    validate({ body: teacherAnnouncementSchema }),
    asyncHandler(announcementsController.teacherCreate)
  );

  return router;
}

const studentAttendanceQuery = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  status: z.enum(["present", "absent", "late"]).optional()
});

const studentContentQuery = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional()
});

export function createStudentRouter({ authMiddleware, dashboardController, studentController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(ROLES.STUDENT));

  router.get("/dashboard", asyncHandler(dashboardController.student));

  /* courses + batch workspace */
  router.get("/courses", asyncHandler(studentController.courses));
  router.get("/batches/:id", validate({ params: idParams }), asyncHandler(studentController.batch));

  /* lectures + progress */
  router.get("/lessons", validate({ query: studentContentQuery }), asyncHandler(studentController.lessons));
  router.get("/lessons/:id", validate({ params: idParams }), asyncHandler(studentController.lesson));
  router.post(
    "/lessons/:id/progress",
    validate({ params: idParams, body: lessonProgressSchema }),
    asyncHandler(studentController.saveProgress)
  );

  /* study material */
  router.get("/materials", validate({ query: studentContentQuery }), asyncHandler(studentController.materials));

  /* assignments + submissions */
  router.get(
    "/assignments",
    validate({ query: paginationSchema.extend({ batchId: z.string().uuid().optional() }) }),
    asyncHandler(studentController.assignments)
  );
  router.get("/assignments/:id", validate({ params: idParams }), asyncHandler(studentController.assignment));
  router.post(
    "/assignments/:id/submissions",
    validate({ params: idParams, body: assignmentSubmitSchema }),
    asyncHandler(studentController.submitAssignment)
  );

  /* attendance history + notice board */
  router.get("/attendance", validate({ query: studentAttendanceQuery }), asyncHandler(studentController.attendance));
  router.get(
    "/announcements",
    validate({ query: paginationSchema }),
    asyncHandler(studentController.announcements)
  );

  /* exams, attempts and results */
  router.get("/exams", validate({ query: paginationSchema }), asyncHandler(studentController.exams));
  router.post("/exams/:id/attempts", validate({ params: idParams }), asyncHandler(studentController.startAttempt));
  router.get("/attempts/:id", validate({ params: idParams }), asyncHandler(studentController.attempt));
  router.patch(
    "/attempts/:id/answers",
    validate({ params: idParams, body: examAnswerSaveSchema }),
    asyncHandler(studentController.saveAnswers)
  );
  router.post("/attempts/:id/submit", validate({ params: idParams }), asyncHandler(studentController.submitAttempt));
  router.get("/results", validate({ query: paginationSchema }), asyncHandler(studentController.results));

  /* fees */
  router.get("/fees", asyncHandler(studentController.fees));

  return router;
}

export function createProfileRouter({ authMiddleware, profileController, notificationsController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth);
  router.get("/", asyncHandler(profileController.me));

  /* notifications for every signed-in role */
  router.get("/notifications/unread-count", asyncHandler(notificationsController.unreadCount));
  router.get("/notifications", validate({ query: paginationSchema }), asyncHandler(notificationsController.list));
  router.post("/notifications/read-all", asyncHandler(notificationsController.markAllRead));
  router.post(
    "/notifications/:id/read",
    validate({ params: idParams }),
    asyncHandler(notificationsController.markRead)
  );

  return router;
}
