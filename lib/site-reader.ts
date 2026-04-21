/**
 * Fetch a client's website and extract enough content for Claude to analyze.
 *
 * Two paths:
 *   1. Headless Chromium via Playwright (if USE_HEADLESS_SITE_READER=1). Needed
 *      for JS-rendered / SPA sites. See lib/site-reader-headless.ts.
 *   2. Plain fetch + regex-based extraction. Fast, zero-dep, good enough for
 *      most marketing sites that render server-side.
 *
 * We also try path 2 first and fall through to path 1 if the HTML looks
 * obviously JS-rendered — best of both worlds when the headless path is
 * available.
 */

import { readWebsiteHeadless } from "./site-reader-headless";

export async function readWebsite(url: string): Promise<{
  url: string;
  title: string;
  description: string;
  text: string;
  jsRendered: boolean;
}> {
  const forceHeadless = process.env.USE_HEADLESS_SITE_READER === "1";
  if (forceHeadless) {
    return readWebsiteHeadless(normalize(url));
  }

  const fetched = await readWebsiteFetch(url);
  if (fetched.jsRendered) {
    // Try to upgrade to headless if it's available; otherwise return what we
    // have and surface the limitation in the analysis.
    try {
      return await readWebsiteHeadless(fetched.url);
    } catch {
      return fetched;
    }
  }
  return fetched;
}

async function readWebsiteFetch(url: string): Promise<{
  url: string;
  title: string;
  description: string;
  text: string;
  jsRendered: boolean;
}> {
  const normalized = normalize(url);
  const res = await fetch(normalized, {
    headers: {
      // Pretend to be a real browser so most sites give us the same content
      // a human would see on first load.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Adwise/0.1",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Couldn't fetch the site (HTTP ${res.status}).`);
  const html = await res.text();

  const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ?? "";
  const description =
    pick(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ??
    pick(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i) ??
    "";

  const text = htmlToText(html);
  const jsRendered =
    text.length < 500 &&
    /data-reactroot|ng-version|__NEXT_DATA__|sveltekit:data|id=["']root["']/i.test(html);

  return {
    url: normalized,
    title: decodeEntities(title).slice(0, 200),
    description: decodeEntities(description).slice(0, 500),
    text: text.slice(0, 20_000),
    jsRendered,
  };
}

function normalize(url: string): string {
  let out = url.trim();
  if (!/^https?:\/\//i.test(out)) out = `https://${out}`;
  return out;
}

function pick(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1].trim() : null;
}

function htmlToText(html: string): string {
  // Strip scripts/styles.
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // Turn block-level tags into newlines so paragraphs stay separated.
  out = out.replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags.
  out = out.replace(/<[^>]+>/g, " ");
  // Collapse whitespace.
  out = out.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return decodeEntities(out);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
