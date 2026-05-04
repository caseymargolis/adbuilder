import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  client.googleOAuth = undefined;
  client.googleAds = undefined;
  client.platforms = (client.platforms ?? []).filter((p) => p !== "google");
  await upsertClient(client);
  return NextResponse.json({ ok: true });
}
