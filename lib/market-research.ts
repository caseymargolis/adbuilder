/**
 * Market research module.
 *
 * Best tool per job:
 *   - Exa API           — semantic web search with citations. Best for
 *                         finding direct competitors and category context.
 *                         https://exa.ai
 *   - Perplexity Sonar  — live structured research with web search built in.
 *                         Best for "summarize the state of X market in 2026"
 *                         queries. https://docs.perplexity.ai
 *   - Meta Ad Library   — gold mine. Public API: every ad any advertiser
 *                         is currently running on Meta. We use it to read
 *                         what competitors are actually testing right now.
 *                         https://www.facebook.com/ads/library/api/
 *
 * Each is independently optional. The orchestrator pulls whatever is
 * configured and the analyzer LLM gets richer context as a result.
 */

export interface MarketSnapshot {
  competitors: CompetitorIntel[];
  categoryContext: string | null;
  competitorAds: AdLibraryEntry[];
  sources: Array<"exa" | "perplexity" | "meta-ad-library">;
}

export interface CompetitorIntel {
  name: string;
  domain: string;
  positioningSnippet: string;
  source: string;
  url: string;
}

export interface AdLibraryEntry {
  advertiserName: string;
  adCopy: string;
  startedAt?: string;
  url: string;
  platform: string[];
}

/** Pull whatever we can from whichever sources are configured. */
export async function gatherMarketIntel(args: {
  brandName: string;
  domain: string;
  category: string; // 1-line, e.g. "premium cold brew subscription"
}): Promise<MarketSnapshot> {
  const sources: MarketSnapshot["sources"] = [];
  const [competitors, categoryContext, competitorAds] = await Promise.all([
    findCompetitorsExa(args).then((r) => {
      if (r.length) sources.push("exa");
      return r;
    }),
    summarizeCategoryPerplexity(args).then((r) => {
      if (r) sources.push("perplexity");
      return r;
    }),
    fetchMetaAdLibrary(args.brandName).then((r) => {
      if (r.length) sources.push("meta-ad-library");
      return r;
    }),
  ]);
  return { competitors, categoryContext, competitorAds, sources };
}

/** Format a market snapshot as compact LLM context. */
export function marketContextForLLM(m: MarketSnapshot): string {
  if (
    m.competitors.length === 0 &&
    !m.categoryContext &&
    m.competitorAds.length === 0
  ) {
    return "(no market data available — Exa, Perplexity, and Meta Ad Library keys are unset; analyze from the brand's site alone)";
  }
  const parts: string[] = [];
  if (m.categoryContext) {
    parts.push(`CATEGORY CONTEXT (Perplexity):\n${m.categoryContext}`);
  }
  if (m.competitors.length) {
    parts.push(
      `DIRECT COMPETITORS (Exa):\n` +
        m.competitors
          .slice(0, 8)
          .map((c) => `- ${c.name} (${c.domain}): ${c.positioningSnippet}`)
          .join("\n"),
    );
  }
  if (m.competitorAds.length) {
    parts.push(
      `WHAT COMPETITORS ARE RUNNING ON META RIGHT NOW (Meta Ad Library):\n` +
        m.competitorAds
          .slice(0, 10)
          .map(
            (a) =>
              `- ${a.advertiserName} on ${a.platform.join("+")}: "${truncate(a.adCopy, 180)}"`,
          )
          .join("\n"),
    );
  }
  return parts.join("\n\n");
}

// ---- Exa ----

async function findCompetitorsExa(args: {
  brandName: string;
  domain: string;
  category: string;
}): Promise<CompetitorIntel[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `direct competitors to ${args.brandName} for ${args.category}`,
        numResults: 10,
        type: "neural",
        useAutoprompt: true,
        contents: { text: { maxCharacters: 600 } },
        excludeDomains: [args.domain.replace(/^www\./, "")],
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url: string;
        text?: string;
      }>;
    };
    return (data.results ?? []).map((r) => {
      const u = new URL(r.url);
      return {
        name: r.title?.split("|")[0].split("·")[0].trim() ?? u.hostname,
        domain: u.hostname.replace(/^www\./, ""),
        positioningSnippet: truncate((r.text ?? "").replace(/\s+/g, " "), 220),
        source: "exa",
        url: r.url,
      };
    });
  } catch {
    return [];
  }
}

// ---- Perplexity ----

async function summarizeCategoryPerplexity(args: {
  brandName: string;
  category: string;
}): Promise<string | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content:
              "You are a market analyst. Give a tight 4-sentence answer. No preamble, no fluff. Cite sources inline as [n].",
          },
          {
            role: "user",
            content: `Summarize the current state of the ${args.category} market in 2026: rough size, leaders, audience trends, and what's working in paid social ads. Brand of interest: ${args.brandName}.`,
          },
        ],
        max_tokens: 600,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ---- Meta Ad Library ----

async function fetchMetaAdLibrary(brandName: string): Promise<AdLibraryEntry[]> {
  // Meta's Ad Library API requires the same access token as the Marketing API.
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return [];
  try {
    const url = new URL("https://graph.facebook.com/v21.0/ads_archive");
    url.searchParams.set("search_terms", brandName);
    url.searchParams.set("ad_active_status", "ACTIVE");
    url.searchParams.set("ad_reached_countries", JSON.stringify(["US"]));
    url.searchParams.set(
      "fields",
      "ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,page_name,publisher_platforms,ad_delivery_start_time,ad_snapshot_url",
    );
    url.searchParams.set("limit", "20");
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{
        page_name?: string;
        ad_creative_bodies?: string[];
        ad_creative_link_titles?: string[];
        publisher_platforms?: string[];
        ad_delivery_start_time?: string;
        ad_snapshot_url?: string;
      }>;
    };
    return (data.data ?? []).map((a) => ({
      advertiserName: a.page_name ?? "unknown",
      adCopy: [a.ad_creative_link_titles?.[0], a.ad_creative_bodies?.[0]]
        .filter(Boolean)
        .join(" — "),
      platform: a.publisher_platforms ?? [],
      startedAt: a.ad_delivery_start_time,
      url: a.ad_snapshot_url ?? "",
    }));
  } catch {
    return [];
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
}
