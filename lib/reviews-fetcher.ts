/**
 * Voice-of-customer fetcher.
 *
 * Best signal for ad copy isn't a brand's own About page — it's the
 * specific phrases real customers use to describe the product. We pull
 * those from where they live publicly.
 *
 * Best tool per source:
 *   - Trustpilot reviews   → Apify's Trustpilot scraper (cheap, clean data)
 *   - G2 / TrustRadius     → Apify B2B scrapers
 *   - Reddit threads       → Reddit's official JSON endpoint (free, instant)
 *   - App Store reviews    → public RSS feed (free)
 *
 * Each is independently optional. If nothing is configured we return an
 * empty list and the analyzer notes the gap.
 */

export interface CustomerVoiceSnippet {
  source: "trustpilot" | "g2" | "reddit" | "appstore";
  rating?: number; // 1-5 if applicable
  text: string;
  url?: string;
}

/** Pull a small representative sample of recent customer voice. */
export async function fetchCustomerVoice(args: {
  brandName: string;
  domain: string;
}): Promise<CustomerVoiceSnippet[]> {
  const [reddit, trustpilot] = await Promise.all([
    fetchRedditMentions(args.brandName).catch(() => []),
    fetchTrustpilotReviews(args.domain).catch(() => []),
  ]);
  return [...trustpilot, ...reddit].slice(0, 25);
}

/** Format the snippets as compact LLM context. */
export function customerVoiceForLLM(snippets: CustomerVoiceSnippet[]): string {
  if (snippets.length === 0) {
    return "(no public customer voice pulled — Reddit and Trustpilot returned nothing or aren't configured)";
  }
  const bySource: Record<string, CustomerVoiceSnippet[]> = {};
  for (const s of snippets) {
    bySource[s.source] = bySource[s.source] || [];
    bySource[s.source].push(s);
  }
  const out: string[] = [];
  for (const [src, items] of Object.entries(bySource)) {
    out.push(`FROM ${src.toUpperCase()} (${items.length} sample${items.length === 1 ? "" : "s"}):`);
    for (const s of items.slice(0, 8)) {
      const r = s.rating ? `[${s.rating}★] ` : "";
      out.push(`  ${r}"${truncate(s.text.replace(/\s+/g, " "), 280)}"`);
    }
  }
  return out.join("\n");
}

// ---- Reddit (free, official JSON) ----

async function fetchRedditMentions(brandName: string): Promise<CustomerVoiceSnippet[]> {
  const q = encodeURIComponent(`"${brandName}"`);
  const url = `https://www.reddit.com/search.json?q=${q}&limit=15&sort=relevance&t=year`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Adwise/0.1 (research)" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data?: { children?: Array<{ data?: { title?: string; selftext?: string; permalink?: string } }> };
  };
  const out: CustomerVoiceSnippet[] = [];
  for (const c of data.data?.children ?? []) {
    const t = c.data?.title ?? "";
    const body = c.data?.selftext ?? "";
    const text = [t, body].filter(Boolean).join(" — ");
    if (text.length < 40) continue;
    out.push({
      source: "reddit",
      text,
      url: c.data?.permalink ? `https://reddit.com${c.data.permalink}` : undefined,
    });
  }
  return out.slice(0, 12);
}

// ---- Trustpilot (via Apify) ----

async function fetchTrustpilotReviews(domain: string): Promise<CustomerVoiceSnippet[]> {
  const apifyKey = process.env.APIFY_API_TOKEN;
  if (!apifyKey) return [];
  // Apify's `apify/trustpilot-scraper` actor is the standard one
  const cleaned = domain.replace(/^www\./, "");
  const url = `https://api.apify.com/v2/acts/apify~trustpilot-scraper/run-sync-get-dataset-items?token=${apifyKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: `https://www.trustpilot.com/review/${cleaned}` }],
        maxReviews: 30,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      reviewBody?: string;
      rating?: number;
      url?: string;
    }>;
    return data
      .filter((r) => (r.reviewBody?.length ?? 0) > 40)
      .map((r) => ({
        source: "trustpilot" as const,
        rating: r.rating,
        text: r.reviewBody ?? "",
        url: r.url,
      }));
  } catch {
    return [];
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
}
