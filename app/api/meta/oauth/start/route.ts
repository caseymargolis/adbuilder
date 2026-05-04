import { NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { getClient } from "@/lib/db";
import {
  buildAuthorizeUrl,
  metaOAuthConfigured,
} from "@/lib/meta-oauth";

/**
 * Kick off the Meta OAuth flow for a specific client.
 *
 *   GET /api/meta/oauth/start?clientId=c_xxx
 *
 * Builds the authorize URL with a signed state token (clientId + nonce,
 * encrypted with AUTH_SECRET so it can't be forged) and 302s the user
 * to Meta. Meta sends them back to /api/meta/oauth/callback with the
 * code + state.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!metaOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Meta OAuth isn't configured on this server. Set META_APP_ID and META_APP_SECRET.",
      },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json(
      { error: "clientId query param is required" },
      { status: 400 },
    );
  }
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nonce = Math.random().toString(36).slice(2, 18);
  const state = encrypt(JSON.stringify({ clientId, nonce, ts: Date.now() }));
  const authorizeUrl = buildAuthorizeUrl({ state });
  return NextResponse.redirect(authorizeUrl);
}
