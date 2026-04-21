"use client";

export default function ReportBlock({
  tldr,
  body,
  meta,
  badges,
}: {
  tldr: string;
  body: string;
  meta?: string;
  badges?: string[];
}) {
  return (
    <div className="space-y-3">
      <div className="border-l-2 border-[color:var(--terracotta)] pl-4">
        <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
          TL;DR
        </div>
        <p className="font-display text-lg leading-snug mt-1">{tldr}</p>
      </div>
      {badges && badges.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {badges.map((b, i) => (
            <span key={i} className="pill">{b}</span>
          ))}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-[color:var(--muted)] hover:underline">
          Read the whole briefing
        </summary>
        <div className="prose-report mt-3 whitespace-pre-wrap">{body}</div>
      </details>
      {meta && <div className="text-xs text-[color:var(--muted)]">{meta}</div>}
    </div>
  );
}
