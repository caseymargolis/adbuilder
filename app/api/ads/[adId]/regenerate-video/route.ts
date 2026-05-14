import { NextResponse } from "next/server";
import { getClient, updateAd } from "@/lib/db";
import { generateVideo, routeVideo, writeVideoPrompt } from "@/lib/video-provider";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  const { clientId } = (await req.json()) as { clientId: string };

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

  // 1. Write a new video prompt for the existing creative
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
  });

  // 3. Generate the new video
  const video = await generateVideo({ decision });

  // 4. Update only the video fields, keep existing creative + image
  const updatedAd = await updateAd(clientId, adId, (existing) => ({
    ...existing,
    mediaKind: "video",
    creative: {
      ...existing.creative,
      videoPrompt: decision.refinedPrompt,
    },
    videoUrl: video.url,
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
