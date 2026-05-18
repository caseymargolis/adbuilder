import { NextResponse } from "next/server";
import { getClient, updateAd, upsertClient } from "@/lib/db";
import { getMetaConfigForClient } from "@/lib/meta";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = await getMetaConfigForClient(client, async (refreshed) => {
    client.metaOAuth = refreshed;
    await upsertClient(client);
  });

  const { clientForGoogle } = await import("@/lib/google-ads");
  const g = await clientForGoogle(client, async (refreshed) => {
    client.googleOAuth = refreshed;
    await upsertClient(client);
  });

  const results: Array<{
    adId: string;
    platform: string;
    oldStatus: string;
    newStatus: string;
    error?: string;
  }> = [];

  // Sync Meta ads
  for (const ad of client.ads) {
    if ((ad.platform ?? "meta") !== "meta" || !ad.metaAdId || ad.metaAdId.startsWith("mock_")) {
      continue;
    }

    try {
      if (!config) {
        results.push({
          adId: ad.id,
          platform: "meta",
          oldStatus: ad.status,
          newStatus: ad.status,
          error: "Meta not configured",
        });
        continue;
      }

      // Query Meta for ad status
      const res = await fetch(
        `https://graph.facebook.com/${process.env.META_API_VERSION || "v21.0"}/${ad.metaAdId}`,
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        },
      );

      if (!res.ok) {
        results.push({
          adId: ad.id,
          platform: "meta",
          oldStatus: ad.status,
          newStatus: ad.status,
          error: `Meta API ${res.status}`,
        });
        continue;
      }

      const data = (await res.json()) as { status?: string };
      const metaStatus = data.status?.toUpperCase(); // ACTIVE, PAUSED, etc.

      let newStatus: string = ad.status;
      if (metaStatus === "ACTIVE" && (ad.status === "queued" || ad.status === "paused")) {
        newStatus = "live";
      } else if (metaStatus === "PAUSED" && ad.status === "live") {
        newStatus = "paused";
      }

      if (newStatus !== ad.status) {
        await updateAd(client.id, ad.id, (a) => ({ ...a, status: newStatus as any }));
      }

      results.push({
        adId: ad.id,
        platform: "meta",
        oldStatus: ad.status,
        newStatus,
      });
    } catch (e) {
      results.push({
        adId: ad.id,
        platform: "meta",
        oldStatus: ad.status,
        newStatus: ad.status,
        error: (e as Error).message,
      });
    }
  }

  // Sync Google ads
  for (const ad of client.ads) {
    if (ad.platform !== "google" || !ad.googleAdResource || ad.googleAdResource.startsWith("mock_")) {
      continue;
    }

    try {
      if (!g) {
        results.push({
          adId: ad.id,
          platform: "google",
          oldStatus: ad.status,
          newStatus: ad.status,
          error: "Google not configured",
        });
        continue;
      }

      // Query Google for ad status using GAQL
      const adGroupAdId = ad.googleAdResource.split("~")[1];
      const query = `
        SELECT ad_group_ad.status
        FROM ad_group_ad
        WHERE ad_group_ad.ad.id = ${adGroupAdId}
      `;

      const res = await fetch(
        `https://googleads.googleapis.com/v18/customers/${g.customerId}/googleAds:search`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${g.accessToken}`,
            "developer-token": g.developerToken,
            "Content-Type": "application/json",
            ...(g.loginCustomerId && { "login-customer-id": g.loginCustomerId }),
          },
          body: JSON.stringify({ query }),
        },
      );

      if (!res.ok) {
        results.push({
          adId: ad.id,
          platform: "google",
          oldStatus: ad.status,
          newStatus: ad.status,
          error: `Google API ${res.status}`,
        });
        continue;
      }

      const data = (await res.json()) as {
        results?: Array<{ adGroupAd?: { status?: string } }>;
      };
      const googleStatus = data.results?.[0]?.adGroupAd?.status; // ENABLED, PAUSED, REMOVED

      let newStatus: string = ad.status;
      if (googleStatus === "ENABLED" && (ad.status === "queued" || ad.status === "paused")) {
        newStatus = "live";
      } else if (googleStatus === "PAUSED" && ad.status === "live") {
        newStatus = "paused";
      } else if (googleStatus === "REMOVED") {
        newStatus = "killed";
      }

      if (newStatus !== ad.status) {
        await updateAd(client.id, ad.id, (a) => ({ ...a, status: newStatus as any }));
      }

      results.push({
        adId: ad.id,
        platform: "google",
        oldStatus: ad.status,
        newStatus,
      });
    } catch (e) {
      results.push({
        adId: ad.id,
        platform: "google",
        oldStatus: ad.status,
        newStatus: ad.status,
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({ results });
}
