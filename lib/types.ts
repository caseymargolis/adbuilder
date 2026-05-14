export type ClientGoal =
  | "leads"
  | "sales"
  | "traffic"
  | "awareness"
  | "app_installs"
  | "messages";

/**
 * Which ad platform an ad targets. Each platform has its own creative
 * shape, metrics, and optimization levers — see lib/ad-platforms/.
 */
export type AdPlatform = "meta" | "google";

/**
 * Organic social platforms. Used for the post calendar, not for ads.
 */
export type OrganicPlatform =
  | "instagram"
  | "linkedin"
  | "twitter"
  | "tiktok"
  | "facebook"
  | "threads";

export type GamePlanScope = "meta" | "google" | "organic";

export interface GamePlanPhase {
  number: number;
  name: string;
  durationDays: number;
  goal: string;
  actions: string[];
  successCheck: string; // "if CPA <= $12 by day 14, scale; else pivot to angle B"
}

export interface GamePlan {
  id: string;
  generatedAt: string;
  scope: GamePlanScope;
  tldr: string;
  positioning: string; // 1 sentence — the bet
  phases: GamePlanPhase[];
  successMetrics: Array<{
    metric: string;
    target30d: string;
    target90d: string;
  }>;
  budgetAllocation: string; // "60% Meta, 30% Google, 10% organic boost"
  cadence?: string; // for organic: "3 IG/wk, 5 LinkedIn/mo"
  risks: string[];
  raw: string; // full plain-English doc
}

export interface OrganicPost {
  id: string;
  clientId: string;
  createdAt: string;
  platform: OrganicPlatform;
  caption: string;
  hashtags: string[];
  mediaPrompt?: string;
  mediaUrl?: string;
  mediaProvider?: string;
  scheduledAt?: string; // ISO
  publishedAt?: string;
  externalUrl?: string; // link to the published post
  status: "draft" | "scheduled" | "published" | "failed" | "cancelled";
  failureReason?: string;
  angle: string;
  hypothesis: string;
  bufferUpdateId?: string; // when scheduled via Buffer
}

export interface ScheduledItem {
  id: string;
  clientId: string;
  type: "publish_organic" | "launch_meta_wave" | "launch_google_wave";
  refId: string; // post id / ad ids JSON / etc
  scheduledAt: string;
  processedAt?: string;
  status: "pending" | "processed" | "failed";
  failureReason?: string;
}

export type ReportAudience = "client" | "pm";

export interface Report {
  id: string;
  clientId: string;
  audience: ReportAudience;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  tldr: string;
  highlights: string[];
  bodyHtml: string;
  bodyText: string;
}

export interface GoogleAdsConfig {
  customerId: string; // 10-digit number, no dashes
  loginCustomerId?: string; // manager (MCC) ID, when access is via MCC
  customerName?: string;
}

export interface GoogleAdsOAuth {
  encryptedRefreshToken: string;
  encryptedAccessToken?: string;
  accessTokenExpiresAt?: string;
  scope: string;
  email?: string;
  connectedAt: string;
  lastRefreshedAt?: string;
}

/**
 * Google Ads creative — Responsive Search Ad (RSA).
 * Google delivers RSAs by combining headlines + descriptions dynamically.
 */
export interface GoogleRsaCreative {
  finalUrl: string;
  headlines: string[]; // 3-15 headlines, <=30 chars each
  descriptions: string[]; // 2-4 descriptions, <=90 chars each
  path1?: string; // <=15 chars, optional URL display path
  path2?: string;
  hypothesis: string;
  angle: string;
}

export interface ClientRecord {
  id: string;
  name: string;
  websiteUrl: string;
  goal: ClientGoal;
  monthlyBudgetUsd: number;
  audienceNotes: string;
  offer: string; // 1-sentence description of the offer / product
  /**
   * Which platform(s) this client runs ads on. Default: ["meta"].
   * The same workflow (analyze → generate → launch → optimize) supports
   * either; UI surfaces the difference per ad.
   */
  platforms?: AdPlatform[];
  /** Per-client Meta config — overrides env-var defaults. */
  metaAdAccountId?: string;
  metaPageId?: string;
  metaAccountName?: string;
  metaOAuth?: {
    encryptedToken: string;
    expiresAt: string; // ISO
    scope: string;
    userId: string;
    userName: string;
    connectedAt: string;
    lastRefreshedAt?: string;
  };
  /** Per-client Google Ads config. */
  googleAds?: GoogleAdsConfig;
  googleOAuth?: GoogleAdsOAuth;
  /** Where digest emails / launch confirmations go. */
  notifyEmail?: string;
  /** Plain-language client report goes here (separate audience). */
  clientNotifyEmail?: string;
  /** Strategic game plans, indexed by scope. */
  gamePlans?: GamePlan[];
  /** Organic social content + scheduling state. */
  organicPosts?: OrganicPost[];
  /** Scheduled queue (publish posts, launch ad waves, etc). */
  scheduledItems?: ScheduledItem[];
  /** Saved reports (client + PM). */
  reports?: Report[];
  /** When true, daily optimize auto-applies; scheduled items execute. */
  autopilot?: boolean;
  createdAt: string;
  analysis?: WebsiteAnalysis;
  ads: AdRecord[];
  optimizations: OptimizationLog[];
}

export interface WebsiteAnalysis {
  generatedAt: string;
  tldr: string;
  positioning: string;
  audienceGuess: string;
  differentiators: string[];
  objections: string[];
  proofPoints: string[];
  conversionSurfaces: string[];
  voice: string;
  risks: string[];
  raw: string; // full report in plain-English nerd voice
  /**
   * Provenance of the data the report was built on. Lets the UI show
   * "based on Brandfetch + Firecrawl + Exa + Reddit" instead of "trust me bro".
   */
  sources?: {
    brand?: "brandfetch" | "fallback" | "none";
    site?: "firecrawl" | "playwright" | "fetch";
    market?: Array<"exa" | "perplexity" | "meta-ad-library">;
    voiceOfCustomer?: Array<"trustpilot" | "g2" | "reddit" | "appstore">;
  };
  /**
   * Canonical brand assets pulled from Brandfetch (or empty if unavailable).
   * Used by image generation to lock in correct colors/fonts.
   */
  brandColors?: string[];
  brandFonts?: string[];
  brandLogoUrl?: string;
  /** Top competitors with one-line positioning each. */
  competitors?: Array<{ name: string; domain: string; note: string }>;
  /** What competitors are running on Meta right now. */
  competitorAdsSummary?: string;
}

export type AdStatus =
  | "draft"
  | "queued"
  | "live"
  | "paused"
  | "winner"
  | "killed";

export interface AdCreative {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  destinationUrl: string;
  imagePrompt: string; // description an image tool could use
  videoPrompt?: string; // description a video tool could use (sibling of imagePrompt)
  angle: string; // "which lever are we pulling"
  hypothesis: string; // what we're testing and why
}

export type AdMediaKind = "image" | "video" | "text"; // "text" for Google RSAs

export interface TextOverlay {
  id: string;
  text: string;
  position: "top" | "middle" | "bottom";
  align: "left" | "center" | "right";
  sizePct: number; // font size as % of canvas height
  colorHex: string;
  bgHex: string; // "transparent" for no background
  fromSec: number;
  toSec: number;
}

export interface EditorState {
  aspect: "1:1" | "4:5" | "9:16" | "16:9";
  trimStart: number;
  trimEnd: number; // seconds
  overlays: TextOverlay[];
  showCtaButton: boolean;
  mutedAudio: boolean;
  updatedAt: string;
}

export interface AdRecord {
  id: string;
  clientId: string;
  createdAt: string;
  status: AdStatus;
  /** Which platform this ad targets. Default for legacy records: "meta". */
  platform?: AdPlatform;
  creative: AdCreative;
  /** Google RSA creative — only set when platform === "google". */
  googleRsa?: GoogleRsaCreative;
  /** Google Ads resource names after launch. */
  googleAdGroupResource?: string;
  googleAdResource?: string;
  googleCampaignResource?: string;
  mediaKind: AdMediaKind;
  imageUrl?: string;
  imageProvider?: string;
  imageReason?: string;
  videoUrl?: string; // raw generated video (one-shot)
  videoProvider?: string;
  videoReason?: string;
  videoDurationSec?: number;
  editedVideoUrl?: string; // user-edited, uploaded back after editor export
  editorState?: EditorState;
  metaCampaignId?: string;
  metaAdSetId?: string;
  metaAdId?: string;
  metrics?: AdMetrics;
  lastOptimizedAt?: string;
}

export interface AdMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
  frequency: number;
  updatedAt: string;
}

export interface OptimizationLog {
  id: string;
  at: string;
  summary: string; // plain-English paragraph
  actions: OptimizationAction[];
  raw: string; // full rationale
}

export interface OptimizationAction {
  kind: "pause" | "scale_up" | "scale_down" | "duplicate_and_tweak" | "kill" | "hold";
  adId: string;
  reason: string;
  details?: Record<string, unknown>;
}
