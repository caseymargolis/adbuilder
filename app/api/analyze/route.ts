import { NextResponse } from "next/server";
import { askJson } from "@/lib/anthropic";
import { getClient, upsertClient } from "@/lib/db";
import { ANALYSIS_SYSTEM } from "@/lib/prompts";
import { readWebsite } from "@/lib/site-reader";
import type { WebsiteAnalysis } from "@/lib/types";

export async function POST(req: Request) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const site = await readWebsite(client.websiteUrl);

  const user = [
    "CLIENT CONTEXT",
    `- Business: ${client.name}`,
    `- Offer: ${client.offer}`,
    `- Primary goal: ${client.goal}`,
    `- Monthly budget: $${client.monthlyBudgetUsd}`,
    `- Audience notes from the client: ${client.audienceNotes || "(none)"}`,
    "",
    "WEBSITE",
    `- URL: ${site.url}`,
    `- <title>: ${site.title}`,
    `- <meta description>: ${site.description}`,
    site.jsRendered
      ? "- NOTE: This site looks JavaScript-rendered. We only got a thin HTML. Call this out in your 'risks' section."
      : "",
    "",
    "PAGE TEXT (scraped from the homepage, up to ~20k chars):",
    site.text,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await askJson<Omit<WebsiteAnalysis, "generatedAt">>({
    system: ANALYSIS_SYSTEM,
    user,
    maxTokens: 8000,
  });

  const analysis: WebsiteAnalysis = {
    ...data,
    generatedAt: new Date().toISOString(),
  };
  client.analysis = analysis;
  await upsertClient(client);

  return NextResponse.json({ analysis });
}
