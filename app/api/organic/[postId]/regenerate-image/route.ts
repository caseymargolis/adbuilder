import { NextResponse } from "next/server";
import { getClient, upsertClient } from "@/lib/db";
import { generateImage, routeImage } from "@/lib/image-provider";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: { postId: string } },
) {
  const { clientId } = (await req.json()) as { clientId: string };
  const client = await getClient(clientId);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const post = (client.organicPosts ?? []).find((p) => p.id === params.postId);
  if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  if (!post.mediaPrompt) {
    return NextResponse.json(
      { error: "This post has no media prompt to regenerate from." },
      { status: 400 },
    );
  }

  if (!client.analysis) {
    return NextResponse.json(
      { error: "Client analysis not found." },
      { status: 400 },
    );
  }

  try {
    const decision = await routeImage({
      imagePrompt: post.mediaPrompt,
      angle: post.angle,
      brandVoice: client.analysis.voice,
      brandColors: client.analysis.brandColors,
      brandFonts: client.analysis.brandFonts,
    });
    const img = await generateImage({ decision });

    // Update the post with the new image
    const postIndex = (client.organicPosts ?? []).findIndex((p) => p.id === params.postId);
    if (postIndex !== -1) {
      client.organicPosts![postIndex] = {
        ...client.organicPosts![postIndex],
        mediaUrl: img.url,
        mediaProvider: img.provider,
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
