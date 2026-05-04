import { NextResponse } from "next/server";
import { getClient, updateAd, upsertClient } from "@/lib/db";
import {
  createAd,
  createAdSet,
  createCampaign,
  getMetaConfigForClient,
  uploadAdImage,
  uploadAdVideo,
} from "@/lib/meta";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { clientId, adIds } = (await req.json()) as {
    clientId: string;
    adIds: string[];
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = await getMetaConfigForClient(client, async (refreshed) => {
    client.metaOAuth = refreshed;
    await upsertClient(client);
  });
  const isMock = !config;

  const totalDaily = client.monthlyBudgetUsd / 30;

  let campaignId: string;
  let adSetId: string;

  if (isMock || !config) {
    campaignId = `mock_campaign_${Date.now()}`;
    adSetId = `mock_adset_${Date.now()}`;
  } else {
    const campaign = await createCampaign({
      config,
      name: `${client.name} — ${new Date().toISOString().slice(0, 10)}`,
      goal: client.goal,
      dailyBudgetUsd: totalDaily,
    });
    campaignId = campaign.id;
    const adSet = await createAdSet({
      config,
      campaignId,
      name: `${client.name} test-battery`,
      dailyBudgetUsd: totalDaily,
      goal: client.goal,
      audienceNotes: client.audienceNotes,
    });
    adSetId = adSet.id;
  }

  const results: Array<{
    adId: string;
    metaAdId: string;
    mock: boolean;
    error?: string;
  }> = [];

  for (const adId of adIds) {
    const ad = client.ads.find((a) => a.id === adId);
    if (!ad) continue;

    try {
      let metaAdId: string;
      if (isMock || !config) {
        metaAdId = `mock_ad_${Date.now()}_${ad.id.slice(-4)}`;
      } else {
        let imageHash: string | null = null;
        let videoId: string | null = null;
        let thumbnailUrl: string | undefined;

        if (ad.mediaKind === "video" && (ad.editedVideoUrl || ad.videoUrl)) {
          videoId = await uploadAdVideo({
            config,
            videoUrl: ad.editedVideoUrl || ad.videoUrl!,
            filename: `${ad.id}.${(ad.editedVideoUrl || ad.videoUrl!).endsWith(".webm") ? "webm" : "mp4"}`,
          });
          thumbnailUrl =
            ad.imageUrl && !ad.imageUrl.startsWith("data:image/svg")
              ? ad.imageUrl
              : undefined;
        }

        if (!videoId && ad.imageUrl) {
          imageHash = await uploadAdImage({
            config,
            imageUrl: ad.imageUrl,
            filename: `${ad.id}.png`,
          });
        }

        if (!imageHash && !videoId) {
          throw new Error(
            "No usable media — Meta won't accept SVG placeholders. Generate a real image or video first.",
          );
        }

        const launched = await createAd({
          config,
          adSetId,
          name: `${client.name} · ${ad.creative.angle}`,
          creative: ad.creative,
          imageHash: imageHash ?? undefined,
          videoId: videoId ?? undefined,
          thumbnailUrl,
        });
        metaAdId = launched.id;
      }

      const updated = await updateAd(client.id, ad.id, (a) => ({
        ...a,
        status: "queued",
        metaCampaignId: campaignId,
        metaAdSetId: adSetId,
        metaAdId,
      }));
      results.push({ adId: updated.id, metaAdId, mock: isMock });
    } catch (e) {
      results.push({
        adId: ad.id,
        metaAdId: "",
        mock: isMock,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    metaConfigured: !isMock,
    metaSource: config?.source,
    campaignId,
    adSetId,
    perAdDailyUsd: Math.round(totalDaily / Math.max(adIds.length, 1)),
    launched: results,
  });
}
