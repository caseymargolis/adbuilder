/**
 * Encrypt arbitrary strings at rest using AES-256-GCM.
 *
 * Used for OAuth tokens stored on the client record. The key is derived
 * from AUTH_SECRET via SHA-256 — same secret as the auth cookies, so
 * losing it locks both. That's intentional: one rotation door.
 *
 * Format of the cipher string: `v1.<ivBase64>.<tagBase64>.<dataBase64>`
 *
 * If you ever need to rotate, prepend a new version (`v2.`) and try
 * decrypting with the right key by version. v1 is currently the only one.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET must be set (32+ chars) to encrypt tokens at rest.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(cipher: string): string {
  const parts = cipher.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Bad ciphertext format.");
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
