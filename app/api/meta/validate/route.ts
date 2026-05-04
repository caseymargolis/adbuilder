import { NextResponse } from "next/server";
import { getMetaConfig, validateMetaConfig } from "@/lib/meta";

/**
 * Lets the onboarding form check whether the (env token + supplied ad
 * account + supplied page) actually works before saving the client.
 *
 *   POST /api/meta/validate
 *   { adAccountId: "act_123", pageId: "456" }
 *
 * Returns: { ok: true, accountName } or { ok: false, error }.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const { adAccountId, pageId } = (await req.json().catch(() => ({}))) as {
    adAccountId?: string;
    pageId?: string;
  };
  if (!adAccountId || !pageId) {
    return NextResponse.json(
      { ok: false, error: "Both adAccountId and pageId are required." },
      { status: 400 },
    );
  }
  const config = getMetaConfig({ adAccountId, pageId });
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "META_ACCESS_TOKEN isn't set on the server. Add it to .env (System User token from your Meta Business Manager).",
      },
      { status: 503 },
    );
  }
  const result = await validateMetaConfig(config);
  return NextResponse.json(result);
}
