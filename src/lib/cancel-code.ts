import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// The cancel code is the only thing standing between a booking and anyone
// else on the board pressing Cancel on it. There's still no login: the
// booker picks a code when they book, keeps it, and types it again to
// cancel. Only a salted scrypt hash is stored, so the code never reaches the
// page, the live-update stream, or anyone reading the database.
export const CODE_MIN = 4;
export const CODE_MAX = 40;

export function isValidCode(code: string): boolean {
  return code.length >= CODE_MIN && code.length <= CODE_MAX;
}

export function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function codeMatches(code: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(code, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
