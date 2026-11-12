import { Router } from "express";
import { z } from "zod";
import {
  ADMIN_ROLES,
  PERMISSIONS,
  adminStudentCreateSchema,
  adminStudentUpdateSchema,
  adminTeacherCreateSchema,
  adminTeacherUpdateSchema,
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
  paginationSchema,
  resetPasswordSchema,
  statusChangeSchema,
  subjectUpdateSchema
} from "@coaching/shared";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../utils/AppError.js";

const listQuerySchema = paginationSchema.extend({
  batchId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional()
});

export function createAdminRouter({ authMiddleware, adminController }) {
  const router = Router();
  router.use(authMiddleware.requireAuth, authMiddleware.requireRole(...ADMIN_ROLES));

  const { requirePermission } = authMiddleware;
  const readStudents = requirePermission(PERMISSIONS.STUDENTS_READ);
  const writeStudents = requirePermission(PERMISSIONS.STUDENTS_WRITE);
  const readTeachers = requirePermission(PERMISSIONS.TEACHERS_READ);
  const writeTeachers = requirePermission(PERMISSIONS.TEACHERS_WRITE);
  const manageAcademics = requirePermission(PERMISSIONS.COURSES_MANAGE);

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

  return router;
}
