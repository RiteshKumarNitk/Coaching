/**
 * Password hashing with Node's built-in scrypt (no native dependencies).
 * Stored format: scrypt$N$r$p$<salt hex>$<derived key hex>
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64 };

export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PARAMS.keyLength, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("hex"),
    derived.toString("hex")
  ].join("$");
}

/**
 * Constant-time password verification. Returns false for malformed hashes
 * instead of throwing, so login cannot be used to probe account state.
 */
export function verifyPassword(password, storedHash) {
  try {
    if (typeof password !== "string" || typeof storedHash !== "string") return false;
    const [scheme, n, r, p, saltHex, hashHex] = storedHash.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p)
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Cryptographically strong temporary password (letters + digits guaranteed). */
export function generatePassword(length = 14) {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length - 2 && i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  const digits = randomBytes(2);
  return `${out}${digits[0] % 10}${String.fromCharCode(97 + (digits[1] % 26))}`;
}
