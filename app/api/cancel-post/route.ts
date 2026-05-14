import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";

/**
 * Cancel a scheduled organic post.
 *
 *   POST /api/cancel-post { clientId, postId }
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId, postId } = (await req.json()) as {
    clientId: string;
    postId: string;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = (client.organicPosts ?? []).find((p) => p.id === postId);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  post.status = "cancelled";
  post.scheduledAt = undefined;
  post.bufferUpdateId = undefined;
  post.externalUrl = undefined;

  // Also remove from scheduled items queue
  client.scheduledItems = (client.scheduledItems ?? []).filter(
    (item) => !(item.type === "publish_organic" && item.refId === postId)
  );

  await upsertClient(client);
  return NextResponse.json({ post });
}
