import { NextResponse } from "next/server";
import { putBlob } from "@/lib/blob-storage";
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
 * Stored via lib/blob-storage. On Vercel that's Vercel Blob (when
 * BLOB_READ_WRITE_TOKEN is set); locally, public/uploads.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

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

  const result = await putBlob({ filename, blob: file });

  const updated = await updateAd(clientId, adId, (a) => ({
    ...a,
    editedVideoUrl: result.url,
    editorState: { ...editorState, updatedAt: new Date().toISOString() },
  }));

  return NextResponse.json({ ad: updated, url: result.url, backend: result.backend });
}
