import { NextResponse } from "next/server";
import { listClients } from "@/lib/db";

/**
 * Runs the daily optimization pass across every client and applies the
 * actions to Meta. Protected by CRON_SECRET (sent as either a `Bearer` token
 * or `x-cron-secret` header — Vercel cron sends Authorization by default).
 *
 *   Vercel cron: configure the schedule in vercel.json (see repo root).
 *   Any scheduler: curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/optimize-all
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || req.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set on the server. Refusing to run." },
      { status: 500 },
    );
  }
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clients = await listClients();
  const results: Array<{
    clientId: string;
    name: string;
    ok: boolean;
    summary?: string;
    error?: string;
  }> = [];

  for (const c of clients) {
    const hasLive = c.ads.some((a) =>
      ["live", "queued", "winner", "paused"].includes(a.status),
    );
    if (!hasLive) {
      results.push({ clientId: c.id, name: c.name, ok: true, summary: "skipped — no live ads" });
      continue;
    }
    try {
      // Call our own optimize route. Using an absolute URL constructed from
      // the request URL means this works on Vercel, localhost, or wherever.
      const base = new URL(req.url);
      base.pathname = "/api/optimize";
      base.search = "";
      const res = await fetch(base.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: c.id, apply: true }),
      });
      if (!res.ok) throw new Error(`optimize ${res.status}`);
      const { log } = (await res.json()) as { log: { summary: string } };
      results.push({ clientId: c.id, name: c.name, ok: true, summary: log.summary });
    } catch (e) {
      results.push({
        clientId: c.id,
        name: c.name,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    clientCount: clients.length,
    results,
  });
}
