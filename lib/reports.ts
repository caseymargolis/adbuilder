/**
 * Reports — written by Lex.
 *
 *   - Weekly client-facing report. Audience: business owner. No jargon.
 *     Emailed to clientNotifyEmail. Signed by Lex.
 *   - Daily PM ops brief. Audience: human PM. Dense, action-oriented.
 *     Emailed to notifyEmail.
 *
 * Both pull from the same data. The system prompts (CLIENT_REPORT_SYSTEM
 * and PM_REPORT_SYSTEM) push the model toward two registers of the same
 * voice.
 */

import { askJson } from "./anthropic";
import { AGENTS } from "./agents";
import { newId } from "./db";
import { CLIENT_REPORT_SYSTEM, PM_REPORT_SYSTEM } from "./prompts";
import type { ClientRecord, Report, ReportAudience } from "./types";

interface GeneratedReport {
  tldr: string;
  highlights: string[];
  bodyHtml: string;
  bodyText: string;
}

export async function generateReport(args: {
  client: ClientRecord;
  audience: ReportAudience;
  windowDays: number;
}): Promise<Report> {
  const { client, audience, windowDays } = args;
  const periodEnd = new Date();
  const periodStart = new Date(
    periodEnd.getTime() - windowDays * 24 * 60 * 60 * 1000,
  );

  const liveAds = client.ads.filter((a) =>
    ["live", "queued", "winner", "paused"].includes(a.status),
  );

  const totals = liveAds.reduce(
    (acc, ad) => {
      const m = ad.metrics;
      if (!m) return acc;
      return {
        spend: acc.spend + m.spend,
        clicks: acc.clicks + m.clicks,
        conversions: acc.conversions + m.conversions,
        impressions: acc.impressions + m.impressions,
      };
    },
    { spend: 0, clicks: 0, conversions: 0, impressions: 0 },
  );

  const recentOptimizations = client.optimizations.slice(0, 3);
  const recentPosts = (client.organicPosts ?? [])
    .filter(
      (p) =>
        p.publishedAt && new Date(p.publishedAt) >= periodStart,
    )
    .slice(0, 12);

  const user = [
    `CLIENT: ${client.name}`,
    `Period: ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    `Audience for THIS report: ${audience} (${audience === "client" ? "business owner — no jargon, outcomes only" : "PM — every number, every decision"})`,
    "",
    "TOTALS",
    `- Spend: $${totals.spend.toFixed(2)}`,
    `- Conversions: ${totals.conversions}`,
    `- Clicks: ${totals.clicks}`,
    `- Impressions: ${totals.impressions}`,
    `- Blended CPA: ${
      totals.conversions > 0
        ? `$${(totals.spend / totals.conversions).toFixed(2)}`
        : "—"
    }`,
    "",
    "PER-AD",
    ...liveAds.map((a) => {
      const m = a.metrics;
      return [
        `- ${a.id} status=${a.status} platform=${a.platform ?? "meta"} angle="${a.creative.angle}"`,
        m
          ? `    spend=$${m.spend.toFixed(2)} ctr=${(m.ctr * 100).toFixed(2)}% cpa=$${m.cpa.toFixed(2)} conv=${m.conversions} freq=${m.frequency.toFixed(2)}`
          : "    no metrics",
      ].join("\n");
    }),
    "",
    "RECENT OPTIMIZATION ACTIONS (last 3 passes):",
    ...recentOptimizations.map(
      (o) => `- ${o.at}: ${o.summary}`,
    ),
    "",
    "ORGANIC POSTS PUBLISHED IN THIS WINDOW:",
    ...recentPosts.map(
      (p) =>
        `- ${p.platform} on ${p.publishedAt}: "${p.caption.slice(0, 80)}…" (${p.angle})`,
    ),
    "",
    `Write the ${audience} report.`,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await askJson<GeneratedReport>({
    system:
      audience === "client" ? CLIENT_REPORT_SYSTEM : PM_REPORT_SYSTEM,
    user,
    task: "strategy",
    maxTokens: 6000,
  });

  // Stamp Lex's signature on every email body that doesn't already include
  // one — keeps the persona consistent in the client's inbox.
  const sig = AGENTS.lex.signature;
  const html = data.bodyHtml.includes("Lex")
    ? data.bodyHtml
    : `${data.bodyHtml}\n<p style="margin-top:18px;color:#5f5b54;font-size:12px;font-style:italic;">${sig}</p>`;
  const text = data.bodyText.includes("Lex")
    ? data.bodyText
    : `${data.bodyText}\n\n${sig}`;

  return {
    id: newId(audience === "client" ? "rc" : "rp"),
    clientId: client.id,
    audience,
    generatedAt: new Date().toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    tldr: data.tldr,
    highlights: data.highlights,
    bodyHtml: html,
    bodyText: text,
  };
}

/** Wrap a report's bodyHtml in a lightly-styled email shell. */
export function renderReportEmail(args: {
  clientName: string;
  report: Report;
}): { subject: string; html: string; text: string } {
  const { clientName, report } = args;
  const subject =
    report.audience === "client"
      ? `Adwise · This week at ${clientName}`
      : `Adwise · ${clientName} ops brief — ${new Date().toLocaleDateString()}`;
  const html = `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#F4F1EA; color:#1a1a1a; padding: 20px; margin:0;">
  <div style="max-width: 580px; margin: 0 auto; background:#fffdf8; border:1px solid #d9d2c4; border-radius: 14px; padding: 28px;">
    <div style="font-family: Georgia, serif; font-size: 22px; font-weight: 600; margin-bottom: 4px;">Adwise<span style="color:#C45A3F">.</span></div>
    <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #5f5b54; font-weight: 700;">${
      report.audience === "client" ? "Weekly recap" : "Daily ops brief"
    } · ${escapeHtml(clientName)}</div>
    <div style="border-left: 3px solid #C45A3F; padding-left: 14px; margin: 18px 0;">
      <div style="font-size: 11px; font-weight:700; color: #5f5b54; letter-spacing: 0.08em; text-transform: uppercase;">TL;DR</div>
      <p style="font-family: Georgia, serif; font-size: 17px; margin: 4px 0 0; line-height: 1.35;">${escapeHtml(report.tldr)}</p>
    </div>
    ${
      report.highlights.length > 0
        ? `<ul style="padding-left: 18px; margin: 0 0 18px 0;">${report.highlights
            .map(
              (h) =>
                `<li style="margin-bottom: 6px; font-size: 14px;">${escapeHtml(h)}</li>`,
            )
            .join("")}</ul>`
        : ""
    }
    ${report.bodyHtml}
  </div>
</body></html>`.trim();
  const text = `${report.tldr}\n\n${report.highlights
    .map((h) => `· ${h}`)
    .join("\n")}\n\n${report.bodyText}`;
  return { subject, html, text };
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
