import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId, customerId, loginCustomerId, customerName } =
    (await req.json()) as {
      clientId: string;
      customerId: string;
      loginCustomerId?: string;
      customerName?: string;
    };
  if (!clientId || !customerId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  client.googleAds = { customerId, loginCustomerId, customerName };
  await upsertClient(client);
  return NextResponse.json({ ok: true, client });
}
