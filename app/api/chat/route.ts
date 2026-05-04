import { getClient } from "@/lib/db";
import { streamChat } from "@/lib/anthropic";
import { CHAT_SYSTEM } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId, messages } = (await req.json()) as {
    clientId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const client = await getClient(clientId);
  if (!client) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  const context = buildContext(client);
  const system = `${CHAT_SYSTEM}\n\n---\nCONTEXT FOR THIS SESSION:\n${context}`;

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

function buildContext(client: Awaited<ReturnType<typeof getClient>>): string {
  if (!client) return "";
  const lines: string[] = [];
  lines.push(`Client: ${client.name} (${client.websiteUrl})`);
  lines.push(`Goal: ${client.goal}. Monthly budget: $${client.monthlyBudgetUsd}.`);
  lines.push(`Offer: ${client.offer}`);
  if (client.analysis) {
    lines.push("");
    lines.push("Website analysis:");
    lines.push(`- TL;DR: ${client.analysis.tldr}`);
    lines.push(`- Audience guess: ${client.analysis.audienceGuess}`);
    lines.push(`- Voice: ${client.analysis.voice}`);
  }
  if (client.ads.length) {
    lines.push("");
    lines.push("Ads in this account:");
    for (const a of client.ads) {
      const m = a.metrics;
      const metricStr = m
        ? `spend=$${m.spend.toFixed(0)} clicks=${m.clicks} ctr=${(m.ctr * 100).toFixed(2)}% conv=${m.conversions} cpa=$${m.cpa.toFixed(2)}`
        : "no metrics yet";
      lines.push(
        `- ${a.id} (${a.status}) angle="${a.creative.angle}" headline="${a.creative.headline}" — ${metricStr}`,
      );
    }
  }
  if (client.optimizations.length) {
    lines.push("");
    lines.push(`Latest optimization pass (${client.optimizations[0].at}):`);
    lines.push(client.optimizations[0].summary);
  }
  return lines.join("\n");
}
