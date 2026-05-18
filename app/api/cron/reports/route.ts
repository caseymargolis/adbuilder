import { NextResponse } from "next/server";
import { listClients, upsertClient } from "@/lib/db";
import { send } from "@/lib/email";
import { generateReport, renderReportEmail } from "@/lib/reports";
import { hasLiveAds } from "@/lib/ad-utils";

/**
 * Generates and emails reports.
 *
 *   GET /api/cron/reports?audience=client&windowDays=7
 *   GET /api/cron/reports?audience=pm&windowDays=1
 *
 * The vercel.json schedule fires the client one weekly and the pm one
 * daily. Manual hits also work.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth =
    req.headers.get("authorization") ||
    req.headers.get("x-cron-secret") ||
    "";
  const expected = process.env.CRON_SECRET;
  if (!expected)
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  if (auth.replace(/^Bearer\s+/i, "").trim() !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const audience = (url.searchParams.get("audience") ?? "client") as
    | "client"
    | "pm";
  const windowDays = Number(url.searchParams.get("windowDays") ?? "7");

  const clients = await listClients();
  const results: Array<{
    clientId: string;
    name: string;
    sent: boolean;
    note?: string;
  }> = [];

  for (const client of clients) {
    if (client.ads.length === 0 && (client.organicPosts ?? []).length === 0) {
      results.push({
        clientId: client.id,
        name: client.name,
        sent: false,
        note: "skipped — no activity",
      });
      continue;
    }
    if (!hasLiveAds(client)) {
      results.push({
        clientId: client.id,
        name: client.name,
        sent: false,
        note: "skipped — no live campaigns yet",
      });
      continue;
    }
    try {
      const report = await generateReport({ client, audience, windowDays });
      client.reports = [report, ...(client.reports ?? [])].slice(0, 50);
      await upsertClient(client);

      const recipient =
        audience === "client" ? client.clientNotifyEmail : client.notifyEmail;
      if (recipient) {
        const email = renderReportEmail({
          clientName: client.name,
          report,
        });
        await send({
          to: recipient,
          subject: email.subject,
          html: email.html,
          text: email.text,
          fromAgent: "lex",
        });
      }
      results.push({
        clientId: client.id,
        name: client.name,
        sent: !!recipient,
        note: recipient ? undefined : "report saved but no recipient email",
      });
    } catch (e) {
      results.push({
        clientId: client.id,
        name: client.name,
        sent: false,
        note: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), audience, results });
}
