import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import { addAd, getClient, newId } from "@/lib/db";
import { GOOGLE_RSA_GENERATION_SYSTEM } from "@/lib/prompts";
import type { AdRecord, GoogleRsaCreative } from "@/lib/types";

/**
 * Generate 5 Responsive Search Ads for the Google Ads platform.
 *
 *   POST /api/generate-google-ads { clientId }
 */
export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.analysis) {
    return NextResponse.json(
      { error: "Run the website analysis first." },
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
    "ANALYSIS",
    `- TL;DR: ${a.tldr}`,
    `- Positioning: ${a.positioning}`,
    `- Audience: ${a.audienceGuess}`,
    `- Differentiators: ${a.differentiators.join("; ")}`,
    `- Objections: ${a.objections.join("; ")}`,
    `- Proof points: ${a.proofPoints.join("; ")}`,
    `- Best conversion surfaces (use these for finalUrl): ${a.conversionSurfaces.join("; ")}`,
    `- Brand voice: ${a.voice}`,
    "",
    "Generate the 5 RSAs.",
  ].join("\n");

  const rsas = await askJson<GoogleRsaCreative[]>({
    system: GOOGLE_RSA_GENERATION_SYSTEM,
    user,
    task: "creative_battery",
    maxTokens: 9000,
  });

  const created: AdRecord[] = [];
  for (const rsa of rsas) {
    const ad: AdRecord = {
      id: newId("ag"),
      clientId: client.id,
      createdAt: new Date().toISOString(),
      status: "draft",
      platform: "google",
      mediaKind: "image", // unused for RSA but required field
      googleRsa: rsa,
      // Mirror the angle / hypothesis onto the generic creative for chat &
      // optimization to read uniformly across platforms.
      creative: {
        headline: rsa.headlines[0] ?? rsa.angle,
        primaryText: rsa.descriptions[0] ?? "",
        description: rsa.descriptions[1] ?? "",
        cta: "LEARN_MORE",
        destinationUrl: rsa.finalUrl,
        imagePrompt: "",
        angle: rsa.angle,
        hypothesis: rsa.hypothesis,
      },
    };
    await addAd(client.id, ad);
    created.push(ad);
  }

  return NextResponse.json({ ads: created });
}
