export type ClientGoal =
  | "leads"
  | "sales"
  | "traffic"
  | "awareness"
  | "app_installs"
  | "messages";

export interface ClientRecord {
  id: string;
  name: string;
  websiteUrl: string;
  goal: ClientGoal;
  monthlyBudgetUsd: number;
  audienceNotes: string;
  offer: string; // 1-sentence description of the offer / product
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

export type AdMediaKind = "image" | "video";

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
  creative: AdCreative;
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
