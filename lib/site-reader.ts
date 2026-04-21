/**
 * Fetch a client's website and extract enough content for Claude to analyze.
 * We keep this tiny on purpose — no headless browser, no JS rendering. That
 * misses SPAs, which is a known limitation we surface in the UI.
 */

export async function readWebsite(url: string): Promise<{
  url: string;
  title: string;
  description: string;
  text: string;
  jsRendered: boolean;
}> {
  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

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

  // Rough JS-rendered detection: if body text is too short relative to page size
  // and contains common SPA signals, warn.
  const jsRendered =
    text.length < 500 &&
    /data-reactroot|ng-version|__NEXT_DATA__|sveltekit:data/i.test(html);

  return {
    url: normalized,
    title: decodeEntities(title).slice(0, 200),
    description: decodeEntities(description).slice(0, 500),
    text: text.slice(0, 20_000), // cap for token spend
    jsRendered,
  };
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
