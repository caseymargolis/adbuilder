import { NextResponse } from "next/server";
import { z } from "zod";
import { listClients, newId, upsertClient } from "@/lib/db";
import type { ClientRecord } from "@/lib/types";

const CreateSchema = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().min(3),
  goal: z.enum(["leads", "sales", "traffic", "awareness", "app_installs", "messages"]),
  monthlyBudgetUsd: z.coerce.number().min(100),
  offer: z.string().min(1),
  audienceNotes: z.string().default(""),
});

export async function GET() {
  const clients = await listClients();
  return NextResponse.json({ clients });
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const client: ClientRecord = {
    id: newId("c"),
    createdAt: new Date().toISOString(),
    ads: [],
    optimizations: [],
    ...parsed.data,
  };
  await upsertClient(client);
  return NextResponse.json({ client }, { status: 201 });
}
