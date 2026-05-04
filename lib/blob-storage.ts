/**
 * Media blob storage.
 *
 * Where edited videos and (future) generated assets get persisted across
 * deploys. On Vercel the local filesystem is ephemeral, so we need an
 * actual blob store. Two paths:
 *
 *   - Vercel Blob   — when BLOB_READ_WRITE_TOKEN is set. Best fit for
 *                     Vercel-hosted apps. https://vercel.com/docs/storage/vercel-blob
 *   - Local disk    — dev fallback, writes to public/uploads.
 *
 * Returns a publicly-readable URL the browser AND the Meta API can fetch.
 *
 * Add: S3, R2, GCS as additional cases when needed — same interface.
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface PutResult {
  url: string;
  backend: "vercel-blob" | "local";
}

/** Save a binary blob and get back a publicly-fetchable URL. */
export async function putBlob(args: {
  filename: string;
  blob: Blob;
}): Promise<PutResult> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    return await putVercelBlob(args, token);
  }
  return await putLocal(args);
}

async function putVercelBlob(
  args: { filename: string; blob: Blob },
  token: string,
): Promise<PutResult> {
  // We dynamic-import @vercel/blob so the dep is optional. The package is
  // tiny but it's still nice not to require it for non-Vercel deployments.
  // @ts-expect-error — optional peer dep
  const mod = await import("@vercel/blob").catch(() => null);
  if (!mod) {
    // Package not installed; fall back to local.
    return putLocal(args);
  }
  const result = (await mod.put(args.filename, args.blob, {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
  })) as { url: string };
  return { url: result.url, backend: "vercel-blob" };
}

async function putLocal(args: {
  filename: string;
  blob: Blob;
}): Promise<PutResult> {
  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });
  const filepath = path.join(dir, args.filename);
  const ab = await args.blob.arrayBuffer();
  await fs.writeFile(filepath, Buffer.from(ab));
  return { url: `/uploads/${args.filename}`, backend: "local" };
}
