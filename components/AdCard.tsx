"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdRecord } from "@/lib/types";

export default function AdCard({
  ad,
  launched,
}: {
  ad: AdRecord;
  launched?: boolean;
}) {
  const m = ad.metrics;
  const hasVideo = !!ad.videoUrl;
  const videoPreview = ad.editedVideoUrl || ad.videoUrl;
  const [generatingVideo, setGeneratingVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateVideoVariant() {
    setGeneratingVideo(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: ad.clientId,
          adId: ad.id,
          aspectHint: "9:16",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Video gen failed");
      // Refresh page to pick up the saved videoUrl
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setGeneratingVideo(false);
    }
  }

  return (
    <div className="border border-[color:var(--line)] rounded-xl overflow-hidden bg-white/70">
      <div className="aspect-square bg-[color:var(--bg)] relative">
        {hasVideo && videoPreview && !videoPreview.startsWith("data:image") ? (
          // Real video — autoplay muted loop for preview feel
          <video
            src={videoPreview}
            muted
            loop
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : ad.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.imageUrl}
            alt={ad.creative.headline}
            className="w-full h-full object-cover"
          />
        ) : null}
        <div className="absolute top-2 right-2 flex gap-1">
          {hasVideo && <span className="pill">{ad.videoProvider || "video"}</span>}
          {ad.imageProvider && !hasVideo && (
            <span className="pill text-[10px]">{ad.imageProvider}</span>
          )}
        </div>
        {hasVideo && (
          <span className="absolute top-2 left-2 pill pill-green">video</span>
        )}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="pill">{ad.creative.angle}</span>
          <StatusPill status={ad.status} />
        </div>
        <div className="font-display text-lg leading-tight">
          {ad.creative.headline}
        </div>
        <p className="text-sm">{ad.creative.primaryText}</p>
        <p className="text-xs text-[color:var(--muted)]">{ad.creative.description}</p>
        <div className="text-xs">
          <span className="pill pill-amber">{ad.creative.cta.replace("_", " ")}</span>
        </div>
        <div className="pt-2 border-t border-[color:var(--line)] text-xs text-[color:var(--muted)]">
          <b>Why this should work:</b> {ad.creative.hypothesis}
        </div>
        {hasVideo && ad.videoReason && (
          <div className="text-xs text-[color:var(--muted)]">
            <b>Video model:</b> {ad.videoReason}
          </div>
        )}
        {!hasVideo && ad.imageReason && (
          <div className="text-xs text-[color:var(--muted)]">
            <b>Image model:</b> {ad.imageReason}
          </div>
        )}
        <div className="pt-2 flex gap-2 flex-wrap">
          {!hasVideo && (
            <button
              className="btn btn-ghost text-xs"
              onClick={generateVideoVariant}
              disabled={generatingVideo}
            >
              {generatingVideo ? "Generating video…" : "+ Video variant"}
            </button>
          )}
          {hasVideo && (
            <Link
              href={`/clients/${ad.clientId}/ads/${ad.id}/edit`}
              className="btn btn-ghost text-xs"
            >
              Edit video
            </Link>
          )}
          {ad.editedVideoUrl && (
            <span className="pill pill-green">edited</span>
          )}
        </div>
        {error && <div className="pill pill-red text-xs">{error}</div>}
        {launched && m && (
          <div className="pt-2 border-t border-[color:var(--line)] grid grid-cols-4 gap-1 text-xs">
            <Metric label="Spend" value={`$${m.spend.toFixed(0)}`} />
            <Metric label="CTR" value={`${(m.ctr * 100).toFixed(2)}%`} />
            <Metric label="CPA" value={m.conversions > 0 ? `$${m.cpa.toFixed(0)}` : "—"} />
            <Metric label="Freq" value={m.frequency.toFixed(1)} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AdRecord["status"] }) {
  const cls =
    status === "live" || status === "winner"
      ? "pill pill-green"
      : status === "paused" || status === "killed"
        ? "pill pill-red"
        : "pill pill-amber";
  return <span className={cls}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
