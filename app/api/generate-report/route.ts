import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import { generateReport } from "@/lib/reports";

/**
 * On-demand report generation. Used by the workspace UI's "Client report"
 * and "PM brief" buttons. The cron at /api/cron/reports also calls this
 * code path under the hood.
 */
export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const { clientId, audience, windowDays } = (await req.json()) as {
    clientId: string;
    audience: "client" | "pm";
    windowDays?: number;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const report = await generateReport({
    client,
    audience,
    windowDays: windowDays ?? (audience === "client" ? 7 : 1),
  });
  client.reports = [report, ...(client.reports ?? [])].slice(0, 50);
  await upsertClient(client);

  return NextResponse.json({ report });
}
