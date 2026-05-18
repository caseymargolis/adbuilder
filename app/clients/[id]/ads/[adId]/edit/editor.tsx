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
  const [busy, setBusy] = useState<"exporting" | "saving" | "regenerating" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const aspect = ASPECTS.find((a) => a.id === state.aspect) ?? ASPECTS[0];

  // Preview drawing loop — re-draws whenever state / time changes.
  useEffect(() => {
    let raf = 0;
    function draw() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Set canvas dimensions to match the actual display size to prevent compression
      const rect = canvas.getBoundingClientRect();
      // Only update dimensions if they've changed to avoid unnecessary redraws
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
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

  // Resize observer to update canvas dimensions when container size changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const resizeObserver = new ResizeObserver(() => {
      // The draw loop will pick up the new dimensions
    });
    
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

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

  async function onRegenerateVideo() {
    setBusy("regenerating");
    try {
      const res = await fetch(`/api/ads/${ad.id}/regenerate-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          aspectRatio: state.aspect,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Regeneration failed");
      const data = await res.json();
      setToast("Video regenerated successfully for the new aspect ratio!");
      // Reload the page to show the new video
      window.location.reload();
    } catch (e) {
      setToast(`Regeneration hit a snag: ${(e as Error).message}`);
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

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Preview */}
        <div className="flex flex-col items-center justify-center">
          <div
            className="bg-black rounded-xl overflow-hidden shadow-lg border border-[color:var(--line)]"
            style={{
              width: "100%",
              maxWidth: aspect.id === "9:16" ? "28rem" : aspect.id === "16:9" ? "100%" : "28rem",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: "100%",
                aspectRatio: `${aspect.w} / ${aspect.h}`,
                display: "block"
              }}
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

          <div className="mt-4 card p-5 space-y-4 w-full max-w-2xl">
            <div className="flex items-center gap-3">
              <button 
                className="btn btn-primary" 
                onClick={togglePlay} 
                disabled={sourceIsImage}
              >
                {isPlaying ? "⏸ Pause" : "▶ Play"}
              </button>
              <div className="text-sm text-[color:var(--muted)] w-20 tabular-nums font-medium">
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
                className="flex-1 accent-[color:var(--terracotta)]"
                disabled={sourceIsImage}
              />
            </div>

            <div>
              <label className="label">Trim video</label>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums w-14 font-mono bg-[color:var(--bg)] px-2 py-1 rounded">{state.trimStart.toFixed(1)}s</span>
                <RangeDouble
                  min={0}
                  max={duration}
                  low={state.trimStart}
                  high={state.trimEnd}
                  onChange={(lo, hi) =>
                    setState((s) => ({ ...s, trimStart: lo, trimEnd: hi }))
                  }
                />
                <span className="text-sm tabular-nums w-14 font-mono bg-[color:var(--bg)] px-2 py-1 rounded">{state.trimEnd.toFixed(1)}s</span>
              </div>
              <p className="text-xs text-[color:var(--muted)] mt-1">
                Drag the handles to set start and end points
              </p>
            </div>

            <div className="flex gap-3 items-center pt-2">
              <label className="label mb-0">Audio</label>
              <button
                className={`btn ${state.mutedAudio ? "btn-danger" : "btn-ghost"}`}
                onClick={() =>
                  setState((s) => ({ ...s, mutedAudio: !s.mutedAudio }))
                }
              >
                {state.mutedAudio ? "🔇 Muted" : "🔊 Keep soundtrack"}
              </button>
            </div>
          </div>
        </div>

        {/* Controls */}
        <aside className="space-y-4">
          <div className="card p-5 space-y-4">
            <label className="label">Aspect ratio</label>
            <div className="grid grid-cols-2 gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  className={`btn text-sm ${state.aspect === a.id ? "btn-primary" : "btn-ghost"}`}
                  onClick={() =>
                    setState((s) => ({ ...s, aspect: a.id as EditorState["aspect"] }))
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-[color:var(--muted)] leading-relaxed">
              <span className="font-semibold">9:16</span> for Reels & Stories · 
              <span className="font-semibold">4:5</span> for Feed · 
              <span className="font-semibold">1:1</span> for everything else
            </p>
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Text overlays</label>
              <button 
                className="btn btn-primary text-sm" 
                onClick={addOverlay}
              >
                + Add text
              </button>
            </div>
            {state.overlays.length === 0 && (
              <div className="bg-[color:var(--bg)] rounded-lg p-4 text-center">
                <p className="text-sm text-[color:var(--muted)]">
                  No overlays yet. Add text overlays here instead of baking them into the video.
                </p>
              </div>
            )}
            {state.overlays.map((o) => (
              <div
                key={o.id}
                className="border border-[color:var(--line)] rounded-lg p-4 space-y-3 bg-[#fffdf8]"
              >
                <input
                  className="input text-sm font-medium"
                  value={o.text}
                  onChange={(e) => updateOverlay(o.id, { text: e.target.value })}
                  placeholder="Enter text..."
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-xs">Position</label>
                    <select
                      className="select text-sm"
                      value={o.position}
                      onChange={(e) =>
                        updateOverlay(o.id, { position: e.target.value as TextOverlay["position"] })
                      }
                    >
                      <option value="top">Top</option>
                      <option value="middle">Middle</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Align</label>
                    <select
                      className="select text-sm"
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
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[color:var(--muted)]">Color</label>
                    <input
                      type="color"
                      value={o.colorHex}
                      onChange={(e) => updateOverlay(o.id, { colorHex: e.target.value })}
                      className="w-8 h-8 rounded cursor-pointer border-0"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <label className="text-xs text-[color:var(--muted)]">Size</label>
                    <input
                      type="range"
                      min={3}
                      max={18}
                      step={0.5}
                      value={o.sizePct}
                      onChange={(e) =>
                        updateOverlay(o.id, { sizePct: Number(e.target.value) })
                      }
                      className="flex-1 accent-[color:var(--terracotta)]"
                    />
                    <span className="text-sm font-mono w-10">{o.sizePct}%</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-xs text-[color:var(--muted)]">Show from</label>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={o.fromSec}
                    onChange={(e) =>
                      updateOverlay(o.id, { fromSec: Number(e.target.value) })
                    }
                    className="input w-16 text-sm"
                  />
                  <label className="text-xs text-[color:var(--muted)]">to</label>
                  <input
                    type="number"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={o.toSec}
                    onChange={(e) =>
                      updateOverlay(o.id, { toSec: Number(e.target.value) })
                    }
                    className="input w-16 text-sm"
                  />
                  <span className="text-xs text-[color:var(--muted)]">seconds</span>
                </div>
                <div className="text-right pt-2">
                  <button
                    className="btn btn-danger text-xs"
                    onClick={() => removeOverlay(o.id)}
                  >
                    Remove overlay
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card p-5 space-y-3">
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={state.showCtaButton}
                onChange={(e) =>
                  setState((s) => ({ ...s, showCtaButton: e.target.checked }))
                }
                className="w-5 h-5 accent-[color:var(--terracotta)]"
              />
              <span>Show CTA button</span>
              <span className="pill pill-green">{(ad.creative.cta ?? "LEARN_MORE").replace("_", " ")}</span>
            </label>
            <p className="text-xs text-[color:var(--muted)] leading-relaxed">
              This is a visual reinforcement only. The actual CTA on the Meta ad object is what converts.
            </p>
          </div>

          <button
            className="btn btn-primary w-full justify-center text-base py-3"
            onClick={onSave}
            disabled={busy !== null}
          >
            {busy === "saving" ? "⏳ Exporting…" : "💾 Export & save"}
          </button>
          
          <button
            className="btn btn-ghost w-full justify-center text-base py-3 border-2 border-dashed"
            onClick={onRegenerateVideo}
            disabled={busy !== null || sourceIsImage}
          >
            {busy === "regenerating" ? "🔄 Regenerating video…" : "🎬 Regenerate video for this aspect ratio"}
          </button>
          
          {toast && (
            <div className={`text-sm p-3 rounded-lg ${toast.includes("hit a snag") ? "bg-[#f2d3cb] text-[#6b2415]" : "bg-[#e0ead3] text-[#2e4a1f]"}`}>
              {toast}
            </div>
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
