import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";

/**
 * Forget a client's OAuth credentials. We don't revoke the token at Meta;
 * the user can revoke it themselves at facebook.com/settings/business_apps.
 *
 *   POST /api/meta/oauth/disconnect { clientId }
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  client.metaOAuth = undefined;
  await upsertClient(client);
  return NextResponse.json({ ok: true });
}
