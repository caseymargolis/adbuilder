import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import { brandContextForLLM, extractBrand } from "@/lib/brand-extractor";
import { getClient, upsertClient } from "@/lib/db";
import {
  gatherMarketIntel,
  marketContextForLLM,
} from "@/lib/market-research";
import { ANALYSIS_SYSTEM } from "@/lib/prompts";
import { customerVoiceForLLM, fetchCustomerVoice } from "@/lib/reviews-fetcher";
import { siteMap } from "@/lib/web-scraper";
import type { WebsiteAnalysis } from "@/lib/types";

/**
 * The analyze pipeline routes each sub-job to the best tool for it,
 * then asks Claude Opus 4.7 (best LLM in 2026 for voice + strategic
 * synthesis) to combine everything.
 *
 *   Brand assets (colors, fonts, logos) → Brandfetch
 *   Deep site content (multi-page)      → Firecrawl  (fallbacks: Playwright, fetch)
 *   Competitor & category intel         → Exa + Perplexity
 *   What competitors run on Meta        → Meta Ad Library
 *   Voice-of-customer language          → Reddit (free) + Trustpilot (Apify)
 *   Synthesis                           → Claude Opus 4.7 / effort:high
 *
 * Each source is independently optional. If a key isn't set, we skip that
 * source and the synthesis prompt notes the gap.
 */
export const runtime = "nodejs";
// Allow long enough for the parallel fan-out + Opus call.
export const maxDuration = 120;

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 1. Run every research source in parallel.
  const [brand, pages, market, customerVoice] = await Promise.all([
    extractBrand(client.websiteUrl),
    siteMap(client.websiteUrl, 6),
    gatherMarketIntel({
      brandName: client.name,
      domain: client.websiteUrl,
      category: client.offer,
    }),
    fetchCustomerVoice({ brandName: client.name, domain: client.websiteUrl }),
  ]);

  const home = pages[0];
  const otherPages = pages.slice(1);

  // 2. Build the synthesis context. This is where the per-source signal
  //    lands together, with each chunk labeled so Claude can weight it.
  const user = [
    "CLIENT CONTEXT",
    `- Business: ${client.name}`,
    `- Offer: ${client.offer}`,
    `- Primary goal: ${client.goal}`,
    `- Monthly budget: $${client.monthlyBudgetUsd}`,
    `- Audience notes from the client: ${client.audienceNotes || "(none)"}`,
    "",
    "===== BRAND ASSETS (Brandfetch) =====",
    brandContextForLLM(brand),
    "",
    "===== HOMEPAGE (via " + home.source + ") =====",
    `URL: ${home.url}`,
    `Title: ${home.title}`,
    `Meta description: ${home.description}`,
    home.markdown,
    "",
    otherPages.length
      ? "===== OTHER KEY PAGES (Firecrawl /map ranked top conversion surfaces) =====\n" +
        otherPages
          .map(
            (p) =>
              `--- ${p.url} (${p.title}) ---\n${p.markdown.slice(0, 4000)}`,
          )
          .join("\n\n")
      : "",
    "",
    "===== MARKET / COMPETITOR INTEL =====",
    marketContextForLLM(market),
    "",
    "===== VOICE-OF-CUSTOMER (real customers, real words) =====",
    customerVoiceForLLM(customerVoice),
    "",
    "Now write the analysis per your output spec. Synthesize — don't recap.",
  ]
    .filter(Boolean)
    .join("\n");

  // 3. Synthesize. Strategy task → Opus 4.7 / high.
  const data = await askJson<Omit<WebsiteAnalysis, "generatedAt">>({
    system: ANALYSIS_SYSTEM,
    user,
    task: "strategy",
    maxTokens: 9000,
  });

  // 4. Persist the analysis with provenance + brand assets attached.
  const analysis: WebsiteAnalysis = {
    ...data,
    generatedAt: new Date().toISOString(),
    sources: {
      brand: brand.source,
      site: home.source,
      market: market.sources,
      voiceOfCustomer: Array.from(
        new Set(customerVoice.map((s) => s.source)),
      ) as Array<"trustpilot" | "g2" | "reddit" | "appstore">,
    },
    brandColors: brand.colors.map((c) => c.hex),
    brandFonts: brand.fonts.map((f) => f.name),
    brandLogoUrl:
      brand.logos.find((l) => l.format === "svg")?.url ?? brand.logos[0]?.url,
    competitors: market.competitors.slice(0, 6).map((c) => ({
      name: c.name,
      domain: c.domain,
      note: c.positioningSnippet,
    })),
    competitorAdsSummary: market.competitorAds.length
      ? `${market.competitorAds.length} active Meta ads found across competitors. Top angles surfaced in the briefing.`
      : undefined,
  };
  client.analysis = analysis;
  await upsertClient(client);

  return NextResponse.json({ analysis });
}
