export function createTeacherController({ teacher }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email, roles: req.user.roles });

  return {
    listBatches: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ items: await teacher.listBatches(actorOf(req)) });
    },

    getBatch: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.getBatch(req.params.id, actorOf(req)));
    },

    attendance: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.getAttendance(req.params.id, req.query.date, actorOf(req)));
    },

    saveAttendance: async (req, res) => {
      res.json(
        await teacher.saveAttendance(req.params.id, req.body.date, req.body.records, actorOf(req), req.ip)
      );
    },

    listLessons: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.listLessons(req.params.id, actorOf(req), req.query));
    },

    createLesson: async (req, res) => {
      res.status(201).json(await teacher.createLesson(req.params.id, req.body, actorOf(req), req.ip));
    },

    updateLesson: async (req, res) => {
      res.json(await teacher.updateLesson(req.params.id, req.body, actorOf(req), req.ip));
    },

    deleteLesson: async (req, res) => {
      res.json(await teacher.deleteLesson(req.params.id, actorOf(req), req.ip));
    },

    listMaterials: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.listMaterials(req.params.id, actorOf(req), req.query));
    },

    createMaterial: async (req, res) => {
      res.status(201).json(await teacher.createMaterial(req.params.id, req.body, actorOf(req), req.ip));
    },

    updateMaterial: async (req, res) => {
      res.json(await teacher.updateMaterial(req.params.id, req.body, actorOf(req), req.ip));
    },

    deleteMaterial: async (req, res) => {
      res.json(await teacher.deleteMaterial(req.params.id, actorOf(req), req.ip));
    },

    listAssignments: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.listAssignments(req.params.id, actorOf(req), req.query));
    },

    createAssignment: async (req, res) => {
      res.status(201).json(await teacher.createAssignment(req.params.id, req.body, actorOf(req), req.ip));
    },

    updateAssignment: async (req, res) => {
      res.json(await teacher.updateAssignment(req.params.id, req.body, actorOf(req), req.ip));
    },

    deleteAssignment: async (req, res) => {
      res.json(await teacher.deleteAssignment(req.params.id, actorOf(req), req.ip));
    },

    getAssignment: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await teacher.getAssignment(req.params.id, actorOf(req)));
    },

    evaluateSubmission: async (req, res) => {
      res.json(await teacher.evaluateSubmission(req.params.id, req.body, actorOf(req), req.ip));
    }
  };
}
