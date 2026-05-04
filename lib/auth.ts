/**
 * Lightweight auth — Edge-runtime compatible (Web Crypto, no node:crypto).
 *
 * Single shared password (ADMIN_PASSWORD env var), signed-cookie session.
 *
 * Why not NextAuth / Clerk: this is an internal agency tool. One team.
 * Adding a full auth provider is overkill for v1. The cookie is
 * HMAC-signed with AUTH_SECRET so it can't be forged. Migrating to
 * Clerk/Auth.js later is small — auth() is the only call site.
 *
 * Security knobs:
 *   - Cookie is httpOnly, Secure (in prod), SameSite=Lax.
 *   - 30-day expiry.
 *   - Constant-time HMAC comparison.
 */

const COOKIE_NAME = "adwise_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const AUTH_COOKIE = COOKIE_NAME;

/** True if the password env var is set (i.e. auth is active). */
export function authEnabled(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) {
    throw new Error("Set AUTH_SECRET (or ADMIN_PASSWORD) in env to enable auth.");
  }
  return s;
}

/** Constant-time string equality. */
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return acc === 0;
}

/** Verify a candidate password against ADMIN_PASSWORD. */
export function verifyPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return ctEqual(candidate, expected);
}

async function hmacHex(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Mint a signed session token. Format: "<expSeconds>.<hmacHex>". */
export async function mintSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const sig = await hmacHex(`${exp}`);
  return `${exp}.${sig}`;
}

/** Verify a session cookie. Returns true if present, signed, and unexpired. */
export async function verifySession(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const expected = await hmacHex(expStr);
  if (!ctEqual(sig, expected)) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  return exp > Math.floor(Date.now() / 1000);
}

/** Cookie attributes string for Set-Cookie. */
export function cookieAttributes(): string {
  const parts = [
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function expireCookieAttributes(): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}
