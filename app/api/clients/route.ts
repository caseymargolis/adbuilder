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
  metaAdAccountId: z.string().optional(),
  metaPageId: z.string().optional(),
  metaAccountName: z.string().optional(),
  notifyEmail: z.string().email().optional().or(z.literal("")),
});

export async function GET() {
  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (e) {
    console.error("Failed to load clients:", e);
    return NextResponse.json(
      { error: "Failed to load clients", clients: [] },
      { status: 200 }, // Return empty array instead of 500
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { notifyEmail, ...rest } = parsed.data;
    const client: ClientRecord = {
      id: newId("c"),
      createdAt: new Date().toISOString(),
      ads: [],
      optimizations: [],
      notifyEmail: notifyEmail || undefined,
      ...rest,
    };
    await upsertClient(client);
    return NextResponse.json({ client }, { status: 201 });
  } catch (e) {
    console.error("Failed to create client:", e);
    return NextResponse.json(
      { error: "Failed to create client. Database not configured." },
      { status: 500 },
    );
  }
}
