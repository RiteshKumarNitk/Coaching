export function createExamsController({ exams }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email, roles: req.user.roles });

  return {
    list: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await exams.listExams(actorOf(req), req.query));
    },

    get: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await exams.getExam(req.params.id, actorOf(req)));
    },

    create: async (req, res) => {
      res.status(201).json(await exams.createExam(req.body, actorOf(req), req.ip));
    },

    update: async (req, res) => {
      res.json(await exams.updateExam(req.params.id, req.body, actorOf(req), req.ip));
    },

    duplicate: async (req, res) => {
      res.status(201).json(await exams.duplicateExam(req.params.id, actorOf(req), req.ip));
    },

    remove: async (req, res) => {
      res.json(await exams.deleteExam(req.params.id, actorOf(req), req.ip));
    },

    addQuestion: async (req, res) => {
      res.status(201).json(await exams.addQuestion(req.params.id, req.body, actorOf(req), req.ip));
    },

    updateQuestion: async (req, res) => {
      res.json(await exams.updateQuestion(req.params.id, req.body, actorOf(req), req.ip));
    },

    deleteQuestion: async (req, res) => {
      res.json(await exams.deleteQuestion(req.params.id, actorOf(req), req.ip));
    },

    attemptResponses: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await exams.attemptResponses(req.params.id, actorOf(req)));
    },

    evaluateResponse: async (req, res) => {
      res.json(await exams.evaluateResponse(req.params.id, req.body, actorOf(req), req.ip));
    },

    publishResults: async (req, res) => {
      res.json(await exams.publishResults(req.params.id, actorOf(req), req.ip));
    }
  };
}

export function createFeesController({ fees }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email });

  return {
    structures: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fees.listStructures(req.query));
    },

    createStructure: async (req, res) => {
      res.status(201).json(await fees.createStructure(req.body, actorOf(req), req.ip));
    },

    updateStructure: async (req, res) => {
      res.json(await fees.updateStructure(req.params.id, req.body, actorOf(req), req.ip));
    },

    dues: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fees.listDues(req.query));
    },

    assign: async (req, res) => {
      res.status(201).json(await fees.assignFee(req.body, actorOf(req), req.ip));
    },

    recordPayment: async (req, res) => {
      const result = await fees.recordPayment(req.params.id, req.body, actorOf(req), req.ip);
      // A replayed request returns the original receipt, so it is not a new creation.
      res.status(result.replayed ? 200 : 201).json(result);
    },

    payments: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fees.listPayments(req.query));
    },

    voidPayment: async (req, res) => {
      res.json(await fees.voidPayment(req.params.id, req.body, actorOf(req), req.ip));
    },

    waive: async (req, res) => {
      res.json(await fees.waiveFee(req.params.id, req.body, actorOf(req), req.ip));
    },

    updateFee: async (req, res) => {
      res.json(await fees.updateStudentFee(req.params.id, req.body, actorOf(req), req.ip));
    },

    receipt: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fees.paymentReceipt(req.params.id));
    },

    reminders: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await fees.listReminders(req.query));
    }
  };
}
