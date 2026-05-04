/**
 * Strategic game plan generator.
 *
 * Per platform (Meta / Google / organic), produces a phased rollout plan
 * with success checks built in. Stored on the client record so the
 * workspace shows it, the chat references it, and the optimizer can
 * cite it ("we said in Phase 1 we'd kill anything over $24 CPA").
 */

import { askJson } from "./anthropic";
import { newId } from "./db";
import { GAME_PLAN_SYSTEM } from "./prompts";
import type { ClientRecord, GamePlan, GamePlanScope } from "./types";

export async function generateGamePlan(args: {
  client: ClientRecord;
  scope: GamePlanScope;
}): Promise<GamePlan> {
  const { client, scope } = args;
  if (!client.analysis) {
    throw new Error("Run the analysis before generating a game plan.");
  }
  const a = client.analysis;
  const user = [
    `SCOPE FOR THIS PLAN: ${scope.toUpperCase()}`,
    "",
    "CLIENT",
    `- Name: ${client.name}`,
    `- Offer: ${client.offer}`,
    `- Goal: ${client.goal}`,
    `- Monthly budget: $${client.monthlyBudgetUsd}`,
    `- Audience notes: ${client.audienceNotes || "(none)"}`,
    "",
    "ANALYSIS",
    `- TL;DR: ${a.tldr}`,
    `- Positioning: ${a.positioning}`,
    `- Audience: ${a.audienceGuess}`,
    `- Differentiators: ${a.differentiators.join("; ")}`,
    `- Objections: ${a.objections.join("; ")}`,
    `- Proof points: ${a.proofPoints.join("; ")}`,
    `- Conversion surfaces: ${a.conversionSurfaces.join("; ")}`,
    `- Brand voice: ${a.voice}`,
    `- Risks: ${a.risks.join("; ")}`,
    a.competitorAdsSummary ? `- Competitor ad activity: ${a.competitorAdsSummary}` : "",
    "",
    `Write the ${scope} game plan.`,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await askJson<Omit<GamePlan, "id" | "generatedAt" | "scope">>({
    system: GAME_PLAN_SYSTEM,
    user,
    task: "strategy",
    maxTokens: 8000,
  });

  return {
    id: newId("gp"),
    generatedAt: new Date().toISOString(),
    scope,
    ...data,
  };
}
