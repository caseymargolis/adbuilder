import { NextResponse } from "next/server";
import { getClient, removeAd, upsertClient } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ adId: string }> },
) {
  const { adId } = await params;
  const { clientId } = (await req.json()) as { clientId: string };

  const client = await getClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ad = client.ads.find((a) => a.id === adId);
  if (!ad) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }

  // Only allow deleting drafts — launched or queued ads should not disappear
  if (ad.status !== "draft") {
    return NextResponse.json(
      { error: "Only draft ads can be deleted." },
      { status: 400 },
    );
  }

  await removeAd(clientId, adId);
  return NextResponse.json({ ok: true });
}
