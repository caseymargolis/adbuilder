import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import { regeneratePost } from "@/lib/organic-content";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  req: Request,
  { params }: { params: { postId: string } },
) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existingPost = (client.organicPosts ?? []).find((p) => p.id === params.postId);
  if (!existingPost) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  try {
    // Determine if we should generate images based on whether the original had one
    const withImages = !!existingPost.mediaUrl;

    const newPost = await regeneratePost({
      client,
      existingPost,
      withImages,
    });

    // Update the post in the client's organicPosts array
    const postIndex = (client.organicPosts ?? []).findIndex((p) => p.id === params.postId);
    if (postIndex !== -1) {
      client.organicPosts![postIndex] = {
        ...newPost,
        id: existingPost.id, // Keep the original ID
        clientId: existingPost.clientId,
        createdAt: existingPost.createdAt, // Keep original creation time
        scheduledAt: existingPost.scheduledAt, // Preserve original schedule
        status: existingPost.status, // Preserve status
      };
      await upsertClient(client);
    }

    return NextResponse.json({
      post: client.organicPosts![postIndex],
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
