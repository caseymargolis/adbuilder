/**
 * Web scraper router.
 *
 * Best tool per job:
 *   - Firecrawl    — purpose-built LLM scraper. Handles JS rendering,
 *                    structured extraction, sitemap crawling. Best content
 *                    quality and best-formatted Markdown out of any option.
 *   - Playwright   — for self-hosted JS-rendered sites when we don't want
 *                    a third-party hop (already wired in site-reader-headless).
 *   - Plain fetch  — fast path for SSR'd marketing sites; works in 80% of cases.
 *
 * This module is the upgrade ladder: prefer Firecrawl when configured,
 * fall back to Playwright if available, fall back to fetch otherwise.
 *
 * Firecrawl docs: https://docs.firecrawl.dev/
 */

import { readWebsite as fetchReader } from "./site-reader";

export interface DeepScrape {
  url: string;
  title: string;
  description: string;
  markdown: string; // structured markdown, easier for LLM than raw text
  text: string; // plain text fallback
  metadata: Record<string, unknown>;
  source: "firecrawl" | "playwright" | "fetch";
  jsRendered: boolean;
  /** Subpages we hit on a shallow crawl (firecrawl /map) */
  links?: string[];
}

/** Do a single-URL deep scrape with the best available tool. */
export async function deepScrape(url: string): Promise<DeepScrape> {
  const fc = process.env.FIRECRAWL_API_KEY;
  if (fc) {
    try {
      return await firecrawlScrape(url, fc);
    } catch {
      // fall through
    }
  }
  // The existing `site-reader.ts` already handles the playwright→fetch fallback.
  const r = await fetchReader(url);
  return {
    url: r.url,
    title: r.title,
    description: r.description,
    markdown: r.text,
    text: r.text,
    metadata: {},
    source: r.jsRendered ? "playwright" : "fetch",
    jsRendered: r.jsRendered,
  };
}

/**
 * Shallow site map: pull the homepage + a handful of strategically-relevant
 * pages (product, pricing, about, reviews). We feed all of them to the
 * analyzer so it can spot the conversion surfaces and the proof points
 * that actually live on the site.
 */
export async function siteMap(url: string, maxPages = 6): Promise<DeepScrape[]> {
  const fc = process.env.FIRECRAWL_API_KEY;
  if (!fc) {
    // No multi-page crawl on the fallback path — return just the homepage.
    return [await deepScrape(url)];
  }
  try {
    // Use Firecrawl's /map to discover URLs cheaply, then scrape the top N.
    const mapRes = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: { Authorization: `Bearer ${fc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, limit: 80 }),
    });
    if (!mapRes.ok) throw new Error(`firecrawl /map ${mapRes.status}`);
    const mapData = (await mapRes.json()) as { links?: string[] };
    const ranked = rankPages(mapData.links ?? [], url).slice(0, maxPages);
    const home = await firecrawlScrape(url, fc);
    home.links = mapData.links ?? [];
    const others = await Promise.all(
      ranked
        .filter((u) => u !== url && u !== home.url)
        .slice(0, maxPages - 1)
        .map((u) => firecrawlScrape(u, fc).catch(() => null)),
    );
    return [home, ...others.filter(Boolean) as DeepScrape[]];
  } catch {
    return [await deepScrape(url)];
  }
}

async function firecrawlScrape(url: string, apiKey: string): Promise<DeepScrape> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 1500,
    }),
  });
  if (!res.ok) throw new Error(`firecrawl ${res.status}`);
  const data = (await res.json()) as {
    data?: {
      markdown?: string;
      metadata?: { title?: string; description?: string; sourceURL?: string };
    };
  };
  const md = data.data?.markdown ?? "";
  const meta = data.data?.metadata ?? {};
  return {
    url: meta.sourceURL ?? url,
    title: meta.title ?? "",
    description: meta.description ?? "",
    markdown: md.slice(0, 30_000),
    text: stripMarkdown(md).slice(0, 30_000),
    metadata: meta,
    source: "firecrawl",
    jsRendered: true,
  };
}

/** Heuristic: prioritize pages that actually convert ad clicks. */
function rankPages(urls: string[], origin: string): string[] {
  const home = new URL(origin).origin;
  const scored = urls
    .filter((u) => u.startsWith(home))
    .map((u) => ({ u, score: scoreUrl(u) }))
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.u);
}

function scoreUrl(u: string): number {
  const p = u.toLowerCase();
  let s = 0;
  if (/\/(start|signup|sign-up|join|get-started|trial)(\b|\/)/.test(p)) s += 10;
  if (/\/(pricing|plans|buy|subscribe|shop)(\b|\/)/.test(p)) s += 9;
  if (/\/(reviews|testimonials|case-studies)(\b|\/)/.test(p)) s += 8;
  if (/\/(about|story|why)(\b|\/)/.test(p)) s += 6;
  if (/\/(features|how-it-works|product)(\b|\/)/.test(p)) s += 5;
  if (/\/(faq|help|support)(\b|\/)/.test(p)) s += 3;
  if (/\/(blog|news|press)(\b|\/)/.test(p)) s += 1;
  // Penalize legal / utility
  if (/\/(privacy|terms|cookies|legal|sitemap)(\b|\/)/.test(p)) s -= 5;
  // Short URLs (top-level) generally beat deep ones
  s -= u.split("/").length;
  return s;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // link text only
    .replace(/[#>*_`~]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}
