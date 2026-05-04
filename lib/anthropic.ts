import Anthropic from "@anthropic-ai/sdk";
import type { CopyTask } from "./copy-router";
import { pickModel } from "./copy-router";

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

let _client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example → .env and paste a key.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Single-shot JSON response. Per-call task type picks the model + effort
 * via copy-router; you can also override directly with `model`/`effort`.
 *
 * The prompt is expected to instruct the model to return JSON only.
 */
export async function askJson<T = unknown>(params: {
  system: string;
  user: string;
  task?: CopyTask;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  maxTokens?: number;
}): Promise<T> {
  const client = getClient();
  const choice = params.task ? pickModel(params.task) : null;
  const model = params.model ?? choice?.model ?? DEFAULT_MODEL;
  const effort = params.effort ?? choice?.effort ?? "high";
  const response = await client.messages.create({
    model,
    max_tokens: params.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: { effort },
    system: [
      { type: "text", text: params.system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: params.user }],
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();
  return parseJsonLoose<T>(text);
}

/**
 * Streaming chat completion. Streams text deltas. Returns an async iterable
 * of string chunks suitable for piping into a Response body.
 */
export async function* streamChat(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  task?: CopyTask;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  maxTokens?: number;
}): AsyncGenerator<string, void, void> {
  const client = getClient();
  const choice = params.task ? pickModel(params.task) : null;
  const model = params.model ?? choice?.model ?? DEFAULT_MODEL;
  const effort = params.effort ?? choice?.effort ?? "medium";
  const stream = client.messages.stream({
    model,
    max_tokens: params.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    output_config: { effort },
    system: [
      { type: "text", text: params.system, cache_control: { type: "ephemeral" } },
    ],
    messages: params.messages,
  });
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

/**
 * LLMs sometimes wrap JSON in code fences or add a stray sentence. This is a
 * tiny resilient parser that extracts the first valid JSON object or array.
 */
export function parseJsonLoose<T>(text: string): T {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const first = candidate.search(/[\[{]/);
    const last = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1)) as T;
    }
    throw new Error(`Could not parse JSON from model output:\n${text.slice(0, 500)}`);
  }
}
