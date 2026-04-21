import { NextResponse } from "next/server";
import { getClient, updateAd } from "@/lib/db";
import { createAd, createAdSet, createCampaign, metaConfigured } from "@/lib/meta";

export async function POST(req: Request) {
  const { clientId, adIds } = (await req.json()) as {
    clientId: string;
    adIds: string[];
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Daily budget ~= monthly / 30, distributed across launched ads
  const totalDaily = client.monthlyBudgetUsd / 30;
  const perAdDaily = Math.max(5, totalDaily / Math.max(adIds.length, 1));

  const campaign = await createCampaign({
    name: `${client.name} — ${new Date().toISOString().slice(0, 10)}`,
    goal: client.goal,
    dailyBudgetUsd: totalDaily,
  });

  const adSet = await createAdSet({
    campaignId: campaign.id,
    name: `${client.name} test-battery`,
    dailyBudgetUsd: totalDaily,
    goal: client.goal,
    audienceNotes: client.audienceNotes,
  });

  const results: Array<{ adId: string; metaAdId: string; mock?: boolean }> = [];

  for (const adId of adIds) {
    const ad = client.ads.find((a) => a.id === adId);
    if (!ad) continue;
    const launched = await createAd({
      adSetId: adSet.id,
      name: `${client.name} · ${ad.creative.angle}`,
      creative: ad.creative,
      imageUrl: ad.imageUrl ?? "",
    });
    const updated = await updateAd(client.id, ad.id, (a) => ({
      ...a,
      status: "queued",
      metaCampaignId: campaign.id,
      metaAdSetId: adSet.id,
      metaAdId: launched.id,
    }));
    results.push({ adId: updated.id, metaAdId: launched.id, mock: launched.mock });
  }

  return NextResponse.json({
    metaConfigured: metaConfigured(),
    campaignId: campaign.id,
    adSetId: adSet.id,
    perAdDailyUsd: Math.round(perAdDaily),
    launched: results,
  });
}
