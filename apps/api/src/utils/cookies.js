import { SESSION_COOKIE_NAME } from "@coaching/shared";
import { env, sessionMaxAgeMs } from "../config/env.js";

const baseOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.cookieSecure,
  path: "/"
};

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseOptions, maxAge: sessionMaxAgeMs });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions);
}

export function readSessionToken(req) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}
