import { NextResponse } from "next/server";
import { getClient, updateAd } from "@/lib/db";
import { generateVideo, routeVideo, writeVideoPrompt } from "@/lib/video-provider";
import { putBlob } from "@/lib/blob-storage";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  const { clientId, aspectRatio } = (await req.json()) as { clientId: string; aspectRatio?: "1:1" | "9:16" | "16:9" };

  const client = await getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!client.analysis) {
    return NextResponse.json(
      { error: "No analysis data for this client." },
      { status: 400 },
    );
  }

  const ad = client.ads.find((a) => a.id === adId);
  if (!ad) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Only allow regenerating draft ads
  if (ad.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft ads can be regenerated." },
      { status: 400 },
    );
  }

  const a = client.analysis;

  // 1. Write a new video prompt for the existing creative with improved text handling
  console.log("🎬 Regenerating video for aspect ratio:", aspectRatio || "default");
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
    aspectRatio: aspectRatio || "9:16",
  });

  console.log("📝 Generated video prompt:", videoPrompt);

  // 2. Route to the best provider with console logging
  console.log("🔍 Routing to best video provider...");
  const decision = await routeVideo({
    videoPrompt,
    angle: ad.creative.angle,
    hypothesis: ad.creative.hypothesis,
    brandVoice: a.voice,
    aspectHint: aspectRatio as "1:1" | "4:5" | "9:16" | "16:9",
  });
  console.log("✅ Selected provider:", decision.provider, "Reason:", decision.reason, "Aspect:", decision.recommendedAspect);

  // 3. Generate the new video with console logging
  console.log("🎥 Generating video with provider:", decision.provider);
  const video = await generateVideo({ decision });
  console.log("🎬 Video generated:", { provider: video.provider, duration: video.durationSec, mock: video.mock });

  // 4. Persist the video to blob storage so the URL doesn't expire
  let videoUrl = video.url;
  if (!video.mock && !videoUrl.startsWith("data:")) {
    try {
      const fetched = await fetch(videoUrl);
      if (fetched.ok) {
        const blob = await fetched.blob();
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        const result = await putBlob({ filename: `${adId}.${ext}`, blob });
        videoUrl = result.url;
      }
    } catch (e) {
      console.error("Failed to persist video to blob storage:", e);
    }
  }

  // 5. Update only the video fields, keep existing creative + image
  const updatedAd = await updateAd(clientId, adId, (existing) => ({
    ...existing,
    mediaKind: "video",
    creative: {
      ...existing.creative,
      videoPrompt: decision.refinedPrompt,
    },
    videoUrl,
    videoProvider: video.provider,
    videoReason: decision.reason,
    videoDurationSec: video.durationSec,
    // Keep imageUrl, imageProvider, imageReason intact
  }));

  return NextResponse.json({
    ad: updatedAd,
    decision,
    mock: video.mock,
    needsEditorPass: decision.needsEditorPass,
  });
}
