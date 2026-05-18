import type { AdRecord, ClientRecord } from "./types";

export function isLiveAd(ad: AdRecord): boolean {
  if (ad.status !== "live" && ad.status !== "winner") return false;
  const platform = ad.platform ?? "meta";
  if (platform === "google") {
    return Boolean(ad.googleAdResource && !ad.googleAdResource.startsWith("mock_"));
  }
  return Boolean(ad.metaAdId && !ad.metaAdId.startsWith("mock_"));
}

export function getLiveAds(client: ClientRecord): AdRecord[] {
  return client.ads.filter(isLiveAd);
}

export function hasLiveAds(client: ClientRecord): boolean {
  return getLiveAds(client).length > 0;
}
