/**
 * Email — Resend.
 *
 * https://resend.com — best-in-class transactional email API.
 * One env var (RESEND_API_KEY), one env var for the from-address (RESEND_FROM).
 *
 * If unset, every email call no-ops gracefully and returns { sent: false }.
 * Don't fail the caller if email fails — it's never load-bearing.
 */

import type { OptimizationLog } from "./types";

interface SendResult {
  sent: boolean;
  id?: string;
  error?: string;
}

async function send(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { sent: false, error: "Resend not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      return { sent: false, error: `Resend ${res.status}` };
    }
    const data = (await res.json()) as { id?: string };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

/** Daily optimization digest. Sent after the cron runs. */
export async function sendOptimizationDigest(args: {
  to: string;
  clientName: string;
  log: OptimizationLog;
  appliedCount: number;
}): Promise<SendResult> {
  const subject = `Adwise · ${args.clientName} · ${shortVerdict(args.log)}`;
  const text = [
    `Adwise daily review for ${args.clientName}`,
    `${args.log.summary}`,
    "",
    `Applied ${args.appliedCount} action${args.appliedCount === 1 ? "" : "s"} on Meta.`,
    "",
    "Full breakdown:",
    args.log.raw,
    "",
    args.log.actions
      .map(
        (a) => `· ${a.kind.replace("_", " ").toUpperCase()} ${a.adId} — ${a.reason}`,
      )
      .join("\n"),
  ].join("\n");

  const html = `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#F4F1EA; color:#1a1a1a; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background:#fffdf8; border:1px solid #d9d2c4; border-radius: 14px; padding: 24px;">
    <div style="font-family: Georgia, serif; font-size: 22px; font-weight: 600; margin-bottom: 4px;">Adwise<span style="color:#C45A3F">.</span></div>
    <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #5f5b54; font-weight: 700;">Daily review · ${escapeHtml(args.clientName)}</div>
    <div style="border-left: 3px solid #C45A3F; padding-left: 14px; margin: 18px 0;">
      <div style="font-size: 11px; font-weight:700; color: #5f5b54; letter-spacing: 0.08em; text-transform: uppercase;">TL;DR</div>
      <p style="font-family: Georgia, serif; font-size: 17px; margin: 4px 0 0; line-height: 1.35;">${escapeHtml(args.log.summary)}</p>
    </div>
    <div style="font-size: 14px; line-height: 1.55;">
      ${args.log.raw
        .split("\n\n")
        .map((p) => `<p style="margin:0 0 10px;">${escapeHtml(p)}</p>`)
        .join("")}
    </div>
    <div style="border-top: 1px solid #d9d2c4; margin-top: 18px; padding-top: 14px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #5f5b54; font-weight: 700; margin-bottom: 8px;">Actions taken</div>
      ${args.log.actions
        .map(
          (a) => `
        <div style="font-size: 13px; margin-bottom: 6px;">
          <span style="display:inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: ${actionColor(a.kind)}; color: ${actionTextColor(a.kind)};">${escapeHtml(a.kind.replace("_", " "))}</span>
          <span style="color: #5f5b54;">${escapeHtml(a.reason)}</span>
        </div>`,
        )
        .join("")}
    </div>
    <div style="margin-top: 18px; font-size: 11px; color: #5f5b54;">
      Adwise applied ${args.appliedCount} of these on Meta. Sign in to review.
    </div>
  </div>
</body></html>`.trim();

  return send({ to: args.to, subject, text, html });
}

function shortVerdict(log: OptimizationLog): string {
  const up = log.actions.filter((a) => a.kind === "scale_up").length;
  const kill = log.actions.filter(
    (a) => a.kind === "kill" || a.kind === "pause",
  ).length;
  const hold = log.actions.filter((a) => a.kind === "hold").length;
  const parts: string[] = [];
  if (up) parts.push(`${up}↑`);
  if (kill) parts.push(`${kill}✕`);
  if (hold) parts.push(`${hold}⏸`);
  return parts.join(" ") || "no changes";
}

function actionColor(kind: string): string {
  switch (kind) {
    case "scale_up":
      return "#e0ead3";
    case "scale_down":
    case "hold":
      return "#f5e1bb";
    case "kill":
    case "pause":
      return "#f2d3cb";
    default:
      return "#eee6d3";
  }
}

function actionTextColor(kind: string): string {
  switch (kind) {
    case "scale_up":
      return "#2e4a1f";
    case "scale_down":
    case "hold":
      return "#6b4a12";
    case "kill":
    case "pause":
      return "#6b2415";
    default:
      return "#1a1a1a";
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
