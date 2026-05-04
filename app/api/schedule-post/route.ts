import { NextResponse } from "next/server";
import { getClient, newId, upsertClient } from "@/lib/db";
import { schedulePost } from "@/lib/social-publisher";

/**
 * Schedule (or re-schedule) an existing organic post.
 *
 *   POST /api/schedule-post { clientId, postId, scheduledAt? }
 *
 * If scheduledAt is omitted, we use the post's existing scheduledAt.
 *
 * Behavior:
 *   - When BUFFER_ACCESS_TOKEN is set, hits Buffer to actually queue it.
 *   - Otherwise, marks the post "scheduled" locally and writes a
 *     ScheduledItem to our queue. The /api/cron/publish-scheduled cron
 *     will email a copy-paste reminder when it comes due.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { clientId, postId, scheduledAt } = (await req.json()) as {
    clientId: string;
    postId: string;
    scheduledAt?: string;
  };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = (client.organicPosts ?? []).find((p) => p.id === postId);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  if (scheduledAt) post.scheduledAt = scheduledAt;
  if (!post.scheduledAt) {
    return NextResponse.json(
      { error: "Provide scheduledAt or set one on the post first." },
      { status: 400 },
    );
  }

  const result = await schedulePost(post);
  if (result.ok) {
    post.status = "scheduled";
    post.bufferUpdateId = result.bufferUpdateId;
    post.externalUrl = result.externalUrl;
  } else {
    // Mark as scheduled locally so the queue picks it up.
    post.status = "scheduled";
    client.scheduledItems = [
      ...(client.scheduledItems ?? []),
      {
        id: newId("sch"),
        clientId: client.id,
        type: "publish_organic",
        refId: post.id,
        scheduledAt: post.scheduledAt,
        status: "pending",
      },
    ];
  }

  await upsertClient(client);
  return NextResponse.json({ post, bufferOk: result.ok, note: result.error });
}
