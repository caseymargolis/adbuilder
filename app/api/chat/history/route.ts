import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import type { AgentId } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "Missing clientId" }, { status: 400 });
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const threads = client.chatThreads ?? {};
  return NextResponse.json({ threads, updatedAt: client.chatUpdatedAt });
}

export async function POST(req: Request) {
  const { clientId, threads } = (await req.json()) as {
    clientId: string;
    threads: Record<AgentId, Array<{ role: "user" | "assistant"; content: string }>>;
  };
  if (!clientId || !threads) {
    return NextResponse.json({ error: "Missing clientId or threads" }, { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Basic limits to avoid unbounded growth
  const pruned: typeof threads = Object.fromEntries(
    Object.entries(threads).map(([agent, msgs]) => [
      agent as AgentId,
      msgs.slice(-100).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 16000),
      })),
    ]),
  ) as typeof threads;

  client.chatThreads = pruned;
  client.chatUpdatedAt = new Date().toISOString();
  await upsertClient(client);
  return NextResponse.json({ ok: true });
}
