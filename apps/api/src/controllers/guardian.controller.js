export function createGuardianController({ guardian }) {
  const noStore = (res) => res.setHeader("Cache-Control", "no-store");

  return {
    children: async (req, res) => {
      noStore(res);
      res.json({ items: await guardian.listChildren(req.user.id) });
    },

    attendance: async (req, res) => {
      noStore(res);
      res.json(await guardian.attendance(req.user.id, req.params.id, req.query));
    },

    fees: async (req, res) => {
      noStore(res);
      res.json(await guardian.fees(req.user.id, req.params.id));
    },

    results: async (req, res) => {
      noStore(res);
      res.json(await guardian.results(req.user.id, req.params.id, req.query));
    }
  };
}
