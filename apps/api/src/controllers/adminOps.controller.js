export function createAdminOpsController({ operations, reports }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email });

  return {
    /* ------------------------------------------------------------- staff accounts */
    listAdmins: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await operations.listAdmins(req.query));
    },

    createAdmin: async (req, res) => {
      res.status(201).json(await operations.createAdmin(req.body, actorOf(req), req.ip));
    },

    updateAdmin: async (req, res) => {
      res.json(await operations.updateAdmin(req.params.id, req.body, actorOf(req), req.ip));
    },

    resetAdminPassword: async (req, res) => {
      res.json(await operations.resetAdminPassword(req.params.id, req.body.password, actorOf(req), req.ip));
    },

    /* ------------------------------------------------------------------ settings */
    getSettings: async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await operations.getSettings());
    },

    updateSettings: async (req, res) => {
      res.json(await operations.updateSettings(req.body, actorOf(req), req.ip));
    },

    /* --------------------------------------------------------------- audit trail */
    audit: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await operations.listAudit(req.query));
    },

    /* ------------------------------------------------------------------- reports */
    overview: async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await reports.overview());
    },

    feesCsv: async (_req, res) => {
      const csv = await reports.feesCsv();
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fees-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    },

    attendanceCsv: async (req, res) => {
      const csv = await reports.attendanceCsv(req.query);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="attendance-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    }
  };
}
