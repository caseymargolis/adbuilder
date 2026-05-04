/**
 * Meta Marketing API client.
 *
 * Architecture:
 *   - One Meta Business Manager / System User access token (env var,
 *     shared across all clients — this is how agencies actually run).
 *   - Per-client ad account ID + page ID, stored on the ClientRecord.
 *
 * That matches the System User pattern Meta recommends: long-lived token
 * at the agency level, per-client targeting via ad account selection.
 *
 * Docs:
 *   https://developers.facebook.com/docs/marketing-api/
 *   https://developers.facebook.com/docs/marketing-api/reference/ad-image
 *   https://developers.facebook.com/docs/marketing-api/reference/ad-video
 *
 * When credentials are not configured, every method returns a `mock: true`
 * response so the rest of the pipeline runs end-to-end in dev. The UI
 * surfaces this clearly so nobody thinks they're spending money.
 */

import type { AdCreative, AdMetrics, ClientGoal } from "./types";

const API_VERSION = process.env.META_API_VERSION || "v21.0";

export interface MetaConfig {
  accessToken: string;
  adAccountId: string;
  pageId: string;
}

/**
 * Build a Meta config from per-client overrides + env-var defaults.
 * Order:
 *   1. Per-client overrides (client.metaAdAccountId / metaPageId).
 *      Access token is always taken from env (shared System User token).
 *   2. Env vars META_AD_ACCOUNT_ID / META_PAGE_ID as account-wide default.
 *      Useful for single-tenant or development.
 *
 * Returns null when no usable config is available — callers should treat
 * that as "mock mode".
 */
export function getMetaConfig(opts?: {
  adAccountId?: string;
  pageId?: string;
}): MetaConfig | null {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = opts?.adAccountId || process.env.META_AD_ACCOUNT_ID;
  const pageId = opts?.pageId || process.env.META_PAGE_ID;
  if (!accessToken || !adAccountId || !pageId) return null;
  return { accessToken, adAccountId, pageId };
}

export function metaConfigured(opts?: {
  adAccountId?: string;
  pageId?: string;
}): boolean {
  return getMetaConfig(opts) !== null;
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

async function metaFetchJson<T>(
  path: string,
  config: MetaConfig,
  init: { method: "GET" | "POST"; params?: Record<string, string> },
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${API_VERSION}${path}`);
  url.searchParams.set("access_token", config.accessToken);
  if (init.method === "GET" && init.params) {
    for (const [k, v] of Object.entries(init.params)) {
      url.searchParams.set(k, v);
    }
  }
  const opts: RequestInit = { method: init.method };
  if (init.method === "POST" && init.params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(init.params)) body.append(k, v);
    opts.body = body;
    opts.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta API ${res.status}: ${errText.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// IMAGE UPLOAD — turns any image URL or data URL into a Meta image_hash.
// Without this step, ad creation fails because Meta won't pull arbitrary
// image URLs at ad-creative time.
// ---------------------------------------------------------------------------

/**
 * Uploads an image to /act_/adimages and returns the image_hash that ad
 * creatives reference.
 *
 *   - Accepts: data: URLs, https URLs (we fetch them first), local paths.
 *   - For SVG placeholders we skip and return null (no real ad to launch).
 */
export async function uploadAdImage(args: {
  config: MetaConfig;
  imageUrl: string;
  filename?: string;
}): Promise<string | null> {
  // Skip placeholder SVGs — Meta rejects SVG anyway.
  if (args.imageUrl.startsWith("data:image/svg")) return null;

  const fetched = await fetchToBuffer(args.imageUrl);
  if (!fetched) return null;
  const filename = args.filename || `ad_${Date.now()}.png`;

  // Multipart upload — different shape from the JSON endpoints above.
  const url = new URL(
    `https://graph.facebook.com/${API_VERSION}/${args.config.adAccountId}/adimages`,
  );
  url.searchParams.set("access_token", args.config.accessToken);

  const form = new FormData();
  form.append("file", fetched.blob, filename);
  const res = await fetch(url.toString(), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Meta /adimages ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    images?: Record<string, { hash: string }>;
  };
  const first = data.images && Object.values(data.images)[0];
  return first?.hash ?? null;
}

/**
 * Uploads a video to /act_/advideos and polls until processing is done.
 * Returns the video_id ad creatives reference.
 */
export async function uploadAdVideo(args: {
  config: MetaConfig;
  videoUrl: string;
  filename?: string;
}): Promise<string | null> {
  if (args.videoUrl.startsWith("data:image/svg")) return null;

  const fetched = await fetchToBuffer(args.videoUrl);
  if (!fetched) return null;
  const filename = args.filename || `ad_${Date.now()}.mp4`;

  // Single-request upload for videos under ~50MB. For larger files, Meta
  // wants chunked upload via upload_phase=start/transfer/finish — out of
  // scope for v1; ad videos from our generators are well under that.
  const url = new URL(
    `https://graph.facebook.com/${API_VERSION}/${args.config.adAccountId}/advideos`,
  );
  url.searchParams.set("access_token", args.config.accessToken);

  const form = new FormData();
  form.append("source", fetched.blob, filename);

  const res = await fetch(url.toString(), { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Meta /advideos ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) return null;

  // Poll for the video to finish processing — Meta requires this before
  // an ad creative can reference it.
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const status = await metaFetchJson<{
      status?: { video_status?: string };
    }>(`/${data.id}`, args.config, {
      method: "GET",
      params: { fields: "status" },
    });
    if (status.status?.video_status === "ready") return data.id;
    if (status.status?.video_status === "error") return null;
  }
  return data.id; // return optimistically; Meta will reject if not ready
}

/**
 * Fetch a URL (or decode a data URL) into a Blob + content-type.
 * Using Blob (not Uint8Array) makes it directly form-appendable without
 * fighting TypeScript over Uint8Array<ArrayBufferLike> vs ArrayBuffer.
 * Returns null when the URL fails or is unsupported.
 */
async function fetchToBuffer(
  url: string,
): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;,]+)(;base64)?,(.*)$/);
      if (!match) return null;
      const contentType = match[1] || "application/octet-stream";
      const isBase64 = !!match[2];
      const data = isBase64
        ? Buffer.from(match[3], "base64")
        : Buffer.from(decodeURIComponent(match[3]), "utf8");
      return { blob: new Blob([data], { type: contentType }), contentType };
    }
    // Local app-served URL (/uploads/...) needs an absolute base.
    const absolute = url.startsWith("/")
      ? `${process.env.APP_BASE_URL || "http://localhost:3000"}${url}`
      : url;
    const res = await fetch(absolute);
    if (!res.ok) return null;
    const contentType =
      res.headers.get("content-type") || "application/octet-stream";
    const blob = await res.blob();
    return { blob, contentType };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CAMPAIGN / AD SET / AD
// ---------------------------------------------------------------------------

export async function createCampaign(args: {
  config: MetaConfig;
  name: string;
  goal: ClientGoal;
  dailyBudgetUsd: number;
}): Promise<{ id: string; mock?: boolean }> {
  return metaFetchJson<{ id: string }>(
    `/${args.config.adAccountId}/campaigns`,
    args.config,
    {
      method: "POST",
      params: {
        name: args.name,
        objective: goalToObjective(args.goal),
        status: "PAUSED",
        special_ad_categories: "[]",
        daily_budget: String(Math.round(args.dailyBudgetUsd * 100)),
      },
    },
  );
}

export async function createAdSet(args: {
  config: MetaConfig;
  campaignId: string;
  name: string;
  dailyBudgetUsd: number;
  goal: ClientGoal;
  audienceNotes: string;
}): Promise<{ id: string }> {
  const targeting = {
    geo_locations: { countries: ["US"] },
    age_min: 18,
    age_max: 65,
    publisher_platforms: ["facebook", "instagram"],
  };
  return metaFetchJson<{ id: string }>(
    `/${args.config.adAccountId}/adsets`,
    args.config,
    {
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
    },
  );
}

/**
 * Creates an ad creative + an ad. Caller must provide either an
 * imageHash (from uploadAdImage) or videoId (from uploadAdVideo).
 */
export async function createAd(args: {
  config: MetaConfig;
  adSetId: string;
  name: string;
  creative: AdCreative;
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string; // required for video creatives
}): Promise<{ id: string; creativeId: string }> {
  const linkData: Record<string, unknown> = {
    link: args.creative.destinationUrl,
    message: args.creative.primaryText,
    name: args.creative.headline,
    description: args.creative.description,
    call_to_action: { type: args.creative.cta },
  };
  if (args.imageHash) {
    linkData.image_hash = args.imageHash;
  }

  const objectStorySpec: Record<string, unknown> = {
    page_id: args.config.pageId,
  };
  if (args.videoId) {
    // Video creative shape is different — uses video_data, not link_data.
    objectStorySpec.video_data = {
      video_id: args.videoId,
      title: args.creative.headline,
      message: args.creative.primaryText,
      call_to_action: {
        type: args.creative.cta,
        value: { link: args.creative.destinationUrl },
      },
      image_url: args.thumbnailUrl,
    };
  } else {
    objectStorySpec.link_data = linkData;
  }

  const creative = await metaFetchJson<{ id: string }>(
    `/${args.config.adAccountId}/adcreatives`,
    args.config,
    {
      method: "POST",
      params: {
        name: args.name,
        object_story_spec: JSON.stringify(objectStorySpec),
      },
    },
  );

  const ad = await metaFetchJson<{ id: string }>(
    `/${args.config.adAccountId}/ads`,
    args.config,
    {
      method: "POST",
      params: {
        name: args.name,
        adset_id: args.adSetId,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
      },
    },
  );

  return { id: ad.id, creativeId: creative.id };
}

export async function pauseAd(
  config: MetaConfig,
  adId: string,
): Promise<{ mock?: boolean }> {
  if (adId.startsWith("mock_")) return { mock: true };
  await metaFetchJson<unknown>(`/${adId}`, config, {
    method: "POST",
    params: { status: "PAUSED" },
  });
  return {};
}

export async function resumeAd(
  config: MetaConfig,
  adId: string,
): Promise<{ mock?: boolean }> {
  if (adId.startsWith("mock_")) return { mock: true };
  await metaFetchJson<unknown>(`/${adId}`, config, {
    method: "POST",
    params: { status: "ACTIVE" },
  });
  return {};
}

export async function updateAdBudget(args: {
  config: MetaConfig;
  adSetId: string;
  dailyBudgetUsd: number;
}): Promise<{ mock?: boolean }> {
  if (args.adSetId.startsWith("mock_")) return { mock: true };
  await metaFetchJson<unknown>(`/${args.adSetId}`, args.config, {
    method: "POST",
    params: {
      daily_budget: String(Math.round(args.dailyBudgetUsd * 100)),
    },
  });
  return {};
}

export async function getAdMetrics(
  configOrNull: MetaConfig | null,
  adId: string,
): Promise<AdMetrics & { mock?: boolean }> {
  if (!configOrNull || adId.startsWith("mock_")) {
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

  const res = await metaFetchJson<{ data: Insight[] }>(
    `/${adId}/insights`,
    configOrNull,
    {
      method: "GET",
      params: {
        fields: "impressions,clicks,spend,actions,ctr,cpc,frequency",
        date_preset: "last_7d",
      },
    },
  );
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

/**
 * Validate a (token, ad account) combo by hitting /me/adaccounts.
 * Used by the onboarding form to confirm the user pasted a working
 * config before we save it.
 */
export async function validateMetaConfig(
  config: MetaConfig,
): Promise<{ ok: true; accountName: string } | { ok: false; error: string }> {
  try {
    const res = await metaFetchJson<{
      name?: string;
      account_status?: number;
    }>(`/${config.adAccountId}`, config, {
      method: "GET",
      params: { fields: "name,account_status" },
    });
    if (!res.name) return { ok: false, error: "Ad account not found." };
    return { ok: true, accountName: res.name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
