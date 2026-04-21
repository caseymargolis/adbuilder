"use client";

import type { AdRecord } from "@/lib/types";

export default function AdCard({
  ad,
  launched,
}: {
  ad: AdRecord;
  launched?: boolean;
}) {
  const m = ad.metrics;
  return (
    <div className="border border-[color:var(--line)] rounded-xl overflow-hidden bg-white/70">
      {ad.imageUrl && (
        <div className="aspect-square bg-[color:var(--bg)] relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ad.imageUrl}
            alt={ad.creative.headline}
            className="w-full h-full object-cover"
          />
          {ad.imageProvider && (
            <span className="absolute top-2 right-2 pill text-[10px]">
              {ad.imageProvider}
            </span>
          )}
        </div>
      )}
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
        {ad.imageReason && (
          <div className="text-xs text-[color:var(--muted)]">
            <b>Image model:</b> {ad.imageReason}
          </div>
        )}
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
