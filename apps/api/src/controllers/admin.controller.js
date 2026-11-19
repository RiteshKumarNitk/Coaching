import { csvImportSchema } from "@coaching/shared";

export function createAdminController({ dashboards, students, teachers, academics }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email });

  return {
    dashboard: async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await dashboards.admin());
    },

    /* --------------------------------------------------------------- students */
    listStudents: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const { page, pageSize, search, status, batchId } = req.query;
      res.json(await students.list({ page, pageSize, search, status, batchId }));
    },

    getStudent: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await students.getById(req.params.id));
    },

    createStudent: async (req, res) => {
      const result = await students.create(req.body, actorOf(req), req.ip);
      res.status(201).json(result);
    },

    updateStudent: async (req, res) => {
      res.json(await students.update(req.params.id, req.body, actorOf(req), req.ip));
    },

    changeStudentStatus: async (req, res) => {
      res.json(await students.changeStatus(req.params.id, req.body.status, actorOf(req), req.ip));
    },

    enrollStudent: async (req, res) => {
      res.json(await students.assignEnrollment(req.params.id, req.body, actorOf(req), req.ip));
    },

    closeEnrollment: async (req, res) => {
      res.json(await students.closeEnrollment(req.params.id, req.params.enrollmentId, req.body, actorOf(req), req.ip));
    },

    transferEnrollment: async (req, res) => {
      res.json(
        await students.transferEnrollment(req.params.id, req.params.enrollmentId, req.body, actorOf(req), req.ip)
      );
    },

    unenrollStudent: async (req, res) => {
      res.json(await students.removeEnrollment(req.params.id, req.params.enrollmentId, actorOf(req), req.ip));
    },

    resetStudentPassword: async (req, res) => {
      res.json(await students.resetPassword(req.params.id, req.body.password, actorOf(req), req.ip));
    },

    grantGuardianAccess: async (req, res) => {
      res.status(201).json(await students.grantGuardianAccess(req.params.id, req.body, actorOf(req), req.ip));
    },

    exportStudents: async (_req, res) => {
      const csv = await students.exportCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    },

    importStudents: async (req, res) => {
      const { csv } = csvImportSchema.parse(req.body);
      res.status(201).json(await students.importCsv(csv, actorOf(req), req.ip));
    },

    /* --------------------------------------------------------------- teachers */
    listTeachers: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const { page, pageSize, search, status } = req.query;
      res.json(await teachers.list({ page, pageSize, search, status }));
    },

    getTeacher: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teachers.getById(req.params.id));
    },

    createTeacher: async (req, res) => {
      res.status(201).json(await teachers.create(req.body, actorOf(req), req.ip));
    },

    updateTeacher: async (req, res) => {
      res.json(await teachers.update(req.params.id, req.body, actorOf(req), req.ip));
    },

    changeTeacherStatus: async (req, res) => {
      res.json(await teachers.changeStatus(req.params.id, req.body.status, actorOf(req), req.ip));
    },

    assignTeacherBatch: async (req, res) => {
      res.json(await teachers.assignBatch(req.params.id, req.body, actorOf(req), req.ip));
    },

    unassignTeacherBatch: async (req, res) => {
      res.json(await teachers.unassignBatch(req.params.id, req.params.batchId, actorOf(req), req.ip));
    },

    resetTeacherPassword: async (req, res) => {
      res.json(await teachers.resetPassword(req.params.id, req.body.password, actorOf(req), req.ip));
    },

    /* ---------------------------------------------------- courses & subjects */
    listCourses: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await academics.listCourses(req.query));
    },

    getCourse: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await academics.getCourse(req.params.id));
    },

    createCourse: async (req, res) => {
      res.status(201).json(await academics.createCourse(req.body, actorOf(req), req.ip));
    },

    updateCourse: async (req, res) => {
      res.json(await academics.updateCourse(req.params.id, req.body, actorOf(req), req.ip));
    },

    setCourseSubjects: async (req, res) => {
      res.json(await academics.setCourseSubjects(req.params.id, req.body.subjectIds, actorOf(req), req.ip));
    },

    listSubjects: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await academics.listSubjects(req.query));
    },

    createSubject: async (req, res) => {
      res.status(201).json(await academics.createSubject(req.body, actorOf(req), req.ip));
    },

    updateSubject: async (req, res) => {
      res.json(await academics.updateSubject(req.params.id, req.body, actorOf(req), req.ip));
    },

    /* ---------------------------------------------------------------- batches */
    listBatches: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await academics.listBatches(req.query));
    },

    getBatch: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await academics.getBatch(req.params.id));
    },

    createBatch: async (req, res) => {
      res.status(201).json(await academics.createBatch(req.body, actorOf(req), req.ip));
    },

    updateBatch: async (req, res) => {
      res.json(await academics.updateBatch(req.params.id, req.body, actorOf(req), req.ip));
    },

    addBatchSubject: async (req, res) => {
      res.json(await academics.addBatchSubject(req.params.id, req.body.subjectId, actorOf(req), req.ip));
    },

    removeBatchSubject: async (req, res) => {
      res.json(await academics.removeBatchSubject(req.params.id, req.params.subjectId, actorOf(req), req.ip));
    },

    assignBatchTeacher: async (req, res) => {
      res.json(await academics.assignBatchTeacher(req.params.id, req.body, actorOf(req), req.ip));
    },

    removeBatchTeacher: async (req, res) => {
      res.json(await academics.removeBatchTeacher(req.params.id, req.params.teacherId, actorOf(req), req.ip));
    },

    addSchedule: async (req, res) => {
      res.json(await academics.addSchedule(req.params.id, req.body, actorOf(req), req.ip));
    },

    removeSchedule: async (req, res) => {
      res.json(await academics.removeSchedule(req.params.id, req.params.scheduleId, actorOf(req), req.ip));
    }
  };
}
