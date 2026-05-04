import { NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/crypto";
import { getClient, upsertClient } from "@/lib/db";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMe,
  META_OAUTH_SCOPES,
  metaOAuthConfigured,
} from "@/lib/meta-oauth";

/**
 * OAuth callback. Meta redirects here with ?code=…&state=….
 *
 *   - Decode + verify the signed state.
 *   - Exchange code → short-lived token → long-lived (~60d) token.
 *   - /me to get the authorizing user's name + id.
 *   - Encrypt the token, persist on the client record.
 *   - Redirect to /clients/[id]/connect-meta to pick ad account + page.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!metaOAuthConfigured()) {
    return NextResponse.json(
      { error: "Meta OAuth isn't configured." },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorReason =
    url.searchParams.get("error_reason") ||
    url.searchParams.get("error_description");

  if (error) {
    // The user canceled or Meta refused. Redirect back to the home page.
    return NextResponse.redirect(
      new URL(
        `/?metaOAuthError=${encodeURIComponent(errorReason || error)}`,
        url,
      ),
    );
  }
  if (!code || !stateParam) {
    return NextResponse.json(
      { error: "Missing code or state." },
      { status: 400 },
    );
  }

  let state: { clientId?: string; nonce?: string; ts?: number };
  try {
    state = JSON.parse(decrypt(stateParam)) as typeof state;
  } catch {
    return NextResponse.json({ error: "Invalid state." }, { status: 400 });
  }
  if (
    !state.clientId ||
    !state.ts ||
    Date.now() - state.ts > 10 * 60 * 1000 // state valid for 10 min
  ) {
    return NextResponse.json({ error: "State expired." }, { status: 400 });
  }

  const client = await getClient(state.clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const shortLived = await exchangeCodeForToken(code);
  const longLived = await exchangeForLongLivedToken(shortLived.accessToken);
  const me = await fetchMe(longLived.accessToken);

  client.metaOAuth = {
    encryptedToken: encrypt(longLived.accessToken),
    expiresAt: new Date(
      Date.now() + longLived.expiresInSec * 1000,
    ).toISOString(),
    scope: META_OAUTH_SCOPES.join(","),
    userId: me.id,
    userName: me.name,
    connectedAt: new Date().toISOString(),
  };
  await upsertClient(client);

  return NextResponse.redirect(
    new URL(`/clients/${client.id}/connect-meta`, url),
  );
}
