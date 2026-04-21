/**
 * Video generation router.
 *
 * State of video gen in 2026: usable for short ad clips but NOT reliable
 * enough to ship raw. Common failure modes: face warping, hand glitches,
 * text-in-frame drift, brand lockups that look almost-right. So every video
 * generated here is assumed to go through the editor pass before launch.
 *
 * Providers supported (declared; run via API when credentials are set):
 *   - veo-3         via Google Gemini API / Vertex AI (photoreal, native audio)
 *   - sora-2        via OpenAI (longer clips with audio, narrative)
 *   - runway-gen-4  via Runway API (cinematic motion, strong camera control)
 *   - kling-2       via Kling API (best physics, food/beverage/liquids)
 *
 * When no provider is configured, returns a tagged placeholder (a static SVG
 * poster that calls out which provider WOULD have been used), so the editor
 * and workflow still demo end-to-end without spending money.
 */

import { askJson } from "./anthropic";
import { VIDEO_ROUTER_SYSTEM, VIDEO_PROMPT_SYSTEM } from "./prompts";

export type VideoProviderId =
  | "veo-3"
  | "sora-2"
  | "runway-gen-4"
  | "kling-2";

export interface VideoRouteDecision {
  provider: VideoProviderId;
  reason: string;
  needsEditorPass: boolean;
  refinedPrompt: string;
  recommendedAspect: "1:1" | "4:5" | "9:16" | "16:9";
  recommendedDurationSec: number;
}

export interface GeneratedVideo {
  url: string;
  posterUrl?: string;
  provider: VideoProviderId | "placeholder";
  decision: VideoRouteDecision;
  durationSec: number;
  mock: boolean;
}

/** Write a one-shot video prompt from the ad angle + hypothesis + brand voice. */
export async function writeVideoPrompt(args: {
  angle: string;
  hypothesis: string;
  brandVoice: string;
  offer: string;
  imagePrompt?: string;
}): Promise<{ videoPrompt: string }> {
  const user = [
    `ANGLE: ${args.angle}`,
    `HYPOTHESIS: ${args.hypothesis}`,
    `OFFER: ${args.offer}`,
    `BRAND VOICE: ${args.brandVoice}`,
    args.imagePrompt ? `PAIRED STATIC CONCEPT: ${args.imagePrompt}` : "",
    "",
    "Write the video prompt.",
  ]
    .filter(Boolean)
    .join("\n");
  return await askJson<{ videoPrompt: string }>({
    system: VIDEO_PROMPT_SYSTEM,
    user,
    maxTokens: 1000,
  });
}

/** Ask Claude which video model to use for this brief. */
export async function routeVideo(args: {
  videoPrompt: string;
  angle: string;
  brandVoice: string;
  aspectHint?: "1:1" | "4:5" | "9:16" | "16:9";
}): Promise<VideoRouteDecision> {
  const user = [
    "BRIEF:",
    `- Angle: ${args.angle}`,
    `- Brand voice: ${args.brandVoice}`,
    args.aspectHint ? `- Placement hint: ${args.aspectHint}` : "",
    `- Prompt: ${args.videoPrompt}`,
    "",
    "Pick the best provider, aspect, and duration.",
  ]
    .filter(Boolean)
    .join("\n");
  return await askJson<VideoRouteDecision>({
    system: VIDEO_ROUTER_SYSTEM,
    user,
    maxTokens: 1500,
  });
}

/**
 * Generate a video. Dispatches to the chosen provider or returns a tagged
 * placeholder that unblocks the editor pass.
 */
export async function generateVideo(args: {
  decision: VideoRouteDecision;
}): Promise<GeneratedVideo> {
  const { decision } = args;
  switch (decision.provider) {
    case "veo-3":
      return callVeo(decision);
    case "sora-2":
      return callSora(decision);
    case "runway-gen-4":
      return callRunway(decision);
    case "kling-2":
      return callKling(decision);
  }
}

// --- Providers ---
//
// All four use a standard async pattern: submit job, poll for the result URL.
// The exact endpoints evolve; we pin to the current shapes as of early 2026
// and keep the implementation thin so they're easy to swap.

async function callVeo(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return placeholder(decision);
  try {
    // Gemini long-running-operations surface for Veo 3
    const startRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001:predictLongRunning?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: decision.refinedPrompt }],
          parameters: {
            aspectRatio: decision.recommendedAspect.replace(":", ":"),
            durationSeconds: decision.recommendedDurationSec,
            generateAudio: true,
          },
        }),
      },
    );
    if (!startRes.ok) return placeholder(decision);
    const startData = (await startRes.json()) as { name?: string };
    const op = startData.name;
    if (!op) return placeholder(decision);
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${op}?key=${key}`,
      );
      const data = (await poll.json()) as {
        done?: boolean;
        response?: { videos?: Array<{ videoUri?: string }> };
      };
      if (data.done) {
        const uri = data.response?.videos?.[0]?.videoUri;
        if (!uri) return placeholder(decision);
        return {
          url: uri,
          provider: "veo-3",
          decision,
          durationSec: decision.recommendedDurationSec,
          mock: false,
        };
      }
    }
  } catch {
    // fall through to placeholder
  }
  return placeholder(decision);
}

async function callSora(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return placeholder(decision);
  try {
    const start = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sora-2",
        prompt: decision.refinedPrompt,
        size:
          decision.recommendedAspect === "9:16"
            ? "720x1280"
            : decision.recommendedAspect === "1:1"
              ? "1024x1024"
              : decision.recommendedAspect === "4:5"
                ? "864x1080"
                : "1280x720",
        seconds: decision.recommendedDurationSec,
      }),
    });
    if (!start.ok) return placeholder(decision);
    const job = (await start.json()) as { id: string; status: string };
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`https://api.openai.com/v1/videos/${job.id}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = (await poll.json()) as {
        status: string;
        output?: Array<{ url: string; type: string }>;
      };
      if (data.status === "completed") {
        const url = data.output?.find((o) => o.type === "video")?.url;
        if (!url) return placeholder(decision);
        return {
          url,
          provider: "sora-2",
          decision,
          durationSec: decision.recommendedDurationSec,
          mock: false,
        };
      }
      if (data.status === "failed" || data.status === "cancelled") break;
    }
  } catch {
    // fall through
  }
  return placeholder(decision);
}

async function callRunway(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) return placeholder(decision);
  try {
    // Runway Gen-4 text-to-video
    const start = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({
        model: "gen4_turbo",
        promptText: decision.refinedPrompt,
        ratio:
          decision.recommendedAspect === "9:16"
            ? "720:1280"
            : decision.recommendedAspect === "1:1"
              ? "960:960"
              : "1280:720",
        duration: decision.recommendedDurationSec <= 5 ? 5 : 10,
      }),
    });
    if (!start.ok) return placeholder(decision);
    const job = (await start.json()) as { id: string };
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(
        `https://api.dev.runwayml.com/v1/tasks/${job.id}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            "X-Runway-Version": "2024-11-06",
          },
        },
      );
      const data = (await poll.json()) as {
        status: string;
        output?: string[];
      };
      if (data.status === "SUCCEEDED" && data.output?.[0]) {
        return {
          url: data.output[0],
          provider: "runway-gen-4",
          decision,
          durationSec: decision.recommendedDurationSec,
          mock: false,
        };
      }
      if (data.status === "FAILED") break;
    }
  } catch {
    // fall through
  }
  return placeholder(decision);
}

async function callKling(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.KLING_API_KEY;
  if (!key) return placeholder(decision);
  try {
    const start = await fetch(
      "https://api.klingai.com/v1/videos/text2video",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: "kling-v2-master",
          prompt: decision.refinedPrompt,
          aspect_ratio: decision.recommendedAspect,
          duration: decision.recommendedDurationSec <= 5 ? "5" : "10",
        }),
      },
    );
    if (!start.ok) return placeholder(decision);
    const job = (await start.json()) as { data: { task_id: string } };
    const taskId = job.data.task_id;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(
        `https://api.klingai.com/v1/videos/text2video/${taskId}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      const data = (await poll.json()) as {
        data: {
          task_status: string;
          task_result?: { videos?: Array<{ url: string }> };
        };
      };
      const s = data.data.task_status;
      if (s === "succeed" && data.data.task_result?.videos?.[0]) {
        return {
          url: data.data.task_result.videos[0].url,
          provider: "kling-2",
          decision,
          durationSec: decision.recommendedDurationSec,
          mock: false,
        };
      }
      if (s === "failed") break;
    }
  } catch {
    // fall through
  }
  return placeholder(decision);
}

function placeholder(decision: VideoRouteDecision): GeneratedVideo {
  // We return an SVG poster — the UI knows the "video" is a mock and offers
  // to demo the editor against it regardless.
  const hue =
    decision.provider === "veo-3"
      ? 210
      : decision.provider === "sora-2"
        ? 28
        : decision.provider === "runway-gen-4"
          ? 300
          : 140;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1080 1080'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='hsl(${hue},55%,60%)'/>
      <stop offset='100%' stop-color='hsl(${(hue + 40) % 360},55%,30%)'/>
    </linearGradient></defs>
    <rect width='1080' height='1080' fill='url(#g)'/>
    <g fill='white' opacity='0.96'>
      <circle cx='540' cy='480' r='100' fill='white' opacity='0.15'/>
      <polygon points='515,440 515,520 595,480' fill='white'/>
    </g>
    <text x='540' y='680' fill='white' font-family='Georgia' font-size='56' text-anchor='middle' opacity='0.95'>${escapeXml(decision.provider)}</text>
    <text x='540' y='740' fill='white' font-family='sans-serif' font-size='24' text-anchor='middle' opacity='0.8'>set API key to generate · editor works against this placeholder</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    posterUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    provider: "placeholder",
    decision,
    durationSec: decision.recommendedDurationSec,
    mock: true,
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
