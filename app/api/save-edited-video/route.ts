import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { updateAd } from "@/lib/db";
import type { EditorState } from "@/lib/types";

/**
 * Save an edited video from the in-browser editor.
 *
 *   POST /api/save-edited-video
 *   FormData:
 *     clientId: string
 *     adId: string
 *     editorState: JSON string (EditorState)
 *     video: File (webm / mp4 blob produced by MediaRecorder)
 *
 * We write the blob to public/uploads/<adId>.webm so the browser and the Meta
 * API client (when configured with a publicly-reachable host) can both fetch
 * it. For production you'd swap this for S3 or Vercel Blob — the write path
 * is localized to this file.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const clientId = String(form.get("clientId") ?? "");
  const adId = String(form.get("adId") ?? "");
  const stateStr = String(form.get("editorState") ?? "{}");
  const file = form.get("video");
  if (!clientId || !adId || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const editorState = JSON.parse(stateStr) as EditorState;
  const ext = file.type.includes("mp4") ? "mp4" : "webm";
  const filename = `${adId}.${ext}`;
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });
  const filepath = path.join(uploadsDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buffer);

  const publicUrl = `/uploads/${filename}`;
  const updated = await updateAd(clientId, adId, (a) => ({
    ...a,
    editedVideoUrl: publicUrl,
    editorState: { ...editorState, updatedAt: new Date().toISOString() },
  }));

  return NextResponse.json({ ad: updated, url: publicUrl });
}
