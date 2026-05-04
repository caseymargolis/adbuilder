/**
 * Google Ads OAuth.
 *
 * Auth model is different from Meta:
 *   - Google OAuth gives us an access_token (1 hour) + refresh_token (long-lived).
 *   - We persist the refresh_token encrypted; access tokens are minted on demand
 *     and cached for 50 minutes.
 *   - Google Ads API additionally requires a developer-token header
 *     (GOOGLE_ADS_DEVELOPER_TOKEN) — this is at the app level, not per user.
 *
 * Required Google Cloud + Google Ads setup:
 *   - GCP project with the Google Ads API enabled
 *   - OAuth consent screen with the Google Ads scope
 *   - OAuth client ID + client secret
 *   - Google Ads developer token (apply at ads.google.com/aw/apicenter)
 *
 * See DEPLOY.md.
 */

const SCOPES = ["https://www.googleapis.com/auth/adwords"];

export function googleOAuthConfigured(): boolean {
  return (
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  );
}

export function googleOAuthRedirectUri(): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI)
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/api/google/oauth/callback`;
}

export function buildGoogleAuthorizeUrl(args: { state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_OAUTH_CLIENT_ID!);
  url.searchParams.set("redirect_uri", googleOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); // gets a refresh_token
  url.searchParams.set("prompt", "consent"); // force the refresh_token even if previously granted
  url.searchParams.set("state", args.state);
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function exchangeGoogleCode(
  code: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: googleOAuthRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange: ${await res.text()}`);
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google refresh: ${await res.text()}`);
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<{ email: string; name?: string }> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return { email: "" };
  }
  return (await res.json()) as { email: string; name?: string };
}
