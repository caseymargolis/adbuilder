import { NextResponse } from "next/server";
import { deleteClient, getClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const client = await getClient(params.id);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ client });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  await deleteClient(params.id);
  return NextResponse.json({ success: true });
}
