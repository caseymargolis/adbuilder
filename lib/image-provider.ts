/**
 * Image generation router.
 *
 * Ad creatives have wildly different requirements:
 *  - Poster-style ads with headlines baked into the image → text rendering wins.
 *  - Lifestyle/product photography → photorealism wins.
 *  - Illustrated/editorial brand ads → stylized composition wins.
 *
 * No single model is best at all three (as of early 2026). This router picks a
 * specialist per brief. We use Claude Opus 4.7 to do the routing + prompt
 * rewrite, then call the chosen provider. If no provider is configured, we
 * return a placeholder that still unblocks the end-to-end flow.
 *
 * Providers supported:
 *   - ideogram-v3       via Ideogram's API (best text-in-image)
 *   - flux-1.1-pro-ultra via Black Forest Labs / Replicate (best photoreal)
 *   - imagen-4          via Google Vertex / Gemini API (best illustration)
 *   - gpt-image-1       via OpenAI (solid generalist fallback)
 *
 * The routing decision (provider + reason + refined prompt) is persisted with
 * each ad so we can tie back performance → provider over time, and let the
 * router learn which model wins for which client's audiences.
 */

import { askJson } from "./anthropic";
import { IMAGE_ROUTER_SYSTEM } from "./prompts";

export type ImageProviderId =
  | "ideogram-v3"
  | "flux-1.1-pro-ultra"
  | "imagen-4"
  | "recraft-v3"
  | "gpt-image-1";

export interface ImageRouteDecision {
  provider: ImageProviderId;
  reason: string;
  refinedPrompt: string;
}

export interface GeneratedImage {
  url: string;
  provider: ImageProviderId | "placeholder";
  decision: ImageRouteDecision;
  mock: boolean;
}

/** Ask Claude which image model to use for this brief, based on shape. */
export async function routeImage(args: {
  imagePrompt: string;
  angle: string;
  brandVoice: string;
  brandColors?: string[]; // hex strings, from Brandfetch when available
  brandFonts?: string[];
}): Promise<ImageRouteDecision> {
  const user = [
    "BRIEF:",
    `- Angle: ${args.angle}`,
    `- Brand voice: ${args.brandVoice}`,
    args.brandColors && args.brandColors.length
      ? `- Canonical brand colors: ${args.brandColors.join(", ")}`
      : "",
    args.brandFonts && args.brandFonts.length
      ? `- Canonical brand fonts: ${args.brandFonts.join(", ")}`
      : "",
    `- Prompt: ${args.imagePrompt}`,
    "",
    "Pick the best provider and rewrite the prompt for it.",
    "",
    "DECISION RULES (apply in order, stop at first match):",
    "",
    "1. If the brief explicitly mentions: vector-style, infographic, logo-lockup,",
    "   brand-guidelines, or exact-hex-colors → choose recraft-v3.",
    "",
    "2. If the brief mentions: lifestyle, product shot, photorealistic, people,",
    "   natural lighting, or commercial photography → choose flux-1.1-pro-ultra.",
    "",
    "3. If the brief mentions: poster, text overlay, headline in image, or",
    "   typographic lockup → choose ideogram-v3.",
    "",
    "4. If the brief mentions: illustration, concept art, editorial, or stylized",
    "   scene → choose imagen-4.",
    "",
    "5. If the brief mentions: mixed, general, versatile, or any combination of",
    "   the above → choose gpt-image-1. It excels at handling varied requirements.",
    "",
    "6. For all other cases (default) → choose flux-1.1-pro-ultra. It is the",
    "   most versatile for ad creatives: product shots, lifestyle, people, scenes.",
    "",
    "IMPORTANT: Do NOT choose recraft-v3 just because brand colors exist.",
    "Only choose it when the brief explicitly calls for vector/infographic",
    "design where exact color matching matters.",
  ]
    .filter(Boolean)
    .join("\n");
  return await askJson<ImageRouteDecision>({
    system: IMAGE_ROUTER_SYSTEM,
    user,
    task: "util",
    maxTokens: 1200,
  });
}

/**
 * Generate an image via the chosen provider. If the provider fails or isn't
 * configured, try the next available provider as fallback. This ensures we
 * get a real image rather than a placeholder when possible.
 */
export async function generateImage(args: {
  decision: ImageRouteDecision;
}): Promise<GeneratedImage> {
  const { decision } = args;

  // Try the chosen provider first, then fall back to others if it fails.
  // Deduplicate so the chosen provider isn't tried twice.
  const fallbackOrder: ImageProviderId[] = [
    "gpt-image-1",
    "recraft-v3",
    "ideogram-v3",
    "imagen-4",
    "flux-1.1-pro-ultra",
  ];
  const providerIds: ImageProviderId[] = [
    decision.provider,
    ...fallbackOrder.filter((p) => p !== decision.provider),
  ];
  const providers = providerIds.map((p) => () => callProvider(p, decision));

  for (const tryProvider of providers) {
    const result = await tryProvider();
    if (!result.mock) {
      console.log(`[ImageGen] Success with provider: ${result.provider}`);
      return result; // Success - return real image
    }
    // Provider failed or returned placeholder, try next one
    console.error(`[ImageGen] Failed with provider: ${result.provider} (${result.decision.reason}), trying next...`);
  }
  console.error(`[ImageGen] All providers failed, returning placeholder`);

  // All providers failed - return final placeholder
  return placeholder(decision);
}

async function callProvider(
  provider: ImageProviderId,
  decision: ImageRouteDecision,
): Promise<GeneratedImage> {
  switch (provider) {
    case "ideogram-v3":
      return callIdeogram(decision);
    case "flux-1.1-pro-ultra":
      return callFlux(decision);
    case "imagen-4":
      return callImagen(decision);
    case "recraft-v3":
      return callRecraft(decision);
    case "gpt-image-1":
      return callGptImage(decision);
    default:
      return placeholder(decision);
  }
}

// --- Providers ---

async function callIdeogram(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) {
    console.log("[ImageGen] Ideogram: no API key");
    return placeholder(decision);
  }
  try {
    // https://developer.ideogram.ai/ideogram-api/api-reference
    const res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: decision.refinedPrompt,
        aspect_ratio: "1x1",
        rendering_speed: "DEFAULT",
        magic_prompt: "AUTO",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[ImageGen] Ideogram HTTP ${res.status}: ${body}`);
      return placeholder(decision, `Ideogram HTTP ${res.status}`);
    }
    const data = (await res.json()) as { data?: Array<{ url: string }> };
    const url = data.data?.[0]?.url;
    if (!url) {
      console.error(`[ImageGen] Ideogram empty response: ${JSON.stringify(data)}`);
      return placeholder(decision, "Ideogram empty response");
    }
    return { url, provider: "ideogram-v3", decision, mock: false };
  } catch (err) {
    console.error(`[ImageGen] Ideogram network/error:`, err);
  }
  return placeholder(decision, "Ideogram exception");
}

async function callFlux(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.BFL_API_KEY;
  if (!key) {
    console.log("[ImageGen] Flux: no API key");
    return placeholder(decision);
  }
  try {
    // Use flux-pro-1.1 for speed, or upgrade to ultra for max quality
    // https://docs.bfl.ml
    const model = "flux-pro-1.1";
    const start = await fetch(`https://api.bfl.ml/v1/${model}`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "x-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: decision.refinedPrompt,
        width: 1024,
        height: 1024,
        steps: 28,
        guidance: 3.5,
        safety_tolerance: 2,
        output_format: "jpeg",
      }),
    });
    if (!start.ok) {
      const body = await start.text().catch(() => "<no body>");
      console.error(`[ImageGen] Flux start HTTP ${start.status}: ${body}`);
      return placeholder(decision, `Flux start HTTP ${start.status}`);
    }
    const startData = (await start.json()) as { id?: string };
    const id = startData.id;
    if (!id) {
      console.error(`[ImageGen] Flux missing job id: ${JSON.stringify(startData)}`);
      return placeholder(decision, "Flux missing job id");
    }
    // Poll for result - start with longer delay, then poll faster
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 30; i++) {
      const poll = await fetch(`https://api.bfl.ml/v1/get_result?id=${id}`, {
        signal: AbortSignal.timeout(15000),
        headers: { "x-key": key },
      });
      const data = (await poll.json()) as {
        status: string;
        result?: { sample: string };
      };
      if (data.status === "Ready" && data.result?.sample) {
        return {
          url: data.result.sample,
          provider: "flux-1.1-pro-ultra",
          decision,
          mock: false,
        };
      }
      if (["Error", "Failed", "Content Moderated"].includes(data.status)) {
        console.error(`[ImageGen] Flux job failed with status: ${data.status}`);
        return placeholder(decision, `Flux job ${data.status}`);
      }
      await new Promise((r) => setTimeout(r, 1800));
    }
    console.error(`[ImageGen] Flux polling timed out after 30 attempts`);
    return placeholder(decision, "Flux polling timeout");
  } catch (err) {
    console.error(`[ImageGen] Flux network/error:`, err);
  }
  return placeholder(decision, "Flux exception");
}

async function callImagen(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    console.log("[ImageGen] Imagen: no API key");
    return placeholder(decision);
  }
  try {
    // Gemini API image generation endpoint for Imagen 4
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: decision.refinedPrompt }],
          parameters: { sampleCount: 1, aspectRatio: "1:1" },
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[ImageGen] Imagen HTTP ${res.status}: ${body}`);
      return placeholder(decision, `Imagen HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const pred = data.predictions?.[0];
    if (!pred?.bytesBase64Encoded) {
      console.error(`[ImageGen] Imagen empty/missing base64: ${JSON.stringify(data)}`);
      return placeholder(decision, "Imagen empty response");
    }
    return {
      url: `data:${pred.mimeType ?? "image/png"};base64,${pred.bytesBase64Encoded}`,
      provider: "imagen-4",
      decision,
      mock: false,
    };
  } catch (err) {
    console.error(`[ImageGen] Imagen network/error:`, err);
  }
  return placeholder(decision, "Imagen exception");
}

async function callRecraft(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.RECRAFT_API_KEY;
  if (!key) {
    console.log("[ImageGen] Recraft: no API key");
    return placeholder(decision);
  }
  try {
    // https://www.recraft.ai/docs — recraftv3 image generation
    const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: decision.refinedPrompt,
        style: "digital_illustration",
        model: "recraftv3",
        size: "1024x1024",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[ImageGen] Recraft HTTP ${res.status}: ${body}`);
      return placeholder(decision, `Recraft HTTP ${res.status}`);
    }
    const data = (await res.json()) as { data?: Array<{ url: string }> };
    const url = data.data?.[0]?.url;
    if (!url) {
      console.error(`[ImageGen] Recraft empty response: ${JSON.stringify(data)}`);
      return placeholder(decision, "Recraft empty response");
    }
    return { url, provider: "recraft-v3", decision, mock: false };
  } catch (err) {
    console.error(`[ImageGen] Recraft network/error:`, err);
  }
  return placeholder(decision, "Recraft exception");
}

async function callGptImage(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.log("[ImageGen] GPT Image: no API key");
    return placeholder(decision);
  }
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: decision.refinedPrompt,
        size: "1024x1024",
        n: 1,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[ImageGen] GPT Image HTTP ${res.status}: ${body}`);
      return placeholder(decision, `GPT Image HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = data.data?.[0];
    if (!first) {
      console.error(`[ImageGen] GPT Image empty response: ${JSON.stringify(data)}`);
      return placeholder(decision, "GPT Image empty response");
    }
    if (first.url) return { url: first.url, provider: "gpt-image-1", decision, mock: false };
    if (first.b64_json) {
      return {
        url: `data:image/png;base64,${first.b64_json}`,
        provider: "gpt-image-1",
        decision,
        mock: false,
      };
    }
    console.error(`[ImageGen] GPT Image unexpected shape: ${JSON.stringify(first)}`);
    return placeholder(decision, "GPT Image unexpected shape");
  } catch (err) {
    console.error(`[ImageGen] GPT Image network/error:`, err);
  }
  return placeholder(decision, "GPT Image exception");
}

function placeholder(decision: ImageRouteDecision, reason?: string): GeneratedImage {
  if (reason) {
    console.error(`[ImageGen] Placeholder created for ${decision.provider}: ${reason}`);
  }
  // Deterministic SVG placeholder so the UI always has something to render.
  const seed = Math.abs(hash(decision.refinedPrompt)) % 1000;
  const hue = seed % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='hsl(${hue},55%,60%)'/>
      <stop offset='100%' stop-color='hsl(${(hue + 40) % 360},55%,35%)'/>
    </linearGradient></defs>
    <rect width='1024' height='1024' fill='url(#g)'/>
    <text x='512' y='520' fill='white' font-family='Georgia' font-size='60' text-anchor='middle' opacity='0.9'>${escapeXml(decision.provider)}</text>
    <text x='512' y='590' fill='white' font-family='sans-serif' font-size='26' text-anchor='middle' opacity='0.75'>preview · set API key to generate</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    provider: "placeholder",
    decision,
    mock: true,
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
