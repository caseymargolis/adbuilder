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

import { askJson } from "@/lib/anthropic";
import { KlingAPI } from "kling-api";

const VIDEO_ROUTER_SYSTEM = `You are a video generation router for an ad platform. You will be given a brief and must decide which video generation provider to use. You can choose from the following providers:
  - veo-3
  - sora-2
  - runway-gen-4
  - kling-2

IMPORTANT: You must respond with valid JSON in this exact format:
{
  "provider": "veo-3",
  "reason": "why this provider is best",
  "needsEditorPass": true,
  "refinedPrompt": "the refined video prompt",
  "recommendedAspect": "9:16",
  "recommendedDurationSec": 5
}

The aspect ratio must be one of: "1:1", "9:16", "16:9".
The duration should be an integer between 4 and 12.
Do not include any other text, markdown, or formatting outside the JSON object.`;

const VIDEO_PROMPT_SYSTEM = `You are a video prompt writer for an ad platform. You will be given a brief and must write a video prompt.

CRITICAL GUIDELINES FOR HIGH-QUALITY VIDEO GENERATION:
1. AVOID TEXT IN SCENES: Video AI models struggle with readable text. Focus on visual storytelling, product shots, and lifestyle imagery instead of text overlays or signs with text.
2. PREVENT MORPHING: Describe clear, stable scenes with consistent subjects. Avoid describing transformations, shape-shifting, or objects changing form. Focus on smooth camera movements and stable compositions.
3. SPECIFIC VISUAL DETAILS: Use concrete visual descriptors (colors, lighting, camera angles, composition) rather than abstract concepts.
4. STABLE COMPOSITIONS: Describe scenes with clear foreground/background separation and stable framing to reduce AI hallucinations.
5. MINIMIZE COMPLEX MOTION: Focus on one or two key actions per scene rather than complex multi-action sequences that can morph unpredictably.
6. BRAND CONSISTENCY: If brand colors are provided, emphasize them in lighting, props, or environment to maintain brand identity without text.

IMPORTANT: You must respond with valid JSON in this exact format:
{
  "videoPrompt": "your video prompt text here"
}

Do not include any other text, markdown, or formatting outside the JSON object. The video prompt should be a single paragraph suitable for a video generation AI.`;

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
  recommendedAspect: "1:1" | "9:16" | "16:9";
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

/** Write a one-shot video prompt from the ad angle + hypothesis + brand context. */
export async function writeVideoPrompt(args: {
  angle: string;
  hypothesis: string;
  brandVoice: string;
  offer: string;
  imagePrompt?: string;
  productName?: string;
  audienceGuess?: string;
  proofPoints?: string[];
  differentiators?: string[];
  brandColors?: string[];
  aspectRatio?: string;
}): Promise<{ videoPrompt: string }> {
  const user = [
    `ANGLE: ${args.angle}`,
    `HYPOTHESIS: ${args.hypothesis}`,
    `OFFER: ${args.offer}`,
    `BRAND VOICE: ${args.brandVoice}`,
    args.productName ? `PRODUCT: ${args.productName}` : "",
    args.audienceGuess ? `AUDIENCE: ${args.audienceGuess}` : "",
    args.proofPoints?.length
      ? `PROOF POINTS: ${args.proofPoints.slice(0, 3).join(" | ")}`
      : "",
    args.differentiators?.length
      ? `DIFFERENTIATORS: ${args.differentiators.slice(0, 3).join(" | ")}`
      : "",
    args.brandColors?.length
      ? `BRAND COLORS: ${args.brandColors.join(", ")}`
      : "",
    args.imagePrompt ? `PAIRED STATIC CONCEPT: ${args.imagePrompt}` : "",
    args.aspectRatio ? `TARGET ASPECT RATIO: ${args.aspectRatio}` : "",
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
  hypothesis: string;
  brandVoice: string;
  aspectHint?: "1:1" | "9:16" | "16:9";
}): Promise<VideoRouteDecision> {
  const user = [
    "BRIEF:",
    `- Angle: ${args.angle}`,
    `- Hypothesis: ${args.hypothesis}`,
    `- Brand voice: ${args.brandVoice}`,
    args.aspectHint ? `- Target aspect ratio: ${args.aspectHint}` : "",
    `- Prompt: ${args.videoPrompt}`,
    "",
    "Pick the best provider, aspect, and duration.",
    args.aspectHint ? `IMPORTANT: The user has requested the ${args.aspectHint} aspect ratio. Use this as the recommendedAspect in your response.` : "",
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
 *
 * If the chosen provider fails, tries other providers as fallback.
 */
export async function generateVideo(args: {
  decision: VideoRouteDecision;
}): Promise<GeneratedVideo> {
  const { decision } = args;
  console.log(`[VideoGen] Attempting provider: ${decision.provider}`);

  // Try the chosen provider first
  let result: GeneratedVideo;
  switch (decision.provider) {
    case "veo-3":
      result = await callVeo(decision);
      break;
    case "sora-2":
      result = await callSora(decision);
      break;
    case "runway-gen-4":
      result = await callRunway(decision);
      break;
    case "kling-2":
      result = await callKling(decision);
      break;
  }

  // If the chosen provider succeeded, return it
  if (!result.mock) {
    console.log(`[VideoGen] Success with provider: ${result.provider}`);
    return result;
  }

  // Otherwise, try other providers as fallback
  console.log(`[VideoGen] ${decision.provider} returned placeholder, trying fallback providers...`);
  const fallbackOrder: VideoProviderId[] = [
    "runway-gen-4",
    "sora-2",
    "veo-3",
  ];
  for (const provider of fallbackOrder) {
    if (provider === decision.provider) continue; // skip already-tried
    console.log(`[VideoGen] Trying fallback: ${provider}`);
    switch (provider) {
      case "veo-3":
        result = await callVeo(decision);
        break;
      case "sora-2":
        result = await callSora(decision);
        break;
      case "runway-gen-4":
        result = await callRunway(decision);
        break;
      case "kling-2":
        result = await callKling(decision);
        break;
    }
    if (!result.mock) {
      console.log(`[VideoGen] Success with fallback provider: ${result.provider}`);
      return result;
    }
  }

  console.error("[VideoGen] All providers failed, returning placeholder");
  return result;
}

// --- Providers ---
//
// All four use a standard async pattern: submit job, poll for the result URL.
// The exact endpoints evolve; we pin to the current shapes as of early 2026
// and keep the implementation thin so they're easy to swap.

async function callVeo(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) {
    console.error("[VideoGen] Veo: no GOOGLE_API_KEY");
    return placeholder(decision);
  }
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
            aspectRatio: decision.recommendedAspect,
            // veo-3.0-generate-001 accepts 4-8s; clamp router value
            durationSeconds: Math.min(8, Math.max(4, decision.recommendedDurationSec)),
          },
        }),
      },
    );
    if (!startRes.ok) {
      const body = await startRes.text().catch(() => "<no body>");
      console.error(`[VideoGen] Veo HTTP ${startRes.status}: ${body}`);
      return placeholder(decision);
    }
    const startData = (await startRes.json()) as { name?: string };
    const op = startData.name;
    if (!op) {
      console.error("[VideoGen] Veo: no operation name in response");
      return placeholder(decision);
    }
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
        if (!uri) {
          console.error("[VideoGen] Veo: no videoUri in completed response");
          return placeholder(decision);
        }
        return {
          url: uri,
          provider: "veo-3",
          decision,
          durationSec: decision.recommendedDurationSec,
          mock: false,
        };
      }
    }
    console.error("[VideoGen] Veo: polling timed out after 5 minutes");
  } catch (err) {
    console.error("[VideoGen] Veo exception:", err);
  }
  return placeholder(decision);
}

async function callSora(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[VideoGen] Sora: no OPENAI_API_KEY");
    return placeholder(decision);
  }
  try {
    // Create an AbortController with a longer timeout for Sora
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const start = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "sora-2",
        prompt: decision.refinedPrompt,
        size:
          decision.recommendedAspect === "9:16"
            ? "720x1280"
            : decision.recommendedAspect === "1:1"
              ? "1024x1024"
              : "1280x720",
        // Sora only accepts string values "4", "8", or "12"
        seconds: decision.recommendedDurationSec <= 4 ? "4" : decision.recommendedDurationSec <= 8 ? "8" : "12",
      }),
    });
    clearTimeout(timeoutId);

    if (!start.ok) {
      const body = await start.text().catch(() => "<no body>");
      console.error(`[VideoGen] Sora HTTP ${start.status}: ${body}`);
      return placeholder(decision);
    }
    const job = (await start.json()) as { id: string; status: string; error?: any };
    console.log("[VideoGen] Sora job submitted:", JSON.stringify(job, null, 2));
    if (job.error) {
      console.error("[VideoGen] Sora job submission error:", job.error);
      return placeholder(decision);
    }
    
    let lastProgress = -1;
    let stuckCount = 0;
    
    for (let i = 0; i < 90; i++) { // Increased to 90 attempts (7.5 minutes)
      await sleep(5000);
      
      const pollController = new AbortController();
      const pollTimeoutId = setTimeout(() => pollController.abort(), 30000); // 30 second timeout per poll
      
      try {
        const poll = await fetch(`https://api.openai.com/v1/videos/${job.id}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: pollController.signal,
        });
        clearTimeout(pollTimeoutId);

        const data = (await poll.json()) as {
          status: string;
          output?: Array<{ url: string; type: string }>;
          error?: any;
          progress?: number;
        };
        
        // Check if progress is stuck
        if (data.progress !== undefined) {
          if (data.progress === lastProgress) {
            stuckCount++;
            console.warn(`[VideoGen] Sora progress stuck at ${data.progress}% for ${stuckCount} consecutive polls`);
            if (stuckCount >= 12) { // Stuck for 1 minute (12 * 5s)
              console.error("[VideoGen] Sora job appears stuck, falling back");
              break;
            }
          } else {
            stuckCount = 0;
            lastProgress = data.progress;
          }
        }
        
        console.log(`[VideoGen] Sora poll response (attempt ${i + 1}, progress: ${data.progress || 'N/A'}%):`, JSON.stringify(data, null, 2));
        
        if (data.status === "completed") {
          const url = data.output?.find((o) => o.type === "video")?.url;
          if (!url) {
            console.error("[VideoGen] Sora: no video URL in completed response. Output:", data.output);
            return placeholder(decision);
          }
          return {
            url,
            provider: "sora-2",
            decision,
            durationSec: decision.recommendedDurationSec,
            mock: false,
          };
        }
        if (data.status === "failed" || data.status === "cancelled") {
          console.error(`[VideoGen] Sora job ${job.id} status: ${data.status}`);
          break;
        }
      } catch (pollErr: any) {
        clearTimeout(pollTimeoutId);
        if (pollErr.name === 'AbortError') {
          console.error(`[VideoGen] Sora poll timeout on attempt ${i + 1}`);
          // Continue polling on timeout
          continue;
        }
        throw pollErr;
      }
    }
    console.error("[VideoGen] Sora: polling timed out after 7.5 minutes");
  } catch (err) {
    console.error("[VideoGen] Sora exception:", err);
  }
  return placeholder(decision);
}

async function callRunway(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) {
    console.error("[VideoGen] Runway: no RUNWAY_API_KEY");
    return placeholder(decision);
  }
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
        model: "gen4.5",
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
    if (!start.ok) {
      const body = await start.text().catch(() => "<no body>");
      console.error(`[VideoGen] Runway HTTP ${start.status}: ${body}`);
      return placeholder(decision);
    }
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
      if (data.status === "FAILED") {
        console.error(`[VideoGen] Runway job ${job.id} failed`);
        break;
      }
    }
    console.error("[VideoGen] Runway: polling timed out after 5 minutes");
  } catch (err) {
    console.error("[VideoGen] Runway exception:", err);
  }
  return placeholder(decision);
}

async function callKling(decision: VideoRouteDecision): Promise<GeneratedVideo> {
  const key = process.env.KLING_API_KEY;
  if (!key) {
    console.error("[VideoGen] Kling: no KLING_API_KEY");
    return placeholder(decision);
  }

  // Parse KLING_API_KEY in format "accessKey:secretKey"
  const [accessKey, secretKey] = key.split(":");
  if (!accessKey || !secretKey) {
    console.error("[VideoGen] Kling: KLING_API_KEY must be in format 'accessKey:secretKey'");
    return placeholder(decision);
  }

  try {
    const api = new KlingAPI({ accessKey, secretKey });

    console.log("[VideoGen] Kling: submitting text-to-video task");
    const task = await api.textToVideo({
      prompt: decision.refinedPrompt,
      model_name: "kling-v2-master",
      aspect_ratio: decision.recommendedAspect,
      duration: decision.recommendedDurationSec <= 5 ? "5" : "10",
    });

    const taskId = task.data.task_id;
    console.log(`[VideoGen] Kling: task ${taskId} submitted, waiting for result`);

    const result = await api.waitForVideoResult(taskId);
    const url = result.data.task_result?.videos?.[0]?.url;

    if (!url) {
      console.error("[VideoGen] Kling: no video URL in result");
      return placeholder(decision);
    }

    console.log(`[VideoGen] Kling: success, video URL: ${url}`);
    return {
      url,
      provider: "kling-2",
      decision,
      durationSec: decision.recommendedDurationSec,
      mock: false,
    };
  } catch (err) {
    console.error("[VideoGen] Kling exception:", err);
    return placeholder(decision);
  }
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
