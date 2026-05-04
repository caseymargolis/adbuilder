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
      ? `- Canonical brand colors: ${args.brandColors.join(", ")} (use these in the refined prompt where the design calls for it)`
      : "",
    args.brandFonts && args.brandFonts.length
      ? `- Canonical brand fonts: ${args.brandFonts.join(", ")}`
      : "",
    `- Prompt: ${args.imagePrompt}`,
    "",
    "Pick the best provider and rewrite the prompt for it. If we have canonical",
    "brand colors and the brief calls for typography or vector-style design,",
    "lean toward recraft-v3 — it actually respects exact hex values.",
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
 * Generate an image via the chosen provider. If the provider isn't configured,
 * return a deterministic placeholder URL. This lets the rest of the pipeline
 * run end-to-end without credentials.
 */
export async function generateImage(args: {
  decision: ImageRouteDecision;
}): Promise<GeneratedImage> {
  const { decision } = args;
  switch (decision.provider) {
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
  }
}

// --- Providers ---

async function callIdeogram(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.IDEOGRAM_API_KEY;
  if (!key) return placeholder(decision);
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
  if (!res.ok) return placeholder(decision);
  const data = (await res.json()) as { data?: Array<{ url: string }> };
  const url = data.data?.[0]?.url;
  if (!url) return placeholder(decision);
  return { url, provider: "ideogram-v3", decision, mock: false };
}

async function callFlux(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.BFL_API_KEY;
  if (!key) return placeholder(decision);
  // https://docs.bfl.ml — FLUX.1.1 [pro] ultra endpoint
  const start = await fetch("https://api.bfl.ml/v1/flux-pro-1.1-ultra", {
    method: "POST",
    headers: { "x-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: decision.refinedPrompt,
      aspect_ratio: "1:1",
      safety_tolerance: 2,
      output_format: "jpeg",
    }),
  });
  if (!start.ok) return placeholder(decision);
  const { id } = (await start.json()) as { id: string };
  // Poll for result
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const poll = await fetch(`https://api.bfl.ml/v1/get_result?id=${id}`, {
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
    if (data.status === "Error" || data.status === "Content Moderated") break;
  }
  return placeholder(decision);
}

async function callImagen(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return placeholder(decision);
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
  if (!res.ok) return placeholder(decision);
  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const pred = data.predictions?.[0];
  if (!pred?.bytesBase64Encoded) return placeholder(decision);
  return {
    url: `data:${pred.mimeType ?? "image/png"};base64,${pred.bytesBase64Encoded}`,
    provider: "imagen-4",
    decision,
    mock: false,
  };
}

async function callRecraft(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.RECRAFT_API_KEY;
  if (!key) return placeholder(decision);
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
  if (!res.ok) return placeholder(decision);
  const data = (await res.json()) as { data?: Array<{ url: string }> };
  const url = data.data?.[0]?.url;
  if (!url) return placeholder(decision);
  return { url, provider: "recraft-v3", decision, mock: false };
}

async function callGptImage(decision: ImageRouteDecision): Promise<GeneratedImage> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return placeholder(decision);
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
  if (!res.ok) return placeholder(decision);
  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (!first) return placeholder(decision);
  if (first.url) return { url: first.url, provider: "gpt-image-1", decision, mock: false };
  if (first.b64_json) {
    return {
      url: `data:image/png;base64,${first.b64_json}`,
      provider: "gpt-image-1",
      decision,
      mock: false,
    };
  }
  return placeholder(decision);
}

function placeholder(decision: ImageRouteDecision): GeneratedImage {
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
