import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-7";

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
 * Single-shot JSON response. Uses adaptive thinking + high effort on Opus 4.7.
 *
 * The prompt is expected to instruct the model to return JSON only.
 */
export async function askJson<T = unknown>(params: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
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
 * Streaming chat completion. Streams text deltas. Returns an async iterable of
 * string chunks suitable for piping into a Response body.
 */
export async function* streamChat(params: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}): AsyncGenerator<string, void, void> {
  const client = getClient();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: params.maxTokens ?? 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
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
  // Strip markdown fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back: find the first { or [ and the last matching bracket.
    const first = candidate.search(/[\[{]/);
    const last = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1)) as T;
    }
    throw new Error(`Could not parse JSON from model output:\n${text.slice(0, 500)}`);
  }
}
