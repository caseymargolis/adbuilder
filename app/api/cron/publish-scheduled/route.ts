import { NextResponse } from "next/server";
import { listClients, upsertClient } from "@/lib/db";
import { send } from "@/lib/email";
import { schedulePost } from "@/lib/social-publisher";

/**
 * Run-the-queue cron. Hits Buffer for any posts whose scheduledAt has
 * passed and that haven't been published yet. When Buffer isn't set up,
 * email River-signed copy-paste reminders to the PM.
 *
 *   GET /api/cron/publish-scheduled
 *   Authorization: Bearer $CRON_SECRET
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth =
    req.headers.get("authorization") ||
    req.headers.get("x-cron-secret") ||
    "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }
  if (auth.replace(/^Bearer\s+/i, "").trim() !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const clients = await listClients();
  const events: Array<{ clientId: string; postId: string; ok: boolean; note?: string }> = [];

  for (const client of clients) {
    let mutated = false;
    for (const post of client.organicPosts ?? []) {
      if (post.status !== "scheduled") continue;
      if (!post.scheduledAt) continue;
      if (new Date(post.scheduledAt).getTime() > now) continue;

      const r = await schedulePost(post);
      if (r.ok) {
        post.status = "published";
        post.publishedAt = new Date().toISOString();
        post.externalUrl = r.externalUrl;
        post.bufferUpdateId = r.bufferUpdateId;
        events.push({ clientId: client.id, postId: post.id, ok: true });
      } else {
        // No Buffer configured (or it failed). Email a copy-paste reminder
        // to the PM so the post still gets up.
        if (client.notifyEmail) {
          await send({
            to: client.notifyEmail,
            subject: `Adwise · ${client.name} · Post ready to copy-paste`,
            text: composeReminderText(client.name, post),
            html: composeReminderHtml(client.name, post),
            fromAgent: "river",
          });
        }
        post.status = "failed";
        post.failureReason = r.error;
        events.push({
          clientId: client.id,
          postId: post.id,
          ok: false,
          note: r.error,
        });
      }
      mutated = true;
    }
    if (mutated) await upsertClient(client);
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    processed: events.length,
    events,
  });
}

function composeReminderText(
  clientName: string,
  post: { platform: string; caption: string; hashtags: string[]; mediaUrl?: string },
): string {
  return [
    `Heads up — ${clientName} has a post due now and Buffer isn't wired up.`,
    "",
    `Platform: ${post.platform}`,
    "",
    `${post.caption}`,
    post.hashtags.length ? `\n${post.hashtags.map((h) => `#${h}`).join(" ")}` : "",
    post.mediaUrl ? `\nMedia: ${post.mediaUrl}` : "",
    "",
    "— River, Organic Social",
  ].join("\n");
}

function composeReminderHtml(
  clientName: string,
  post: { platform: string; caption: string; hashtags: string[]; mediaUrl?: string },
): string {
  const tags = post.hashtags.map((h) => `#${h}`).join(" ");
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; background:#fffdf8; border:1px solid #d9d2c4; border-radius:14px; padding:24px;">
  <div style="font-family: Georgia, serif; font-size:22px; font-weight:600;">Adwise<span style="color:#C45A3F">.</span></div>
  <div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#5f5b54; font-weight:700;">${escapeHtml(clientName)} · post due now</div>
  <p style="font-size:13px; color:#5f5b54; margin-top:14px;">Buffer isn't configured, so copy-paste this onto ${escapeHtml(post.platform)}:</p>
  <div style="background:#F4F1EA; border:1px solid #d9d2c4; border-radius:10px; padding:14px; font-size:14px; line-height:1.5; white-space:pre-wrap;">${escapeHtml(post.caption)}${tags ? `\n\n${escapeHtml(tags)}` : ""}</div>
  ${post.mediaUrl ? `<p style="margin-top:14px;"><a href="${post.mediaUrl}" style="color:#C45A3F;">Media asset</a></p>` : ""}
  <p style="margin-top:18px; color:#5f5b54; font-size:12px; font-style:italic;">— River, Organic Social</p>
</div>`.trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
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
