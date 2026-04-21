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
  angle: string; // "which lever are we pulling"
  hypothesis: string; // what we're testing and why
}

export interface AdRecord {
  id: string;
  clientId: string;
  createdAt: string;
  status: AdStatus;
  creative: AdCreative;
  imageUrl?: string;
  imageProvider?: string;
  imageReason?: string;
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
