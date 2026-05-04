import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";

/**
 * Save the user's chosen ad account + page from the OAuth picker.
 *
 *   POST /api/meta/select
 *   { clientId, adAccountId, pageId, adAccountName? }
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId, adAccountId, pageId, adAccountName } =
    (await req.json()) as {
      clientId: string;
      adAccountId: string;
      pageId: string;
      adAccountName?: string;
    };
  if (!clientId || !adAccountId || !pageId) {
    return NextResponse.json(
      { error: "Missing fields" },
      { status: 400 },
    );
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  client.metaAdAccountId = adAccountId;
  client.metaPageId = pageId;
  if (adAccountName) client.metaAccountName = adAccountName;
  await upsertClient(client);
  return NextResponse.json({ ok: true, client });
}
