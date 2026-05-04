import { NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto";
import { getClient } from "@/lib/db";
import { listAdAccounts, listPages } from "@/lib/meta-oauth";

/**
 * Returns the ad accounts and pages the OAuth-connected user has access to.
 * Used by the picker UI after the OAuth callback.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  const client = await getClient(clientId);
  if (!client?.metaOAuth) {
    return NextResponse.json(
      { error: "This client isn't connected via OAuth." },
      { status: 400 },
    );
  }
  let accessToken: string;
  try {
    accessToken = decrypt(client.metaOAuth.encryptedToken);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt token. Re-connect to Meta." },
      { status: 500 },
    );
  }
  try {
    const [adAccounts, pages] = await Promise.all([
      listAdAccounts(accessToken),
      listPages(accessToken),
    ]);
    return NextResponse.json({ adAccounts, pages });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
