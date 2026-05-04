import { AGENTS, withPersona, type AgentId } from "@/lib/agents";
import { streamChat } from "@/lib/anthropic";
import { getClient } from "@/lib/db";
import { CHAT_SYSTEM } from "@/lib/prompts";
import type { AdRecord, ClientRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const {
    clientId,
    messages,
    agentId = "atlas",
    audience = "pm",
    scope,
  } = (await req.json()) as {
    clientId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    agentId?: AgentId;
    audience?: "client" | "pm";
    scope?: { adId?: string; campaignId?: string };
  };
  const client = await getClient(clientId);
  if (!client) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const agent = AGENTS[agentId];
  const context = buildContext({ client, agent: agentId, audience, scope });
  const system = `${withPersona(agentId, CHAT_SYSTEM)}\n\n---\nCONTEXT (for ${agent.name}):\n${context}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of streamChat({
          system,
          messages,
          task: "chat",
          maxTokens: 4000,
        })) {
          controller.enqueue(encoder.encode(delta));
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(`\n\n[Error: ${(e as Error).message}]`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

function buildContext(args: {
  client: ClientRecord;
  agent: AgentId;
  audience: "client" | "pm";
  scope?: { adId?: string; campaignId?: string };
}): string {
  const { client, agent, audience, scope } = args;
  const lines: string[] = [];
  lines.push(`AUDIENCE: ${audience} (${audience === "client" ? "business owner — outcomes language, no jargon" : "PM — every number"})`);
  lines.push(`Client: ${client.name} (${client.websiteUrl})`);
  lines.push(`Goal: ${client.goal}. Monthly budget: $${client.monthlyBudgetUsd}.`);
  lines.push(`Offer: ${client.offer}`);

  if (client.analysis) {
    lines.push("");
    lines.push("Brand analysis:");
    lines.push(`- TL;DR: ${client.analysis.tldr}`);
    lines.push(`- Audience: ${client.analysis.audienceGuess}`);
    lines.push(`- Voice: ${client.analysis.voice}`);
  }

  // Filter ads + game plans + posts based on the agent's scope.
  const ads = filterByAgent(client.ads, agent);
  const plans = (client.gamePlans ?? []).filter((p) =>
    relevantPlanForAgent(agent, p.scope),
  );
  const posts = client.organicPosts ?? [];

  if (plans.length > 0) {
    lines.push("");
    lines.push("Game plan(s) for your scope:");
    for (const plan of plans) {
      lines.push(`- [${plan.scope}] TL;DR: ${plan.tldr}`);
      lines.push(`  Phases: ${plan.phases.map((ph) => `${ph.number}.${ph.name}(${ph.durationDays}d)`).join(", ")}`);
    }
  }

  // Apply ad-level scope if the user asked about a specific ad.
  let scopedAds = ads;
  if (scope?.adId) scopedAds = ads.filter((a) => a.id === scope.adId);
  if (scope?.campaignId) {
    scopedAds = ads.filter(
      (a) => a.metaCampaignId === scope.campaignId || a.googleCampaignResource === scope.campaignId,
    );
  }

  if (agent !== "river" && scopedAds.length) {
    lines.push("");
    lines.push("Ads in scope:");
    for (const a of scopedAds) {
      const m = a.metrics;
      const metricStr = m
        ? `spend=$${m.spend.toFixed(0)} clicks=${m.clicks} ctr=${(m.ctr * 100).toFixed(2)}% conv=${m.conversions} cpa=$${m.cpa.toFixed(2)}`
        : "no metrics yet";
      lines.push(
        `- ${a.id} (${a.platform ?? "meta"}/${a.status}) angle="${a.creative.angle}" headline="${a.creative.headline}" — ${metricStr}`,
      );
    }
  }

  if ((agent === "river" || agent === "atlas" || agent === "lex") && posts.length) {
    lines.push("");
    lines.push("Recent organic posts:");
    for (const p of posts.slice(0, 12)) {
      lines.push(
        `- ${p.platform} (${p.status}) angle="${p.angle}" — ${p.caption.slice(0, 120)}…`,
      );
    }
  }

  if (
    (agent === "atlas" || agent === "lex") &&
    client.optimizations.length > 0
  ) {
    lines.push("");
    lines.push(`Latest optimization (${client.optimizations[0].at}):`);
    lines.push(client.optimizations[0].summary);
  }

  if (agent === "lex" && (client.reports ?? []).length > 0) {
    lines.push("");
    lines.push(
      `Last report sent: ${client.reports![0].audience} on ${client.reports![0].generatedAt}`,
    );
    lines.push(`Reported TL;DR: ${client.reports![0].tldr}`);
  }

  return lines.join("\n");
}

function filterByAgent(ads: AdRecord[], agent: AgentId): AdRecord[] {
  switch (agent) {
    case "molly":
      return ads.filter((a) => (a.platform ?? "meta") === "meta");
    case "geo":
      return ads.filter((a) => a.platform === "google");
    case "river":
      return [];
    default:
      return ads;
  }
}

function relevantPlanForAgent(
  agent: AgentId,
  scope: "meta" | "google" | "organic",
): boolean {
  if (agent === "atlas" || agent === "lex") return true;
  if (agent === "molly") return scope === "meta";
  if (agent === "geo") return scope === "google";
  if (agent === "river") return scope === "organic";
  return false;
}
