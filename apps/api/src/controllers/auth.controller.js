import { clearSessionCookie, readSessionToken, setSessionCookie } from "../utils/cookies.js";

export function createAuthController({ auth }) {
  return {
    async login(req, res) {
      const { email, password } = req.body;
      const result = await auth.login({
        email,
        password,
        ip: req.ip,
        userAgent: req.get("user-agent")
      });
      // HttpOnly session cookie is set only by the server; the token is never
      // returned in the JSON body.
      setSessionCookie(res, result.token);
      res.setHeader("Cache-Control", "no-store");
      res.json({ user: result.user });
    },

    async logout(req, res) {
      await auth.logout(readSessionToken(req), req.user, req.ip);
      clearSessionCookie(res);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    },

    async me(req, res) {
      res.setHeader("Cache-Control", "no-store");
      res.json({ user: req.user });
    },

    async changePassword(req, res) {
      const { currentPassword, newPassword } = req.body;
      await auth.changePassword({
        userId: req.user.id,
        currentPassword,
        newPassword,
        ip: req.ip,
        keepTokenHash: req.sessionTokenHash
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, message: "Password updated. Other sessions were signed out." });
    }
  };
}
