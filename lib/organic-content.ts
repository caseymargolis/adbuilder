/**
 * Organic content generation (River's beat).
 *
 * Produces a 12-post draft calendar across the platforms the client
 * targets. Each post knows its angle, hashtags (where appropriate), a
 * media prompt for the image/video tool, and a suggested day/hour.
 */

import { askJson } from "./anthropic";
import { newId } from "./db";
import { generateImage, routeImage } from "./image-provider";
import { ORGANIC_CONTENT_SYSTEM } from "./prompts";
import type {
  ClientRecord,
  OrganicPost,
  OrganicPlatform,
} from "./types";

interface GeneratedPost {
  platform: OrganicPlatform;
  caption: string;
  hashtags: string[];
  mediaPrompt: string | null;
  angle: string;
  hypothesis: string;
  suggestedDay: number;
  suggestedHourLocal: number;
}

export async function generateOrganicCalendar(args: {
  client: ClientRecord;
  platforms: OrganicPlatform[];
  withImages: boolean;
}): Promise<OrganicPost[]> {
  const { client, platforms, withImages } = args;
  if (!client.analysis) {
    throw new Error("Run the analysis first.");
  }
  const a = client.analysis;
  const user = [
    "CLIENT",
    `- Name: ${client.name}`,
    `- Offer: ${client.offer}`,
    `- Brand voice: ${a.voice}`,
    `- Audience: ${a.audienceGuess}`,
    `- Differentiators: ${a.differentiators.join("; ")}`,
    `- Customer language to lean on (from reviews/Reddit): ${a.proofPoints.join("; ")}`,
    "",
    `PLATFORMS TO PLAN: ${platforms.join(", ")}`,
    "",
    "Distribute 12 posts across these platforms. Don't repeat angles within a platform.",
  ].join("\n");

  const drafts = await askJson<GeneratedPost[]>({
    system: ORGANIC_CONTENT_SYSTEM,
    user,
    task: "creative_battery",
    maxTokens: 9000,
  });

  // Optional: route + render an image for posts that have a mediaPrompt.
  // We do this in parallel but don't fail the whole calendar if one image
  // generation hiccups.
  const enriched = await Promise.all(
    drafts.map(async (d): Promise<OrganicPost> => {
      let mediaUrl: string | undefined;
      let mediaProvider: string | undefined;
      if (withImages && d.mediaPrompt) {
        try {
          const decision = await routeImage({
            imagePrompt: d.mediaPrompt,
            angle: d.angle,
            brandVoice: a.voice,
            brandColors: a.brandColors,
            brandFonts: a.brandFonts,
          });
          const img = await generateImage({ decision });
          mediaUrl = img.url;
          mediaProvider = img.provider;
        } catch {
          /* leave mediaUrl undefined; UI shows the prompt and the user can re-render */
        }
      }
      return {
        id: newId("p"),
        clientId: client.id,
        createdAt: new Date().toISOString(),
        platform: d.platform,
        caption: d.caption,
        hashtags: d.hashtags ?? [],
        mediaPrompt: d.mediaPrompt ?? undefined,
        mediaUrl,
        mediaProvider,
        scheduledAt: nextSlotForDayHour(d.suggestedDay, d.suggestedHourLocal),
        status: "draft",
        angle: d.angle,
        hypothesis: d.hypothesis,
      };
    }),
  );
  return enriched;
}

/** Pick the next ISO timestamp matching a target weekday + hour. */
function nextSlotForDayHour(day: number, hour: number): string {
  const now = new Date();
  const target = new Date(now);
  const currentDay = (now.getUTCDay() + 6) % 7; // 0 = Mon in our schema
  const daysAhead = (day - currentDay + 7) % 7 || 7; // always future
  target.setUTCDate(now.getUTCDate() + daysAhead);
  target.setUTCHours(hour, 0, 0, 0);
  return target.toISOString();
}
