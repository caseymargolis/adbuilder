import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import {
  appendOptimization,
  getClient,
  newId,
  updateAd,
  upsertClient,
} from "@/lib/db";
import { sendOptimizationDigest } from "@/lib/email";
import {
  getAdMetrics,
  getMetaConfigForClient,
  pauseAd,
  resumeAd,
  updateAdBudget,
} from "@/lib/meta";
import { OPTIMIZATION_SYSTEM } from "@/lib/prompts";
import type { AdStatus, OptimizationAction, OptimizationLog } from "@/lib/types";

interface OptimizerOutput {
  summary: string;
  actions: OptimizationAction[];
  raw: string;
}

export async function POST(req: Request) {
  const { clientId, apply } = (await req.json()) as {
    clientId: string;
    apply?: boolean;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = await getMetaConfigForClient(client, async (refreshed) => {
    client.metaOAuth = refreshed;
    await upsertClient(client);
  });
  const { clientForGoogle, getGoogleAdMetrics } = await import(
    "@/lib/google-ads"
  );
  const g = await clientForGoogle(client, async (refreshed) => {
    client.googleOAuth = refreshed;
    await upsertClient(client);
  });

  // Refresh metrics for all launched ads, by platform.
  // Only optimize ads that are actually live (not queued/paused mock ads).
  const liveAds = client.ads.filter((a) => {
    if (a.status !== "live" && a.status !== "winner") return false;
    // Skip mock ads - they have fake metrics from getAdMetrics mock mode
    if ((a.platform ?? "meta") === "google") {
      return a.googleAdResource && !a.googleAdResource.startsWith("mock_");
    }
    return a.metaAdId && !a.metaAdId.startsWith("mock_");
  });
  const metricsRefreshed = await Promise.all(
    liveAds.map(async (ad) => {
      try {
        if ((ad.platform ?? "meta") === "google" && ad.googleAdResource) {
          if (!g) return ad;
          const m = await getGoogleAdMetrics(g, ad.googleAdResource);
          // Map Google metrics into the shared shape.
          return await updateAd(client.id, ad.id, (x) => ({
            ...x,
            metrics: {
              impressions: m.impressions,
              clicks: m.clicks,
              spend: m.costUsd,
              conversions: m.conversions,
              ctr: m.ctr,
              cpc: m.averageCpc,
              cpa: m.cpa,
              frequency: 0, // not a Google concept
              updatedAt: new Date().toISOString(),
            },
          }));
        }
        if (!ad.metaAdId) return ad;
        const m = await getAdMetrics(config, ad.metaAdId);
        return await updateAd(client.id, ad.id, (x) => ({ ...x, metrics: m }));
      } catch {
        return ad;
      }
    }),
  );

  if (metricsRefreshed.length === 0) {
    return NextResponse.json({
      error: "No live ads to optimize. Launch ads to Meta/Google, then flip them to ACTIVE in the respective ad manager before running optimization.",
    }, { status: 400 });
  }

  const goal = client.goal;
  const target =
    goal === "leads" || goal === "sales"
      ? "CPA (cost per conversion)"
      : goal === "traffic"
        ? "CPC (cost per click)"
        : "CTR (click-through rate)";

  const user = [
    `CLIENT: ${client.name} — Goal: ${goal}. Primary metric we judge on: ${target}.`,
    `Monthly budget: $${client.monthlyBudgetUsd}.`,
    "",
    "ACTIVE ADS + METRICS:",
    ...metricsRefreshed.map((a) => {
      const m = a.metrics;
      return [
        `- id=${a.id} status=${a.status} angle="${a.creative.angle}"`,
        m
          ? `    spend=$${m.spend.toFixed(2)} imp=${m.impressions} clicks=${m.clicks} ctr=${(m.ctr * 100).toFixed(2)}% cpc=$${m.cpc.toFixed(2)} conv=${m.conversions} cpa=$${m.cpa.toFixed(2)} freq=${m.frequency.toFixed(2)}`
          : "    (no metrics yet)",
        `    hypothesis: ${a.creative.hypothesis}`,
      ].join("\n");
    }),
  ].join("\n");

  const out = await askJson<OptimizerOutput>({
    system: OPTIMIZATION_SYSTEM,
    user,
    task: "strategy",
    maxTokens: 6000,
  });

  // Apply actions, dispatching by platform. Apply silently no-ops when the
  // platform isn't connected — the report still surfaces the recommended
  // action so a human can apply manually.
  const { setGoogleAdStatus, setGoogleCampaignBudget } = await import(
    "@/lib/google-ads"
  );
  const applied: Array<{ action: OptimizationAction; ok: boolean; note?: string }> = [];
  if (apply) {
    for (const action of out.actions) {
      const ad = client.ads.find((a) => a.id === action.adId);
      if (!ad) continue;
      try {
        const newStatus: AdStatus =
          action.kind === "pause" || action.kind === "kill"
            ? "paused"
            : action.kind === "hold"
              ? ad.status
              : ad.status;

        const isGoogle = (ad.platform ?? "meta") === "google";

        if (action.kind === "pause" || action.kind === "kill") {
          if (isGoogle) {
            if (g && ad.googleAdResource)
              await setGoogleAdStatus(g, ad.googleAdResource, "PAUSED");
          } else {
            if (config && ad.metaAdId) await pauseAd(config, ad.metaAdId);
          }
        } else if (action.kind === "scale_up" || action.kind === "scale_down") {
          const current = ad.metrics?.spend ?? 20;
          const factor = action.kind === "scale_up" ? 1.5 : 0.6;
          const next = Math.max(5, current * factor);
          if (isGoogle) {
            // Google budgets live on the campaign, not the ad — but our
            // schema persists campaign on the ad for convenience.
            if (g && ad.googleCampaignResource) {
              // We don't know the budget resource from the ad alone; fetch it
              // via campaign.campaignBudget. For now we look it up from a
              // sibling ad that recorded it. Simpler path: re-query.
              // (Skipped here — see DEPLOY.md for the budget mutation TODO.)
              applied.push({
                action,
                ok: false,
                note: "Google budget mutation needs a resource lookup; do it manually for now.",
              });
              continue;
            }
          } else {
            if (config && ad.metaAdSetId) {
              await updateAdBudget({
                config,
                adSetId: ad.metaAdSetId,
                dailyBudgetUsd: next,
              });
            }
          }
        } else if (action.kind === "duplicate_and_tweak") {
          if (isGoogle) {
            if (g && ad.googleAdResource)
              await setGoogleAdStatus(g, ad.googleAdResource, "ENABLED");
          } else {
            if (config && ad.metaAdId) await resumeAd(config, ad.metaAdId);
          }
        }
        if (newStatus !== ad.status) {
          await updateAd(client.id, ad.id, (x) => ({
            ...x,
            status: newStatus,
            lastOptimizedAt: new Date().toISOString(),
          }));
        }
        applied.push({ action, ok: true });
        // Hint the unused-import linter that these are intentional refs.
        void setGoogleCampaignBudget;
      } catch (e) {
        applied.push({ action, ok: false, note: (e as Error).message });
      }
    }
  }

  const log: OptimizationLog = {
    id: newId("opt"),
    at: new Date().toISOString(),
    summary: out.summary,
    actions: out.actions,
    raw: out.raw,
  };
  await appendOptimization(client.id, log);

  // Fire-and-forget the digest email (Resend, when configured).
  if (client.notifyEmail) {
    sendOptimizationDigest({
      to: client.notifyEmail,
      clientName: client.name,
      log,
      appliedCount: applied.filter((a) => a.ok).length,
    }).catch(() => {
      /* never fail the optimize call on email errors */
    });
  }

  return NextResponse.json({ log, applied });
}
