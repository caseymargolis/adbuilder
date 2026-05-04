/**
 * Organic publisher.
 *
 * Best tool: Buffer's API. One auth flow → IG, FB, LinkedIn, X, TikTok,
 * Threads, Pinterest, Bluesky, GBP. Sub-cent per post. Standard schedule
 * model. Avoids us having to integrate every platform's API + handle
 * every platform's OAuth refresh quirks.
 *
 * https://buffer.com/developers/api/
 *
 * If BUFFER_ACCESS_TOKEN isn't configured, we mark posts as "scheduled"
 * in our local queue and the cron emails the team a copy-paste reminder.
 * The user can swap to direct platform APIs by replacing this module —
 * everything upstream is abstract.
 */

import type { OrganicPlatform, OrganicPost } from "./types";

interface PublishResult {
  ok: boolean;
  externalUrl?: string;
  bufferUpdateId?: string;
  error?: string;
}

const BUFFER_API = "https://api.bufferapp.com/1";

export function publisherConfigured(): boolean {
  return !!process.env.BUFFER_ACCESS_TOKEN;
}

/**
 * Schedule a post via Buffer for its `scheduledAt` time.
 * Caller is responsible for setting `scheduledAt`.
 */
export async function schedulePost(post: OrganicPost): Promise<PublishResult> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      error:
        "BUFFER_ACCESS_TOKEN not configured. Post saved locally; the cron will email a copy-paste reminder.",
    };
  }

  // Buffer's profiles are per-user. We expect the agency to map our
  // platform name → Buffer profile_id via env var, e.g.:
  //   BUFFER_PROFILE_INSTAGRAM=5f1...
  //   BUFFER_PROFILE_LINKEDIN=5f1...
  const profileId = bufferProfileFor(post.platform);
  if (!profileId) {
    return {
      ok: false,
      error: `No Buffer profile id configured for ${post.platform}. Set BUFFER_PROFILE_${post.platform.toUpperCase()}.`,
    };
  }

  const fullText = [post.caption, post.hashtags.map((h) => `#${h}`).join(" ")]
    .filter(Boolean)
    .join("\n\n");

  // Buffer expects scheduled_at as a unix timestamp.
  const scheduledAt = post.scheduledAt
    ? Math.floor(new Date(post.scheduledAt).getTime() / 1000)
    : undefined;

  const params = new URLSearchParams();
  params.append("profile_ids[]", profileId);
  params.append("text", fullText);
  if (post.mediaUrl) params.append("media[photo]", post.mediaUrl);
  if (scheduledAt) params.append("scheduled_at", String(scheduledAt));
  // Use the user's pre-set Buffer slots if no scheduledAt
  if (!scheduledAt) params.append("now", "false");

  const res = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    return { ok: false, error: `Buffer ${res.status}: ${await res.text()}` };
  }
  const data = (await res.json()) as {
    success?: boolean;
    updates?: Array<{ id: string; service_link?: string }>;
  };
  if (!data.success) {
    return { ok: false, error: "Buffer returned success: false" };
  }
  const update = data.updates?.[0];
  return {
    ok: true,
    bufferUpdateId: update?.id,
    externalUrl: update?.service_link,
  };
}

/** Cancel a scheduled Buffer update. */
export async function cancelScheduledPost(bufferUpdateId: string): Promise<void> {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) return;
  await fetch(`${BUFFER_API}/updates/${bufferUpdateId}/destroy.json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function bufferProfileFor(platform: OrganicPlatform): string | undefined {
  const key = `BUFFER_PROFILE_${platform.toUpperCase()}`;
  return process.env[key];
}
