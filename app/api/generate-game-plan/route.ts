import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import { generateGamePlan } from "@/lib/game-plan";
import type { GamePlanScope } from "@/lib/types";

/**
 * Atlas writes the game plan for one scope (meta / google / organic).
 *
 *   POST /api/generate-game-plan { clientId, scope }
 */
export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: Request) {
  const { clientId, scope } = (await req.json()) as {
    clientId: string;
    scope: GamePlanScope;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const plan = await generateGamePlan({ client, scope });

  client.gamePlans = [
    plan,
    ...(client.gamePlans ?? []).filter((p) => p.scope !== scope),
  ];
  await upsertClient(client);

  return NextResponse.json({ plan });
}
