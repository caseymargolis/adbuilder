/**
 * Google Ads API client (v18).
 *
 * Docs: https://developers.google.com/google-ads/api/docs/start
 *
 * This wrapper handles the four operations the app actually needs:
 *   1. List accessible customers (after OAuth, for the picker)
 *   2. Create a Search campaign + ad group + Responsive Search Ad (RSA)
 *   3. Pull metrics via GAQL (the SQL-like Google Ads Query Language)
 *   4. Status / budget mutations from the optimizer
 *
 * All Google Ads requests need:
 *   - Bearer access_token (refreshed via lib/google-oauth)
 *   - developer-token header
 *   - login-customer-id when accessing via a manager (MCC)
 *
 * The auth + dev-token plumbing lives here; callers pass a GoogleClient
 * built once per request via `clientForGoogle()`.
 */

import { decrypt, encrypt } from "./crypto";
import { refreshGoogleAccessToken } from "./google-oauth";
import type { ClientGoal, ClientRecord, GoogleRsaCreative } from "./types";

const API_VERSION = "v18";
const BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export interface GoogleClient {
  accessToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
}

/**
 * Build a GoogleClient for a ClientRecord. Refreshes the access token if
 * it's missing or expired. When the token is refreshed the client's stored
 * encrypted access token is updated via the onRefreshed callback so we
 * don't pay the refresh cost on every request.
 */
export async function clientForGoogle(
  client: ClientRecord,
  onRefreshed?: (next: NonNullable<ClientRecord["googleOAuth"]>) => Promise<void>,
): Promise<GoogleClient | null> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return null;
  if (!client.googleOAuth || !client.googleAds?.customerId) return null;

  let accessToken: string | null = null;
  if (
    client.googleOAuth.encryptedAccessToken &&
    client.googleOAuth.accessTokenExpiresAt &&
    new Date(client.googleOAuth.accessTokenExpiresAt).getTime() >
      Date.now() + 60_000
  ) {
    try {
      accessToken = decrypt(client.googleOAuth.encryptedAccessToken);
    } catch {
      // fall through to refresh
    }
  }

  if (!accessToken) {
    const refreshToken = decrypt(client.googleOAuth.encryptedRefreshToken);
    const refreshed = await refreshGoogleAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    if (onRefreshed) {
      await onRefreshed({
        ...client.googleOAuth,
        encryptedAccessToken: encrypt(refreshed.access_token),
        accessTokenExpiresAt: new Date(
          Date.now() + refreshed.expires_in * 1000,
        ).toISOString(),
        lastRefreshedAt: new Date().toISOString(),
      });
    }
  }

  return {
    accessToken,
    developerToken,
    customerId: client.googleAds.customerId,
    loginCustomerId: client.googleAds.loginCustomerId,
  };
}

function googleHeaders(g: GoogleClient): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${g.accessToken}`,
    "developer-token": g.developerToken,
    "Content-Type": "application/json",
  };
  if (g.loginCustomerId) h["login-customer-id"] = g.loginCustomerId;
  return h;
}

// ---------------------------------------------------------------------------
// Customer discovery (for the OAuth picker)
// ---------------------------------------------------------------------------

export interface AccessibleCustomer {
  resourceName: string; // "customers/123…"
  customerId: string;
  descriptiveName?: string;
  currencyCode?: string;
  manager?: boolean;
}

export async function listAccessibleCustomers(
  accessToken: string,
): Promise<AccessibleCustomer[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return [];
  const res = await fetch(
    `${BASE}/customers:listAccessibleCustomers`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`listAccessibleCustomers: ${await res.text()}`);
  }
  const data = (await res.json()) as { resourceNames?: string[] };
  const resourceNames = data.resourceNames ?? [];

  // Hydrate each with a customer.get for descriptive_name + currency.
  const enriched = await Promise.all(
    resourceNames.map(async (rn): Promise<AccessibleCustomer> => {
      const customerId = rn.split("/")[1];
      try {
        const cres = await fetch(`${BASE}/${rn}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": developerToken,
          },
        });
        if (!cres.ok) {
          return { resourceName: rn, customerId };
        }
        const c = (await cres.json()) as {
          descriptiveName?: string;
          currencyCode?: string;
          manager?: boolean;
        };
        return {
          resourceName: rn,
          customerId,
          descriptiveName: c.descriptiveName,
          currencyCode: c.currencyCode,
          manager: c.manager,
        };
      } catch {
        return { resourceName: rn, customerId };
      }
    }),
  );
  return enriched;
}

// ---------------------------------------------------------------------------
// Campaign + ad group + RSA creation
// ---------------------------------------------------------------------------

const GOAL_TO_CHANNEL: Record<ClientGoal, string> = {
  leads: "SEARCH",
  sales: "SEARCH",
  traffic: "SEARCH",
  awareness: "DISPLAY",
  app_installs: "DISPLAY",
  messages: "SEARCH",
};

const GOAL_TO_BIDDING: Record<ClientGoal, "MAXIMIZE_CONVERSIONS" | "TARGET_SPEND" | "MAXIMIZE_CLICKS"> = {
  leads: "MAXIMIZE_CONVERSIONS",
  sales: "MAXIMIZE_CONVERSIONS",
  traffic: "MAXIMIZE_CLICKS",
  awareness: "MAXIMIZE_CLICKS",
  app_installs: "MAXIMIZE_CLICKS",
  messages: "MAXIMIZE_CLICKS",
};

/**
 * Create a paused campaign with a fresh budget. Returns the campaign and
 * budget resource names — caller stores them for downstream mutations.
 */
export async function createGoogleCampaign(
  g: GoogleClient,
  args: { name: string; goal: ClientGoal; dailyBudgetUsd: number },
): Promise<{ campaign: string; budget: string }> {
  // Two mutates because campaign requires a budget reference. We do both
  // in a single mutate-by-resource batch for atomicity.
  const budgetTempId = -1;

  const operations = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: `customers/${g.customerId}/campaignBudgets/${budgetTempId}`,
          name: `${args.name} budget`,
          amountMicros: String(Math.round(args.dailyBudgetUsd * 1_000_000)),
          deliveryMethod: "STANDARD",
        },
      },
    },
    {
      campaignOperation: {
        create: {
          name: args.name,
          status: "PAUSED",
          advertisingChannelType: GOAL_TO_CHANNEL[args.goal],
          campaignBudget: `customers/${g.customerId}/campaignBudgets/${budgetTempId}`,
          ...(GOAL_TO_BIDDING[args.goal] === "MAXIMIZE_CONVERSIONS"
            ? { maximizeConversions: {} }
            : { manualCpc: { enhancedCpcEnabled: false } }),
          networkSettings:
            GOAL_TO_CHANNEL[args.goal] === "SEARCH"
              ? {
                  targetGoogleSearch: true,
                  targetSearchNetwork: true,
                  targetContentNetwork: false,
                  targetPartnerSearchNetwork: false,
                }
              : {
                  targetGoogleSearch: false,
                  targetSearchNetwork: false,
                  targetContentNetwork: true,
                },
        },
      },
    },
  ];

  const res = await fetch(
    `${BASE}/customers/${g.customerId}/googleAds:mutate`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({ mutateOperations: operations }),
    },
  );
  if (!res.ok) {
    throw new Error(`Google createCampaign: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    mutateOperationResponses?: Array<{
      campaignBudgetResult?: { resourceName: string };
      campaignResult?: { resourceName: string };
    }>;
  };
  const budget = data.mutateOperationResponses?.[0]?.campaignBudgetResult
    ?.resourceName;
  const campaign = data.mutateOperationResponses?.[1]?.campaignResult
    ?.resourceName;
  if (!budget || !campaign) {
    throw new Error("Campaign creation returned no resource names.");
  }
  return { budget, campaign };
}

export async function createGoogleAdGroup(
  g: GoogleClient,
  args: { campaignResource: string; name: string; cpcBidUsd?: number },
): Promise<{ resourceName: string }> {
  const res = await fetch(
    `${BASE}/customers/${g.customerId}/adGroups:mutate`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({
        operations: [
          {
            create: {
              name: args.name,
              campaign: args.campaignResource,
              status: "PAUSED",
              type: "SEARCH_STANDARD",
              cpcBidMicros: args.cpcBidUsd
                ? String(Math.round(args.cpcBidUsd * 1_000_000))
                : undefined,
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`Google adGroup: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{ resourceName: string }>;
  };
  const resourceName = data.results?.[0]?.resourceName;
  if (!resourceName) throw new Error("adGroup mutate returned no result.");
  return { resourceName };
}

export async function createResponsiveSearchAd(
  g: GoogleClient,
  args: { adGroupResource: string; rsa: GoogleRsaCreative },
): Promise<{ resourceName: string }> {
  const res = await fetch(
    `${BASE}/customers/${g.customerId}/adGroupAds:mutate`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({
        operations: [
          {
            create: {
              adGroup: args.adGroupResource,
              status: "PAUSED",
              ad: {
                finalUrls: [args.rsa.finalUrl],
                responsiveSearchAd: {
                  headlines: args.rsa.headlines.map((t) => ({ text: t.slice(0, 30) })),
                  descriptions: args.rsa.descriptions.map((t) => ({
                    text: t.slice(0, 90),
                  })),
                  path1: args.rsa.path1?.slice(0, 15),
                  path2: args.rsa.path2?.slice(0, 15),
                },
              },
            },
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`Google RSA: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{ resourceName: string }>;
  };
  const resourceName = data.results?.[0]?.resourceName;
  if (!resourceName) throw new Error("adGroupAd mutate returned no result.");
  return { resourceName };
}

// ---------------------------------------------------------------------------
// Metrics via GAQL
// ---------------------------------------------------------------------------

export interface GoogleAdMetrics {
  impressions: number;
  clicks: number;
  costUsd: number;
  conversions: number;
  ctr: number;
  averageCpc: number;
  cpa: number;
}

export async function getGoogleAdMetrics(
  g: GoogleClient,
  adGroupAdResource: string,
): Promise<GoogleAdMetrics> {
  const adGroupAdId = adGroupAdResource.split("~")[1];
  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group_ad
    WHERE ad_group_ad.ad.id = ${adGroupAdId}
      AND segments.date DURING LAST_7_DAYS
  `;
  const res = await fetch(
    `${BASE}/customers/${g.customerId}/googleAds:search`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) throw new Error(`Google insights: ${await res.text()}`);
  const data = (await res.json()) as {
    results?: Array<{
      metrics?: {
        impressions?: string;
        clicks?: string;
        costMicros?: string;
        conversions?: number;
        ctr?: number;
        averageCpc?: string;
      };
    }>;
  };
  const m = data.results?.[0]?.metrics;
  if (!m) {
    return {
      impressions: 0,
      clicks: 0,
      costUsd: 0,
      conversions: 0,
      ctr: 0,
      averageCpc: 0,
      cpa: 0,
    };
  }
  const cost = Number(m.costMicros ?? 0) / 1_000_000;
  const clicks = Number(m.clicks ?? 0);
  const conversions = Number(m.conversions ?? 0);
  return {
    impressions: Number(m.impressions ?? 0),
    clicks,
    costUsd: cost,
    conversions,
    ctr: Number(m.ctr ?? 0),
    averageCpc: Number(m.averageCpc ?? 0) / 1_000_000,
    cpa: conversions > 0 ? cost / conversions : 0,
  };
}

// ---------------------------------------------------------------------------
// Status / budget mutations (used by the optimizer)
// ---------------------------------------------------------------------------

export async function setGoogleAdStatus(
  g: GoogleClient,
  adGroupAdResource: string,
  status: "ENABLED" | "PAUSED" | "REMOVED",
): Promise<void> {
  const res = await fetch(
    `${BASE}/customers/${g.customerId}/adGroupAds:mutate`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({
        operations: [
          {
            update: { resourceName: adGroupAdResource, status },
            updateMask: "status",
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`Google setAdStatus: ${await res.text()}`);
}

export async function setGoogleCampaignBudget(
  g: GoogleClient,
  budgetResource: string,
  dailyBudgetUsd: number,
): Promise<void> {
  const res = await fetch(
    `${BASE}/customers/${g.customerId}/campaignBudgets:mutate`,
    {
      method: "POST",
      headers: googleHeaders(g),
      body: JSON.stringify({
        operations: [
          {
            update: {
              resourceName: budgetResource,
              amountMicros: String(Math.round(dailyBudgetUsd * 1_000_000)),
            },
            updateMask: "amount_micros",
          },
        ],
      }),
    },
  );
  if (!res.ok) throw new Error(`Google setBudget: ${await res.text()}`);
}
