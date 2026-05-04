import { NextResponse } from "next/server";
import { getClient, updateAd, upsertClient } from "@/lib/db";
import {
  clientForGoogle,
  createGoogleAdGroup,
  createGoogleCampaign,
  createResponsiveSearchAd,
} from "@/lib/google-ads";

/**
 * Launch the selected RSAs on Google Ads (paused). One campaign + one
 * ad group + N RSAs (one per draft).
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { clientId, adIds } = (await req.json()) as {
    clientId: string;
    adIds: string[];
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const g = await clientForGoogle(client, async (refreshed) => {
    client.googleOAuth = refreshed;
    await upsertClient(client);
  });
  const isMock = !g;

  const totalDaily = client.monthlyBudgetUsd / 30;

  let campaignResource: string;
  let budgetResource: string;
  let adGroupResource: string;

  if (isMock || !g) {
    campaignResource = `mock_campaign_${Date.now()}`;
    budgetResource = `mock_budget_${Date.now()}`;
    adGroupResource = `mock_adgroup_${Date.now()}`;
  } else {
    const camp = await createGoogleCampaign(g, {
      name: `${client.name} — ${new Date().toISOString().slice(0, 10)}`,
      goal: client.goal,
      dailyBudgetUsd: totalDaily,
    });
    campaignResource = camp.campaign;
    budgetResource = camp.budget;
    const ag = await createGoogleAdGroup(g, {
      campaignResource,
      name: `${client.name} test-battery`,
    });
    adGroupResource = ag.resourceName;
  }

  const results: Array<{
    adId: string;
    resource: string;
    mock: boolean;
    error?: string;
  }> = [];

  for (const adId of adIds) {
    const ad = client.ads.find((a) => a.id === adId);
    if (!ad || !ad.googleRsa) continue;

    try {
      let resource: string;
      if (isMock || !g) {
        resource = `mock_rsa_${Date.now()}_${ad.id.slice(-4)}`;
      } else {
        const created = await createResponsiveSearchAd(g, {
          adGroupResource,
          rsa: ad.googleRsa,
        });
        resource = created.resourceName;
      }
      const updated = await updateAd(client.id, ad.id, (a) => ({
        ...a,
        status: "queued",
        googleCampaignResource: campaignResource,
        googleAdGroupResource: adGroupResource,
        googleAdResource: resource,
      }));
      results.push({ adId: updated.id, resource, mock: isMock });
    } catch (e) {
      results.push({
        adId: ad.id,
        resource: "",
        mock: isMock,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    googleConfigured: !isMock,
    campaign: campaignResource,
    budget: budgetResource,
    adGroup: adGroupResource,
    launched: results,
  });
}
