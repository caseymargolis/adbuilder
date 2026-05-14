/**
 * Copy / text-generation routing.
 *
 * We were running every text task on Opus 4.7. That's the right tool for
 * strategy, voice, and ad creative — but for streaming chat (latency
 * matters), short rewrites, and quick utility calls, Sonnet 4.6 and
 * Haiku 4.5 are better tools at lower cost without quality loss.
 *
 * Tasks ranked by what they actually need:
 *
 *   strategy           → Opus 4.7 / effort:high   (analysis, optimization
 *                                                   judgment — cost is fine)
 *   creative_battery   → Opus 4.7 / effort:high   (5-variant ad gen — quality
 *                                                   is the whole point)
 *   chat               → Sonnet 4.6 / medium      (latency matters; Sonnet
 *                                                   is great at conversation)
 *   single_rewrite     → Sonnet 4.6 / medium      (regenerate one headline,
 *                                                   tweak one variant)
 *   util               → Haiku 4.5 / low          (extract a label, summarize
 *                                                   a metric, classify)
 *
 * If you change one of these, the change applies to every call site.
 */

export type CopyTask =
  | "strategy"
  | "creative_battery"
  | "chat"
  | "single_rewrite"
  | "util";

export interface CopyModelChoice {
  model: string;
  effort: "low" | "medium" | "high" | "max";
}

export function pickModel(task: CopyTask): CopyModelChoice {
  switch (task) {
    case "strategy":
    case "creative_battery":
      return { model: "claude-opus-4-20250514", effort: "high" };
    case "chat":
    case "single_rewrite":
      return { model: "claude-sonnet-4-20250514", effort: "medium" };
    case "util":
      return { model: "claude-haiku-4-5-20251001", effort: "low" };
  }
}
