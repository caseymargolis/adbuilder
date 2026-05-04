import { NextResponse } from "next/server";
import { decrypt } from "@/lib/crypto";
import { getClient } from "@/lib/db";
import { listAccessibleCustomers } from "@/lib/google-ads";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId)
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const client = await getClient(clientId);
  if (!client?.googleOAuth) {
    return NextResponse.json(
      { error: "Not connected to Google." },
      { status: 400 },
    );
  }
  try {
    const refreshToken = decrypt(client.googleOAuth.encryptedRefreshToken);
    const tokens = await refreshGoogleAccessToken(refreshToken);
    const customers = await listAccessibleCustomers(tokens.access_token);
    return NextResponse.json({ customers });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
