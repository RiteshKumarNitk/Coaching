export function createDashboardController({ dashboards }) {
  return {
    async admin(_req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.json(await dashboards.admin());
    },
    async teacher(req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.json(await dashboards.teacher(req.user.id));
    },
    async student(req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.json(await dashboards.student(req.user.id));
    }
  };
}

export function createProfileController({ auth }) {
  return {
    async me(req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.json({ profile: await auth.getProfile(req.user.id) });
    }
  };
}
