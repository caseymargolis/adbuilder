import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import { addAd, getClient, newId } from "@/lib/db";
import { generateImage, routeImage } from "@/lib/image-provider";
import { AD_GENERATION_SYSTEM } from "@/lib/prompts";
import type { AdCreative, AdRecord } from "@/lib/types";

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.analysis) {
    return NextResponse.json(
      {
        error: "Run the website analysis first. We don't guess.",
      },
      { status: 400 },
    );
  }

  const a = client.analysis;
  const user = [
    "CLIENT",
    `- Name: ${client.name}`,
    `- Offer: ${client.offer}`,
    `- Goal: ${client.goal}`,
    `- Monthly budget: $${client.monthlyBudgetUsd}`,
    "",
    "ANALYSIS (from our prior pass)",
    `- TL;DR: ${a.tldr}`,
    `- Positioning: ${a.positioning}`,
    `- Audience: ${a.audienceGuess}`,
    `- Differentiators: ${a.differentiators.join("; ")}`,
    `- Objections to overcome: ${a.objections.join("; ")}`,
    `- Proof points: ${a.proofPoints.join("; ")}`,
    `- Best conversion surfaces: ${a.conversionSurfaces.join("; ")}`,
    `- Brand voice: ${a.voice}`,
    `- Risks to respect: ${a.risks.join("; ")}`,
    "",
    "Generate the 5-variant test battery per the system instructions.",
  ].join("\n");

  const creatives = await askJson<AdCreative[]>({
    system: AD_GENERATION_SYSTEM,
    user,
    maxTokens: 8000,
  });

  // Route + generate an image for each variant in parallel.
  const withImages = await Promise.all(
    creatives.map(async (c) => {
      const decision = await routeImage({
        imagePrompt: c.imagePrompt,
        angle: c.angle,
        brandVoice: a.voice,
      });
      const img = await generateImage({ decision });
      return { creative: c, image: img };
    }),
  );

  const created: AdRecord[] = [];
  for (const { creative, image } of withImages) {
    const ad: AdRecord = {
      id: newId("a"),
      clientId: client.id,
      createdAt: new Date().toISOString(),
      status: "draft",
      creative: {
        ...creative,
        imagePrompt: image.decision.refinedPrompt,
      },
      imageUrl: image.url,
      imageProvider: image.provider,
      imageReason: image.decision.reason,
    };
    await addAd(client.id, ad);
    created.push(ad);
  }

  return NextResponse.json({ ads: created });
}
