export function createAnnouncementsController({ announcements }) {
  const actorOf = (req) => ({ id: req.user.id, email: req.user.email });

  return {
    list: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await announcements.list(req.query));
    },

    create: async (req, res) => {
      res.status(201).json(await announcements.create(req.body, actorOf(req), req.ip));
    },

    update: async (req, res) => {
      res.json(await announcements.update(req.params.id, req.body, actorOf(req), req.ip));
    },

    remove: async (req, res) => {
      res.json(await announcements.remove(req.params.id, actorOf(req), req.ip));
    },

    teacherList: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await announcements.listForTeacher(req.user.id, req.query));
    },

    teacherCreate: async (req, res) => {
      res.status(201).json(await announcements.createForTeacher(req.body, actorOf(req), req.ip));
    }
  };
}

export function createNotificationsController({ notifications }) {
  return {
    list: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await notifications.list(req.user.id, req.query));
    },

    unreadCount: async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(await notifications.unreadCount(req.user.id));
    },

    markRead: async (req, res) => {
      res.json(await notifications.markRead(req.user.id, req.params.id));
    },

    markAllRead: async (req, res) => {
      res.json(await notifications.markAllRead(req.user.id));
    }
  };
}
