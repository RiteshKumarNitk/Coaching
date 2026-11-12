export function createStudentController({ student }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email, roles: req.user.roles });

  return {
    courses: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ items: await student.listCourses(req.user.id) });
    },

    batch: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.getBatch(req.user.id, req.params.id));
    },

    lessons: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.listLessons(req.user.id, req.query));
    },

    lesson: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.getLesson(req.user.id, req.params.id));
    },

    saveProgress: async (req, res) => {
      res.json(await student.saveProgress(req.user.id, req.params.id, req.body, req.ip, actorOf(req)));
    },

    materials: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.listMaterials(req.user.id, req.query));
    },

    assignments: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.listAssignments(req.user.id, req.query));
    },

    assignment: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.getAssignment(req.user.id, req.params.id));
    },

    submitAssignment: async (req, res) => {
      res.status(201).json(await student.submitAssignment(req.user.id, req.params.id, req.body, req.ip, actorOf(req)));
    },

    attendance: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.attendanceHistory(req.user.id, req.query));
    },

    announcements: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await student.listAnnouncements(req.user.id, req.query));
    }
  };
}
