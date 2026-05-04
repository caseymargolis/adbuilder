/**
 * Meta OAuth — Business Login flow.
 *
 *   user clicks "Connect Meta"
 *     → /api/meta/oauth/start                   (build authorize URL, redirect)
 *     → facebook.com/.../oauth?...              (Meta auth + consent)
 *     → /api/meta/oauth/callback?code=...       (exchange code → token, encrypt, save)
 *     → /clients/[id]/connect-meta              (pick ad account + page from dropdowns)
 *     → /api/meta/select                        (save the chosen IDs)
 *     → /clients/[id]                           (back to the workspace)
 *
 * Two access tokens get involved:
 *   - Short-lived (~1 hour): what `code` exchanges to.
 *   - Long-lived (~60 days): what we persist. We exchange the short-lived
 *     for the long-lived immediately (fb_exchange_token grant), then store
 *     the long-lived one encrypted at rest.
 *
 * Refresh: Meta long-lived tokens can be refreshed by exchanging the
 * existing (still-valid) long-lived token for a fresh one — there is no
 * `refresh_token` grant. We do this opportunistically when a token is
 * within 7 days of expiring (see `getMetaConfigForClient`).
 *
 * Required Meta app config:
 *   - App ID + App Secret in env (META_APP_ID / META_APP_SECRET)
 *   - Redirect URI (METAOAuthRedirectUri()) added to "Valid OAuth Redirect URIs"
 *   - For non-development users: App Review for ads_management, business_management,
 *     pages_manage_ads. See DEPLOY.md.
 */

const API_VERSION = process.env.META_API_VERSION || "v21.0";

export const META_OAUTH_SCOPES = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "email",
  "public_profile",
];

export function metaOAuthConfigured(): boolean {
  return !!process.env.META_APP_ID && !!process.env.META_APP_SECRET;
}

export function metaOAuthRedirectUri(): string {
  if (process.env.META_OAUTH_REDIRECT_URI) return process.env.META_OAUTH_REDIRECT_URI;
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/api/meta/oauth/callback`;
}

/** Build the URL we redirect the user to for the consent dialog. */
export function buildAuthorizeUrl(args: { state: string }): string {
  const url = new URL(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("redirect_uri", metaOAuthRedirectUri());
  url.searchParams.set("state", args.state);
  url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

interface TokenExchangeResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Exchange the OAuth code for a short-lived access token. */
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  expiresInSec: number;
}> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  url.searchParams.set("redirect_uri", metaOAuthRedirectUri());
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Meta token exchange failed: ${await res.text()}`);
  }
  const data = (await res.json()) as TokenExchangeResponse;
  return {
    accessToken: data.access_token,
    expiresInSec: data.expires_in ?? 3600,
  };
}

/** Trade a short-lived for a long-lived (~60 day) token. */
export async function exchangeForLongLivedToken(
  shortLivedToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("client_secret", process.env.META_APP_SECRET!);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Meta long-lived exchange failed: ${await res.text()}`);
  }
  const data = (await res.json()) as TokenExchangeResponse;
  return {
    accessToken: data.access_token,
    expiresInSec: data.expires_in ?? 60 * 24 * 3600, // default 60d
  };
}

/** /me — who just authorized us. */
export async function fetchMe(
  accessToken: string,
): Promise<{ id: string; name: string; email?: string }> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/me`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,email");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Meta /me failed: ${await res.text()}`);
  return (await res.json()) as { id: string; name: string; email?: string };
}

export interface MetaAdAccountSummary {
  id: string; // act_…
  name: string;
  accountStatus: number;
  currency: string;
  businessId?: string;
  businessName?: string;
}

export interface MetaPageSummary {
  id: string;
  name: string;
  category?: string;
  hasAccessToken: boolean;
}

export async function listAdAccounts(
  accessToken: string,
): Promise<MetaAdAccountSummary[]> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/me/adaccounts`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "fields",
    "id,account_id,name,account_status,currency,business{id,name}",
  );
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Meta /me/adaccounts failed: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      account_id: string;
      name: string;
      account_status: number;
      currency: string;
      business?: { id: string; name: string };
    }>;
  };
  return (data.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    accountStatus: a.account_status,
    currency: a.currency,
    businessId: a.business?.id,
    businessName: a.business?.name,
  }));
}

export async function listPages(
  accessToken: string,
): Promise<MetaPageSummary[]> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}/me/accounts`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,category,access_token");
  url.searchParams.set("limit", "100");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Meta /me/accounts failed: ${await res.text()}`);
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name: string;
      category?: string;
      access_token?: string;
    }>;
  };
  return (data.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    hasAccessToken: !!p.access_token,
  }));
}
