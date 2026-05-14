"use client";

import { useState } from "react";
import type { AdRecord } from "@/lib/types";

export default function GoogleAdCard({
  ad,
  launched,
  onDelete,
  onRegenerate,
}: {
  ad: AdRecord;
  launched?: boolean;
  onDelete?: () => void;
  onRegenerate?: () => void;
}) {
  const rsa = ad.googleRsa;
  if (!rsa) return null;

  const m = ad.metrics;
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  return (
    <div className="border border-[color:var(--line)] rounded-xl overflow-hidden bg-white/70">
      {/* URL preview bar — what the user sees on the SERP */}
      <div className="bg-[color:var(--bg)] p-4 border-b border-[color:var(--line)]">
        <div className="text-[11px] text-green-700 flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-600/20 inline-flex items-center justify-center text-[8px] font-bold">Ad</span>
          <span className="truncate">
            {rsa.finalUrl}
            {rsa.path1 ? ` › ${rsa.path1}` : ""}
            {rsa.path2 ? ` › ${rsa.path2}` : ""}
          </span>
        </div>
        <div className="font-medium text-sm text-blue-800 mt-0.5 leading-snug line-clamp-2">
          {rsa.headlines[0]}
        </div>
        <div className="text-xs text-[color:var(--muted)] mt-0.5 line-clamp-2">
          {rsa.descriptions[0]}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="pill">{ad.creative.angle}</span>
          <StatusPill status={ad.status} />
        </div>

        {/* Headlines */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] font-semibold mb-1">
            Headlines ({rsa.headlines.length})
          </div>
          <ul className="space-y-1">
            {rsa.headlines.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="text-[color:var(--muted)] tabular-nums shrink-0">{i + 1}.</span>
                <span className={h.length > 30 ? "text-red-600" : ""}>{h}</span>
                <span className="text-[10px] text-[color:var(--muted)] tabular-nums shrink-0 ml-auto">{h.length}c</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Descriptions */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] font-semibold mb-1">
            Descriptions ({rsa.descriptions.length})
          </div>
          <ul className="space-y-1">
            {rsa.descriptions.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="text-[color:var(--muted)] tabular-nums shrink-0">{i + 1}.</span>
                <span className={d.length > 90 ? "text-red-600" : ""}>{d}</span>
                <span className="text-[10px] text-[color:var(--muted)] tabular-nums shrink-0 ml-auto">{d.length}c</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Paths */}
        {(rsa.path1 || rsa.path2) && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] font-semibold mb-1">
              Display path
            </div>
            <div className="text-xs font-mono bg-[color:var(--bg)] px-2 py-1 rounded">
              {rsa.path1 || "—"} / {rsa.path2 || "—"}
            </div>
          </div>
        )}

        <div className="text-xs">
          <span className="pill pill-amber">{(ad.creative.cta ?? "LEARN_MORE").replace("_", " ")}</span>
          <span className="text-[color:var(--muted)] ml-2">{rsa.finalUrl}</span>
        </div>

        <div className="pt-2 border-t border-[color:var(--line)] text-xs text-[color:var(--muted)]">
          <b>Why this should work:</b> {ad.creative.hypothesis}
        </div>

        {ad.status === "draft" && onRegenerate && (
          <div className="pt-2 flex gap-2">
            <button
              className="btn btn-ghost text-xs"
              onClick={async () => {
                setRegenerating(true);
                try { await onRegenerate(); } finally { setRegenerating(false); }
              }}
              disabled={regenerating}
            >
              {regenerating ? "Regenerating…" : "Regenerate"}
            </button>
            {onDelete && (
              <button
                className="btn btn-ghost text-xs text-red-600 hover:text-red-700"
                onClick={async () => {
                  setDeleting(true);
                  try { await onDelete(); } finally { setDeleting(false); }
                }}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
        )}
        {ad.status === "draft" && !onRegenerate && onDelete && (
          <div className="pt-2 flex gap-2">
            <button
              className="btn btn-ghost text-xs text-red-600 hover:text-red-700"
              onClick={async () => {
                setDeleting(true);
                try { await onDelete(); } finally { setDeleting(false); }
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}

        {launched && m && (
          <div className="pt-2 border-t border-[color:var(--line)] grid grid-cols-4 gap-1 text-xs">
            <Metric label="Spend" value={`$${m.spend.toFixed(0)}`} />
            <Metric label="CTR" value={`${(m.ctr * 100).toFixed(2)}%`} />
            <Metric label="CPA" value={m.conversions > 0 ? `$${m.cpa.toFixed(0)}` : "—"} />
            <Metric label="Clicks" value={`${m.clicks}`} />
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
