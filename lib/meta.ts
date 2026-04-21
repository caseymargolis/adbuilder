/**
 * Meta Marketing API client — thin wrapper.
 *
 * Docs: https://developers.facebook.com/docs/marketing-apis/
 *
 * This wrapper keeps the shape small. It handles the four things the app
 * actually does right now:
 *   1. Create a campaign
 *   2. Create an ad set (targeting + budget)
 *   3. Create an ad creative + ad
 *   4. Pull ad-level insights (impressions, clicks, spend, conversions)
 *
 * When Meta credentials aren't configured, every method returns a "mock"
 * response tagged `mock: true` so the rest of the pipeline can run end-to-end
 * in dev. The UI surfaces this clearly so nobody thinks they're spending money.
 */

import type { AdCreative, AdMetrics, ClientGoal } from "./types";

const API_VERSION = process.env.META_API_VERSION || "v21.0";

export interface MetaConfig {
  accessToken: string;
  adAccountId: string;
  pageId: string;
}

export function getMetaConfig(): MetaConfig | null {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pageId = process.env.META_PAGE_ID;
  if (!accessToken || !adAccountId || !pageId) return null;
  return { accessToken, adAccountId, pageId };
}

export function metaConfigured(): boolean {
  return getMetaConfig() !== null;
}

function goalToObjective(goal: ClientGoal): string {
  // Meta's outcome-based objectives (ODAX).
  switch (goal) {
    case "leads":
      return "OUTCOME_LEADS";
    case "sales":
      return "OUTCOME_SALES";
    case "traffic":
      return "OUTCOME_TRAFFIC";
    case "awareness":
      return "OUTCOME_AWARENESS";
    case "app_installs":
      return "OUTCOME_APP_PROMOTION";
    case "messages":
      return "OUTCOME_ENGAGEMENT";
  }
}

async function metaFetch<T>(
  path: string,
  init: RequestInit & { params?: Record<string, string> },
): Promise<T> {
  const config = getMetaConfig();
  if (!config) throw new Error("Meta is not configured.");
  const url = new URL(`https://graph.facebook.com/${API_VERSION}${path}`);
  for (const [k, v] of Object.entries(init.params ?? {})) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set("access_token", config.accessToken);
  const res = await fetch(url.toString(), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta API ${res.status}: ${errText.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export async function createCampaign(args: {
  name: string;
  goal: ClientGoal;
  dailyBudgetUsd: number;
}): Promise<{ id: string; mock?: boolean }> {
  const config = getMetaConfig();
  if (!config) return { id: `mock_campaign_${Date.now()}`, mock: true };

  return metaFetch<{ id: string }>(`/${config.adAccountId}/campaigns`, {
    method: "POST",
    params: {
      name: args.name,
      objective: goalToObjective(args.goal),
      status: "PAUSED", // safety: always launch paused; user flips live
      special_ad_categories: "[]",
      daily_budget: String(Math.round(args.dailyBudgetUsd * 100)), // cents
    },
  });
}

export async function createAdSet(args: {
  campaignId: string;
  name: string;
  dailyBudgetUsd: number;
  goal: ClientGoal;
  audienceNotes: string;
}): Promise<{ id: string; mock?: boolean }> {
  const config = getMetaConfig();
  if (!config) return { id: `mock_adset_${Date.now()}`, mock: true };

  // Baseline targeting: broad. Meta's algo works better with broad targeting
  // on recent API versions; narrowing should be driven by data, not vibes.
  const targeting = {
    geo_locations: { countries: ["US"] },
    age_min: 18,
    age_max: 65,
    publisher_platforms: ["facebook", "instagram"],
  };

  return metaFetch<{ id: string }>(`/${config.adAccountId}/adsets`, {
    method: "POST",
    params: {
      name: args.name,
      campaign_id: args.campaignId,
      daily_budget: String(Math.round(args.dailyBudgetUsd * 100)),
      billing_event: "IMPRESSIONS",
      optimization_goal:
        args.goal === "leads"
          ? "LEAD_GENERATION"
          : args.goal === "sales"
            ? "OFFSITE_CONVERSIONS"
            : args.goal === "traffic"
              ? "LINK_CLICKS"
              : "REACH",
      status: "PAUSED",
      targeting: JSON.stringify(targeting),
      start_time: new Date().toISOString(),
    },
  });
}

export async function createAd(args: {
  adSetId: string;
  name: string;
  creative: AdCreative;
  imageUrl: string;
}): Promise<{ id: string; creativeId: string; mock?: boolean }> {
  const config = getMetaConfig();
  if (!config) {
    return {
      id: `mock_ad_${Date.now()}`,
      creativeId: `mock_creative_${Date.now()}`,
      mock: true,
    };
  }

  // Create the creative
  const creative = await metaFetch<{ id: string }>(
    `/${config.adAccountId}/adcreatives`,
    {
      method: "POST",
      params: {
        name: args.name,
        object_story_spec: JSON.stringify({
          page_id: config.pageId,
          link_data: {
            link: args.creative.destinationUrl,
            message: args.creative.primaryText,
            name: args.creative.headline,
            description: args.creative.description,
            call_to_action: { type: args.creative.cta },
            picture: args.imageUrl,
          },
        }),
      },
    },
  );

  const ad = await metaFetch<{ id: string }>(`/${config.adAccountId}/ads`, {
    method: "POST",
    params: {
      name: args.name,
      adset_id: args.adSetId,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: "PAUSED",
    },
  });

  return { id: ad.id, creativeId: creative.id };
}

export async function pauseAd(adId: string): Promise<{ mock?: boolean }> {
  if (adId.startsWith("mock_")) return { mock: true };
  await metaFetch<unknown>(`/${adId}`, {
    method: "POST",
    params: { status: "PAUSED" },
  });
  return {};
}

export async function resumeAd(adId: string): Promise<{ mock?: boolean }> {
  if (adId.startsWith("mock_")) return { mock: true };
  await metaFetch<unknown>(`/${adId}`, {
    method: "POST",
    params: { status: "ACTIVE" },
  });
  return {};
}

export async function updateAdBudget(args: {
  adSetId: string;
  dailyBudgetUsd: number;
}): Promise<{ mock?: boolean }> {
  if (args.adSetId.startsWith("mock_")) return { mock: true };
  await metaFetch<unknown>(`/${args.adSetId}`, {
    method: "POST",
    params: {
      daily_budget: String(Math.round(args.dailyBudgetUsd * 100)),
    },
  });
  return {};
}

export async function getAdMetrics(
  adId: string,
): Promise<AdMetrics & { mock?: boolean }> {
  if (adId.startsWith("mock_") || !metaConfigured()) {
    // Deterministic-ish mock based on the ID so the UI has something to show.
    const seed = hash(adId);
    const impressions = 2000 + (seed % 8000);
    const clicks = Math.round(impressions * (0.006 + ((seed % 100) / 100) * 0.02));
    const spend = 20 + (seed % 60);
    const conversions = Math.round(clicks * (0.02 + ((seed % 50) / 1000)));
    const metrics: AdMetrics = {
      impressions,
      clicks,
      spend,
      conversions,
      ctr: clicks / impressions,
      cpc: spend / Math.max(clicks, 1),
      cpa: spend / Math.max(conversions, 1),
      frequency: 1 + ((seed % 35) / 10),
      updatedAt: new Date().toISOString(),
    };
    return { ...metrics, mock: true };
  }

  type Insight = {
    impressions: string;
    clicks: string;
    spend: string;
    actions?: Array<{ action_type: string; value: string }>;
    ctr: string;
    cpc: string;
    frequency: string;
  };

  const res = await metaFetch<{ data: Insight[] }>(`/${adId}/insights`, {
    method: "GET",
    params: {
      fields: "impressions,clicks,spend,actions,ctr,cpc,frequency",
      date_preset: "last_7d",
    },
  });
  const i = res.data[0];
  if (!i) {
    return {
      impressions: 0,
      clicks: 0,
      spend: 0,
      conversions: 0,
      ctr: 0,
      cpc: 0,
      cpa: 0,
      frequency: 0,
      updatedAt: new Date().toISOString(),
    };
  }
  const impressions = Number(i.impressions);
  const clicks = Number(i.clicks);
  const spend = Number(i.spend);
  const conversions = Number(
    i.actions?.find((a) => a.action_type === "offsite_conversion")?.value ?? "0",
  );
  return {
    impressions,
    clicks,
    spend,
    conversions,
    ctr: Number(i.ctr) / 100,
    cpc: Number(i.cpc),
    cpa: conversions > 0 ? spend / conversions : 0,
    frequency: Number(i.frequency),
    updatedAt: new Date().toISOString(),
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
