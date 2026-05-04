import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import { appendOptimization, getClient, newId, updateAd } from "@/lib/db";
import { sendOptimizationDigest } from "@/lib/email";
import {
  getAdMetrics,
  getMetaConfig,
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

  const config = getMetaConfig({
    adAccountId: client.metaAdAccountId,
    pageId: client.metaPageId,
  });

  // Refresh metrics for all launched ads
  const liveAds = client.ads.filter((a) =>
    ["live", "queued", "winner", "paused"].includes(a.status),
  );
  const metricsRefreshed = await Promise.all(
    liveAds.map(async (ad) => {
      if (!ad.metaAdId) return ad;
      const m = await getAdMetrics(config, ad.metaAdId);
      return await updateAd(client.id, ad.id, (x) => ({ ...x, metrics: m }));
    }),
  );

  if (metricsRefreshed.length === 0) {
    return NextResponse.json({
      error: "No live ads to optimize. Launch at least one first.",
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

  // Apply actions to Meta if requested
  const applied: Array<{ action: OptimizationAction; ok: boolean; note?: string }> = [];
  if (apply) {
    for (const action of out.actions) {
      const ad = client.ads.find((a) => a.id === action.adId);
      if (!ad || !ad.metaAdId) continue;
      try {
        const newStatus: AdStatus =
          action.kind === "pause" || action.kind === "kill"
            ? "paused"
            : action.kind === "hold"
              ? ad.status
              : ad.status;
        if (action.kind === "pause" || action.kind === "kill") {
          if (config) await pauseAd(config, ad.metaAdId);
        } else if (action.kind === "scale_up" || action.kind === "scale_down") {
          if (config && ad.metaAdSetId) {
            const current = ad.metrics?.spend ?? 20;
            const factor = action.kind === "scale_up" ? 1.5 : 0.6;
            await updateAdBudget({
              config,
              adSetId: ad.metaAdSetId,
              dailyBudgetUsd: Math.max(5, current * factor),
            });
          }
        } else if (action.kind === "duplicate_and_tweak") {
          if (config) await resumeAd(config, ad.metaAdId);
        }
        if (newStatus !== ad.status) {
          await updateAd(client.id, ad.id, (x) => ({
            ...x,
            status: newStatus,
            lastOptimizedAt: new Date().toISOString(),
          }));
        }
        applied.push({ action, ok: true });
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
