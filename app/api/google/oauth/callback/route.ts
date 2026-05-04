import { NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/crypto";
import { getClient, upsertClient } from "@/lib/db";
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  googleOAuthConfigured,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!googleOAuthConfigured()) {
    return NextResponse.json(
      { error: "Google OAuth not configured" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/?googleOAuthError=${encodeURIComponent(error)}`, url),
    );
  }
  if (!code || !stateParam) {
    return NextResponse.json({ error: "Missing code/state" }, { status: 400 });
  }
  let state: { clientId?: string; ts?: number };
  try {
    state = JSON.parse(decrypt(stateParam));
  } catch {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  if (
    !state.clientId ||
    !state.ts ||
    Date.now() - state.ts > 10 * 60 * 1000
  ) {
    return NextResponse.json({ error: "State expired" }, { status: 400 });
  }
  const client = await getClient(state.clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  const tokens = await exchangeGoogleCode(code);
  if (!tokens.refresh_token) {
    // Typically means the user already granted before and didn't get a fresh
    // refresh_token. We force prompt=consent in start, which should always
    // mint one. If it's still missing, ask them to re-connect with revoke.
    return NextResponse.redirect(
      new URL(
        `/?googleOAuthError=${encodeURIComponent("No refresh token returned. Revoke access at https://myaccount.google.com/permissions and try again.")}`,
        url,
      ),
    );
  }
  const me = await fetchGoogleUserInfo(tokens.access_token);

  client.googleOAuth = {
    encryptedRefreshToken: encrypt(tokens.refresh_token),
    encryptedAccessToken: encrypt(tokens.access_token),
    accessTokenExpiresAt: new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString(),
    scope: tokens.scope,
    email: me.email,
    connectedAt: new Date().toISOString(),
  };
  // Add "google" to platforms list if not already there
  client.platforms = Array.from(new Set([...(client.platforms ?? []), "google"]));
  await upsertClient(client);

  return NextResponse.redirect(
    new URL(`/clients/${client.id}/connect-google`, url),
  );
}
