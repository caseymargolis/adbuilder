import { NextResponse } from "next/server";
import { getClient, updateAd } from "@/lib/db";
import { generateImage, routeImage } from "@/lib/image-provider";

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

  // Route + generate a NEW image for the existing creative
  const decision = await routeImage({
    imagePrompt: ad.creative.imagePrompt,
    angle: ad.creative.angle,
    brandVoice: a.voice,
    brandColors: a.brandColors,
    brandFonts: a.brandFonts,
  });
  const image = await generateImage({ decision });

  // Update only the image fields, keep existing creative
  const updatedAd = await updateAd(clientId, adId, (existing) => ({
    ...existing,
    imageUrl: image.url,
    imageProvider: image.provider,
    imageReason: image.decision.reason,
    creative: {
      ...existing.creative,
      imagePrompt: image.decision.refinedPrompt,
    },
  }));

  return NextResponse.json({ ad: updatedAd });
}
