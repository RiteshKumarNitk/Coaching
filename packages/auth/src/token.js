/** Opaque session tokens. Only the SHA-256 hash is stored in the database. */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_TOKEN_BYTES = 32;

export function createSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
