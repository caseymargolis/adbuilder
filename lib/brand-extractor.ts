/**
 * Brand asset extractor — uses Brandfetch as the canonical source.
 *
 * Why Brandfetch and not "have Claude look at the website":
 *   - Brandfetch maintains a curated DB of 60M+ brands' canonical assets.
 *   - Returns exact hex colors, font names (mapped to Google Fonts), and
 *     ranked logo variants (light, dark, icon, wordmark) — usually correct
 *     when a website's CSS doesn't expose them cleanly.
 *   - Free tier is generous; production cost is sub-cent per brand.
 *
 * Falling back: if no key is set OR Brandfetch returns nothing for the
 * domain, we let the deeper pipeline (Firecrawl + Claude) infer what it can.
 *
 * Docs: https://docs.brandfetch.com/
 */

export interface BrandAssets {
  domain: string;
  name?: string;
  description?: string;
  logos: BrandLogo[];
  colors: BrandColor[];
  fonts: BrandFont[];
  socials: Array<{ platform: string; url: string }>;
  source: "brandfetch" | "fallback" | "none";
  qualityScore: number; // 0-1, how much we trust this
}

export interface BrandLogo {
  type: "icon" | "logo" | "symbol" | "wordmark" | "other";
  theme: "light" | "dark" | "default";
  url: string;
  format: "svg" | "png" | "jpeg" | "other";
}

export interface BrandColor {
  hex: string;
  type: "primary" | "secondary" | "accent" | "other";
  brightness?: number;
}

export interface BrandFont {
  name: string;
  type: "title" | "body" | "other";
  source: "google" | "system" | "custom";
}

export async function extractBrand(domain: string): Promise<BrandAssets> {
  const cleaned = cleanDomain(domain);
  const key = process.env.BRANDFETCH_API_KEY;
  if (!key) return emptyAssets(cleaned, "none");

  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${cleaned}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return emptyAssets(cleaned, "none");
    const data = (await res.json()) as BrandfetchResponse;
    return {
      domain: cleaned,
      name: data.name ?? undefined,
      description: data.description ?? undefined,
      logos: (data.logos ?? []).flatMap((l) =>
        (l.formats ?? []).map((f) => ({
          type: (l.type as BrandLogo["type"]) ?? "logo",
          theme: (l.theme as BrandLogo["theme"]) ?? "default",
          url: f.src,
          format: (f.format as BrandLogo["format"]) ?? "other",
        })),
      ),
      colors: (data.colors ?? []).map((c) => ({
        hex: c.hex,
        type: (c.type as BrandColor["type"]) ?? "other",
        brightness: c.brightness,
      })),
      fonts: (data.fonts ?? []).map((f) => ({
        name: f.name,
        type: (f.type as BrandFont["type"]) ?? "other",
        source: (f.origin as BrandFont["source"]) ?? "custom",
      })),
      socials: (data.links ?? []).map((l) => ({
        platform: l.name ?? "other",
        url: l.url,
      })),
      source: "brandfetch",
      qualityScore: data.quality?.score ?? 0.7,
    };
  } catch {
    return emptyAssets(cleaned, "none");
  }
}

/** Format the brand assets as a compact context block to feed into LLMs. */
export function brandContextForLLM(b: BrandAssets): string {
  if (b.source === "none") return `(no canonical brand data — infer from page content)`;
  const colorList = b.colors.length
    ? b.colors.map((c) => `${c.hex}(${c.type})`).join(", ")
    : "none on file";
  const fontList = b.fonts.length
    ? b.fonts.map((f) => `${f.name}(${f.type})`).join(", ")
    : "none on file";
  return [
    `Brand: ${b.name ?? b.domain}${b.description ? ` — ${b.description}` : ""}`,
    `Source: ${b.source} (quality ${(b.qualityScore * 100).toFixed(0)}/100)`,
    `Colors: ${colorList}`,
    `Fonts: ${fontList}`,
    `Logos available: ${b.logos.length} variant${b.logos.length === 1 ? "" : "s"}`,
  ].join("\n");
}

function cleanDomain(input: string): string {
  return input
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
}

function emptyAssets(domain: string, source: BrandAssets["source"]): BrandAssets {
  return {
    domain,
    logos: [],
    colors: [],
    fonts: [],
    socials: [],
    source,
    qualityScore: 0,
  };
}

// --- API response shape (just the bits we use) ---
interface BrandfetchResponse {
  name?: string;
  description?: string;
  quality?: { score?: number };
  colors?: Array<{ hex: string; type: string; brightness?: number }>;
  fonts?: Array<{ name: string; type: string; origin: string }>;
  logos?: Array<{
    type?: string;
    theme?: string;
    formats?: Array<{ src: string; format: string }>;
  }>;
  links?: Array<{ name?: string; url: string }>;
}
