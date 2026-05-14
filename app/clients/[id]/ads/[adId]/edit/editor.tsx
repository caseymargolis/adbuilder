"use client";

/**
 * Canvas-based in-browser video editor.
 *
 * The one-shot video providers give us a raw clip. This editor layers on top:
 *   - Trim (in/out)
 *   - Aspect-ratio crop (1:1, 4:5, 9:16, 16:9)
 *   - Text overlays (headline, sub, CTA button) with position / align / color
 *   - Mute / keep audio
 *
 * Export: we drive a <video> element off-screen, composite it onto a <canvas>
 * frame-by-frame via requestVideoFrameCallback, and capture the canvas via
 * MediaRecorder (webm). We stream the audio from the video element into a
 * MediaStream so the export keeps the soundtrack unless the user muted.
 *
 * This avoids FFmpeg.wasm's 30MB bundle at the cost of webm output instead
 * of mp4. Meta accepts webm for ads and we add a note to that effect.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AdRecord, ClientRecord, EditorState, TextOverlay } from "@/lib/types";

const ASPECTS: Array<{ id: EditorState["aspect"]; label: string; w: number; h: number }> = [
  { id: "1:1", label: "Square · 1:1", w: 1080, h: 1080 },
  { id: "4:5", label: "Feed · 4:5", w: 1080, h: 1350 },
  { id: "9:16", label: "Story / Reels · 9:16", w: 1080, h: 1920 },
  { id: "16:9", label: "Landscape · 16:9", w: 1920, h: 1080 },
];

export default function VideoEditor({
  client,
  ad,
}: {
  client: ClientRecord;
  ad: AdRecord;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sourceUrl = ad.editedVideoUrl || ad.videoUrl;
  const sourceIsImage =
    !!sourceUrl && sourceUrl.startsWith("data:image"); // placeholder poster

  const initial: EditorState = ad.editorState ?? {
    aspect: "9:16",
    trimStart: 0,
    trimEnd: ad.videoDurationSec ?? 8,
    overlays: defaultOverlays(ad),
    showCtaButton: true,
    mutedAudio: false,
    updatedAt: new Date().toISOString(),
  };

  const [state, setState] = useState<EditorState>(initial);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(ad.videoDurationSec ?? 8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [busy, setBusy] = useState<"exporting" | "saving" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const aspect = ASPECTS.find((a) => a.id === state.aspect) ?? ASPECTS[0];

  // Preview drawing loop — re-draws whenever state / time changes.
  useEffect(() => {
    let raf = 0;
    function draw() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = aspect.w;
      canvas.height = aspect.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Background
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw the source. If it's an image placeholder, draw scaled-to-fill.
      if (sourceIsImage) {
        const img = placeholderImg.current;
        if (img && img.complete) drawCover(ctx, img, canvas.width, canvas.height);
      } else if (video && video.readyState >= 2 && video.videoWidth > 0) {
        drawCover(ctx, video, canvas.width, canvas.height);
      }

      // Overlays
      const t = sourceIsImage ? 0 : video?.currentTime ?? 0;
      for (const o of state.overlays) {
        if (t >= o.fromSec && t <= o.toSec) drawOverlay(ctx, o, canvas.width, canvas.height);
      }
      // CTA button
      if (state.showCtaButton) {
        drawCta(ctx, ad.creative.cta ?? "LEARN_MORE", canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [state, aspect, sourceIsImage, ad.creative.cta]);

  // Placeholder image element
  const placeholderImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!sourceIsImage || !sourceUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = sourceUrl;
    placeholderImg.current = img;
  }, [sourceIsImage, sourceUrl]);

  // Track time + duration from the video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration || duration);
    const onEnd = () => setIsPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("ended", onEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Enforce trim: seek back to trimStart if we pass trimEnd
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.currentTime > state.trimEnd) {
      v.pause();
      v.currentTime = state.trimStart;
      setIsPlaying(false);
    }
    if (v.currentTime < state.trimStart) v.currentTime = state.trimStart;
    v.muted = state.mutedAudio;
  }, [currentTime, state.trimStart, state.trimEnd, state.mutedAudio]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < state.trimStart || v.currentTime >= state.trimEnd) {
        v.currentTime = state.trimStart;
      }
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  function updateOverlay(id: string, patch: Partial<TextOverlay>) {
    setState((s) => ({
      ...s,
      overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  }

  function addOverlay() {
    setState((s) => ({
      ...s,
      overlays: [
        ...s.overlays,
        {
          id: `t_${Date.now()}`,
          text: "New text",
          position: "middle",
          align: "center",
          sizePct: 8,
          colorHex: "#ffffff",
          bgHex: "transparent",
          fromSec: 0,
          toSec: state.trimEnd,
        },
      ],
    }));
  }

  function removeOverlay(id: string) {
    setState((s) => ({ ...s, overlays: s.overlays.filter((o) => o.id !== id) }));
  }

  async function onSave() {
    setBusy("saving");
    try {
      const blob = await exportToBlob({
        videoEl: videoRef.current,
        canvasEl: canvasRef.current,
        state,
        sourceIsImage,
      });
      const fd = new FormData();
      fd.set("clientId", client.id);
      fd.set("adId", ad.id);
      fd.set("editorState", JSON.stringify(state));
      fd.set("video", blob, `${ad.id}.webm`);
      const res = await fetch("/api/save-edited-video", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      setToast("Saved. The ad now points at the edited version.");
    } catch (e) {
      setToast(`Export hit a snag: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Link
          href={`/clients/${client.id}`}
          className="text-sm text-[color:var(--muted)] hover:underline"
        >
          ← {client.name}
        </Link>
        <span className="pill">{ad.creative.angle}</span>
        {ad.videoProvider && <span className="pill">{ad.videoProvider}</span>}
        {sourceIsImage && (
          <span className="pill pill-amber">
            no video yet · editor running on placeholder
          </span>
        )}
      </header>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Preview */}
        <div>
          <div
            className="mx-auto bg-black rounded-xl overflow-hidden shadow"
            style={{
              aspectRatio: `${aspect.w} / ${aspect.h}`,
              maxHeight: "70vh",
              maxWidth: aspect.id === "9:16" ? "28rem" : "100%",
            }}
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
            />
            {sourceUrl && !sourceIsImage && (
              // Hidden source video; we composite via canvas above.
              <video
                ref={videoRef}
                src={sourceUrl}
                className="hidden"
                playsInline
                crossOrigin="anonymous"
                preload="auto"
              />
            )}
          </div>

          <div className="mt-4 card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <button className="btn btn-ghost" onClick={togglePlay} disabled={sourceIsImage}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <div className="text-xs text-[color:var(--muted)] w-16 tabular-nums">
                {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
              </div>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = Number(e.target.value);
                }}
                className="flex-1"
                disabled={sourceIsImage}
              />
            </div>

            <div>
              <label className="label">Trim</label>
              <div className="flex items-center gap-2">
                <span className="text-xs tabular-nums w-12">{state.trimStart.toFixed(1)}s</span>
                <RangeDouble
                  min={0}
                  max={duration}
                  low={state.trimStart}
                  high={state.trimEnd}
                  onChange={(lo, hi) =>
                    setState((s) => ({ ...s, trimStart: lo, trimEnd: hi }))
                  }
                />
                <span className="text-xs tabular-nums w-12">{state.trimEnd.toFixed(1)}s</span>
              </div>
            </div>

            <div className="flex gap-3 items-center">
              <label className="label mb-0">Audio</label>
              <button
                className={`btn ${state.mutedAudio ? "btn-danger" : "btn-ghost"}`}
                onClick={() =>
                  setState((s) => ({ ...s, mutedAudio: !s.mutedAudio }))
                }
              >
                {state.mutedAudio ? "Muted" : "Keep soundtrack"}
              </button>
            </div>
          </div>
        </div>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="card p-4 space-y-3">
            <label className="label">Aspect ratio / placement</label>
            <select
              className="select"
              value={state.aspect}
              onChange={(e) =>
                setState((s) => ({ ...s, aspect: e.target.value as EditorState["aspect"] }))
              }
            >
              {ASPECTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[color:var(--muted)]">
              9:16 for Reels & Stories. 4:5 for Feed. 1:1 for everything
              else. We letterbox-fill, so crop is cover-style.
            </p>
          </div>

          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Text overlays</label>
              <button className="btn btn-ghost" onClick={addOverlay}>+ Add</button>
            </div>
            {state.overlays.length === 0 && (
              <p className="text-xs text-[color:var(--muted)]">
                No overlays. Add the headline here instead of baking it into
                the video — the generator can't be trusted with text yet.
              </p>
            )}
            {state.overlays.map((o) => (
              <div
                key={o.id}
                className="border border-[color:var(--line)] rounded-lg p-3 space-y-2"
              >
                <input
                  className="input text-sm"
                  value={o.text}
                  onChange={(e) => updateOverlay(o.id, { text: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="select text-xs"
                    value={o.position}
                    onChange={(e) =>
                      updateOverlay(o.id, { position: e.target.value as TextOverlay["position"] })
                    }
                  >
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                  <select
                    className="select text-xs"
                    value={o.align}
                    onChange={(e) =>
                      updateOverlay(o.id, { align: e.target.value as TextOverlay["align"] })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={o.colorHex}
                    onChange={(e) => updateOverlay(o.id, { colorHex: e.target.value })}
                  />
                  <input
                    type="range"
                    min={3}
                    max={18}
                    step={0.5}
                    value={o.sizePct}
                    onChange={(e) =>
                      updateOverlay(o.id, { sizePct: Number(e.target.value) })
                    }
                    className="flex-1"
                  />
                  <span className="text-xs">{o.sizePct}%</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <label>Show from</label>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={o.fromSec}
                    onChange={(e) =>
                      updateOverlay(o.id, { fromSec: Number(e.target.value) })
                    }
                    className="input w-16 text-xs"
                  />
                  <label>to</label>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={o.toSec}
                    onChange={(e) =>
                      updateOverlay(o.id, { toSec: Number(e.target.value) })
                    }
                    className="input w-16 text-xs"
                  />
                </div>
                <div className="text-right">
                  <button
                    className="text-xs text-[color:var(--terracotta)] hover:underline"
                    onClick={() => removeOverlay(o.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-4 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.showCtaButton}
                onChange={(e) =>
                  setState((s) => ({ ...s, showCtaButton: e.target.checked }))
                }
              />
              Render CTA button — <b>{(ad.creative.cta ?? "LEARN_MORE").replace("_", " ")}</b>
            </label>
            <p className="text-xs text-[color:var(--muted)]">
              The CTA on the Meta ad object is the one that actually converts.
              This is a visual reinforcement only.
            </p>
          </div>

          <button
            className="btn btn-primary w-full justify-center"
            onClick={onSave}
            disabled={busy !== null}
          >
            {busy === "saving" ? "Exporting…" : "Export & save"}
          </button>
          {toast && (
            <div className="text-xs text-[color:var(--muted)] italic">{toast}</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function defaultOverlays(ad: AdRecord): TextOverlay[] {
  return [
    {
      id: "t_headline",
      text: ad.creative.headline,
      position: "top",
      align: "center",
      sizePct: 9,
      colorHex: "#ffffff",
      bgHex: "rgba(0,0,0,0.25)",
      fromSec: 0,
      toSec: 3,
    },
    {
      id: "t_primary",
      text: ad.creative.description || ad.creative.primaryText.slice(0, 60),
      position: "bottom",
      align: "center",
      sizePct: 5,
      colorHex: "#ffffff",
      bgHex: "rgba(0,0,0,0.25)",
      fromSec: 2,
      toSec: 100,
    },
  ];
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: HTMLVideoElement | HTMLImageElement,
  cw: number,
  ch: number,
) {
  const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth;
  const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight;
  if (!sw || !sh) return;
  const sr = sw / sh;
  const cr = cw / ch;
  let dw = cw;
  let dh = ch;
  let dx = 0;
  let dy = 0;
  if (sr > cr) {
    // source wider → crop sides
    dw = ch * sr;
    dx = (cw - dw) / 2;
  } else {
    dh = cw / sr;
    dy = (ch - dh) / 2;
  }
  ctx.drawImage(src, dx, dy, dw, dh);
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  o: TextOverlay,
  w: number,
  h: number,
) {
  const fontPx = Math.round((o.sizePct / 100) * h);
  ctx.font = `700 ${fontPx}px "Fraunces", Georgia, serif`;
  ctx.textBaseline = "middle";
  const pad = Math.round(fontPx * 0.4);
  const text = o.text;
  const lines = wrapText(ctx, text, w - pad * 4);
  const lineHeight = Math.round(fontPx * 1.15);
  const totalHeight = lineHeight * lines.length;
  let baseY: number;
  if (o.position === "top") baseY = pad + fontPx / 2;
  else if (o.position === "middle") baseY = h / 2 - totalHeight / 2 + fontPx / 2;
  else baseY = h - pad - totalHeight + fontPx / 2;

  // Background band
  if (o.bgHex !== "transparent") {
    ctx.fillStyle = o.bgHex;
    const boxX = pad;
    const boxY = baseY - fontPx / 2 - pad / 2;
    const boxW = w - pad * 2;
    const boxH = totalHeight + pad;
    ctx.fillRect(boxX, boxY, boxW, boxH);
  }

  ctx.fillStyle = o.colorHex;
  ctx.textAlign = o.align;
  const x = o.align === "left" ? pad * 2 : o.align === "right" ? w - pad * 2 : w / 2;
  let y = baseY;
  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCta(
  ctx: CanvasRenderingContext2D,
  cta: string,
  w: number,
  h: number,
) {
  const label = cta.replace(/_/g, " ");
  const fontPx = Math.round(h * 0.035);
  ctx.font = `700 ${fontPx}px "Inter", sans-serif`;
  const padX = fontPx * 1.2;
  const padY = fontPx * 0.7;
  const textW = ctx.measureText(label).width;
  const boxW = textW + padX * 2;
  const boxH = fontPx + padY * 2;
  const x = (w - boxW) / 2;
  const y = h - boxH - h * 0.04;
  ctx.fillStyle = "#C45A3F";
  roundedRect(ctx, x, y, boxW, boxH, fontPx * 0.4);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, w / 2, y + boxH / 2);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function RangeDouble({
  min,
  max,
  low,
  high,
  onChange,
}: {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (lo: number, hi: number) => void;
}) {
  return (
    <div className="flex-1 relative h-6 flex items-center">
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={low}
        onChange={(e) => onChange(Math.min(Number(e.target.value), high - 0.1), high)}
        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={0.1}
        value={high}
        onChange={(e) => onChange(low, Math.max(Number(e.target.value), low + 0.1))}
        className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-auto"
      />
    </div>
  );
}

// ----- Export pipeline -----
//
// Walks the source video from trimStart → trimEnd, drawing each frame onto
// the preview canvas, and records the canvas stream via MediaRecorder. Audio
// comes from a MediaStreamAudioSourceNode tapped off the video element
// unless mutedAudio is set.

async function exportToBlob(args: {
  videoEl: HTMLVideoElement | null;
  canvasEl: HTMLCanvasElement | null;
  state: EditorState;
  sourceIsImage: boolean;
}): Promise<Blob> {
  const { videoEl, canvasEl, state, sourceIsImage } = args;
  if (!canvasEl) throw new Error("No canvas.");
  // For placeholder-only (image source), we emit a 3-second static video.
  if (sourceIsImage || !videoEl) {
    return recordStatic(canvasEl, Math.max(state.trimEnd - state.trimStart, 3));
  }

  const stream = (canvasEl as HTMLCanvasElement & { captureStream?: () => MediaStream })
    .captureStream?.(30);
  if (!stream) throw new Error("Canvas captureStream not supported in this browser.");

  // Attach audio if not muted
  if (!state.mutedAudio) {
    try {
      const audioCtx = new AudioContext();
      const src = audioCtx.createMediaElementSource(videoEl);
      const dest = audioCtx.createMediaStreamDestination();
      src.connect(dest);
      // Also route back to speakers so preview still has sound
      src.connect(audioCtx.destination);
      for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
    } catch {
      // createMediaElementSource can only be called once per element; if the
      // user already previewed with sound, re-calling throws. Fall back to
      // video-only export.
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    recorder.onerror = (e) => reject(e);
  });

  videoEl.currentTime = state.trimStart;
  await new Promise<void>((r) =>
    videoEl.addEventListener("seeked", () => r(), { once: true }),
  );
  recorder.start();
  videoEl.play();
  await new Promise<void>((resolve) => {
    const check = () => {
      if (videoEl.currentTime >= state.trimEnd) {
        videoEl.pause();
        recorder.stop();
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
  return done;
}

async function recordStatic(canvas: HTMLCanvasElement, seconds: number): Promise<Blob> {
  const stream = (canvas as HTMLCanvasElement & { captureStream?: () => MediaStream })
    .captureStream?.(30);
  if (!stream) throw new Error("Canvas captureStream not supported.");
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    recorder.onerror = (e) => reject(e);
  });
  recorder.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  recorder.stop();
  return done;
}

// Silence unused imports when swapping strategies later.
void useMemo;
