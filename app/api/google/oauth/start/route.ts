import { NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { getClient } from "@/lib/db";
import {
  buildGoogleAuthorizeUrl,
  googleOAuthConfigured,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google OAuth isn't configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_ADS_DEVELOPER_TOKEN.",
      },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "clientId required" },
      { status: 400 },
    );
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const state = encrypt(
    JSON.stringify({
      clientId,
      ts: Date.now(),
      nonce: Math.random().toString(36).slice(2, 14),
    }),
  );
  return NextResponse.redirect(buildGoogleAuthorizeUrl({ state }));
}
