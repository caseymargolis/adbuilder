import { NextResponse } from "next/server";
import { getClient, updateAd } from "@/lib/db";
import { generateVideo, routeVideo, writeVideoPrompt } from "@/lib/video-provider";
import { putBlob } from "@/lib/blob-storage";

/**
 * Generate a video variant for an existing ad.
 *
 *   POST /api/generate-video
 *   { clientId, adId, aspectHint?: "1:1" | "4:5" | "9:16" | "16:9" }
 *
 * Writes a video prompt (Claude), routes to the best provider, calls it, and
 * saves the resulting video on the ad record. Video generation is a distinct
 * step from image generation because it's expensive (dollars + minutes) and
 * we don't want every initial ad-battery run to burn that budget.
 */
export async function POST(req: Request) {
  const { clientId, adId, aspectHint } = (await req.json()) as {
    clientId: string;
    adId: string;
    aspectHint?: "1:1" | "4:5" | "9:16" | "16:9";
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ad = client.ads.find((a) => a.id === adId);
  if (!ad) return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  if (!client.analysis) {
    return NextResponse.json(
      { error: "Run the website analysis first." },
      { status: 400 },
    );
  }

  const a = client.analysis;

  // 1. Write a video prompt that fits the ad's angle + hypothesis
  const { videoPrompt } = await writeVideoPrompt({
    angle: ad.creative.angle,
    hypothesis: ad.creative.hypothesis,
    brandVoice: a.voice,
    offer: client.offer,
    imagePrompt: ad.creative.imagePrompt,
    audienceGuess: a.audienceGuess,
    proofPoints: a.proofPoints,
    differentiators: a.differentiators,
    brandColors: a.brandColors,
  });

  // 2. Route to the best provider
  const decision = await routeVideo({
    videoPrompt,
    angle: ad.creative.angle,
    hypothesis: ad.creative.hypothesis,
    brandVoice: a.voice,
    aspectHint,
  });

  // 3. Generate (polls until done or placeholder on no-key)
  const video = await generateVideo({ decision });

  // 4. Persist the video to blob storage so the URL doesn't expire
  let videoUrl = video.url;
  if (!video.mock && !videoUrl.startsWith("data:")) {
    try {
      const fetched = await fetch(videoUrl);
      if (fetched.ok) {
        const blob = await fetched.blob();
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const result = await putBlob({ filename: `${ad.id}.${ext}`, blob });
        videoUrl = result.url;
      }
    } catch (e) {
      console.error("Failed to persist video to blob storage:", e);
    }
  }

  // 5. Persist
  const updated = await updateAd(client.id, ad.id, (a) => ({
    ...a,
    mediaKind: "video",
    creative: { ...a.creative, videoPrompt: decision.refinedPrompt },
    videoUrl,
    videoProvider: video.provider,
    videoReason: decision.reason,
    videoDurationSec: video.durationSec,
  }));

  return NextResponse.json({
    ad: updated,
    decision,
    mock: video.mock,
    needsEditorPass: decision.needsEditorPass,
  });
}
