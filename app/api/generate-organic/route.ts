import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import { generateOrganicCalendar } from "@/lib/organic-content";
import type { OrganicPlatform } from "@/lib/types";

/**
 * River generates the post calendar.
 *
 *   POST /api/generate-organic { clientId, platforms[], withImages? }
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { clientId, platforms, withImages } = (await req.json()) as {
    clientId: string;
    platforms: OrganicPlatform[];
    withImages?: boolean;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!platforms?.length) {
    return NextResponse.json(
      { error: "Pick at least one platform." },
      { status: 400 },
    );
  }

  const posts = await generateOrganicCalendar({
    client,
    platforms,
    withImages: withImages ?? true,
  });

  client.organicPosts = [...(client.organicPosts ?? []), ...posts];
  await upsertClient(client);

  return NextResponse.json({ posts });
}
