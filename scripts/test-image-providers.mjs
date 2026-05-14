/**
 * Image provider connectivity test.
 * Run: node scripts/test-image-providers.mjs
 *
 * Tests each configured image API key in isolation so you can confirm which
 * providers are reachable and working before using them in production.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Load .env manually (no dotenv dependency needed)
// ---------------------------------------------------------------------------
const envPath = resolve(new URL(".", import.meta.url).pathname, "../.env");
const envVars = {};
try {
  readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) envVars[key.trim()] = rest.join("=").trim();
    });
} catch {
  console.error("Could not read .env file at", envPath);
  process.exit(1);
}

const PROMPT = "A red apple on a white table, product photo";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function key(name) {
  return envVars[name] || process.env[name] || null;
}

function result(provider, ok, detail) {
  const icon = ok ? "✅" : "❌";
  console.log(`\n${icon} ${provider}: ${ok ? "PASS" : "FAIL"}`);
  console.log(`   ${detail}`);
}

async function withTimeout(fn, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timed out after ${ms}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Provider tests
// ---------------------------------------------------------------------------

async function testIdeogram() {
  const apiKey = key("IDEOGRAM_API_KEY");
  if (!apiKey) return result("ideogram-v3", false, "No IDEOGRAM_API_KEY set");

  try {
    const res = await withTimeout(
      (signal) =>
        fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
          method: "POST",
          signal,
          headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: PROMPT,
            aspect_ratio: "1x1",
            rendering_speed: "TURBO",
            magic_prompt: "OFF",
          }),
        }),
      30000,
      "Ideogram",
    );
    const text = await res.text();
    if (!res.ok) return result("ideogram-v3", false, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const url = data?.data?.[0]?.url;
    if (url) result("ideogram-v3", true, `Image URL received (${url.slice(0, 60)}...)`);
    else result("ideogram-v3", false, `No URL in response: ${text.slice(0, 200)}`);
  } catch (err) {
    result("ideogram-v3", false, err.message);
  }
}

async function testFlux() {
  const apiKey = key("BFL_API_KEY");
  if (!apiKey) return result("flux-1.1-pro-ultra", false, "No BFL_API_KEY set");

  try {
    // Step 1: submit job
    console.log("\n⏳ flux-1.1-pro-ultra: Submitting job...");
    const start = await withTimeout(
      (signal) =>
        fetch("https://api.bfl.ml/v1/flux-pro-1.1", {
          method: "POST",
          signal,
          headers: { "x-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: PROMPT,
            width: 512,
            height: 512,
            steps: 20,
            guidance: 3.5,
            safety_tolerance: 2,
            output_format: "jpeg",
          }),
        }),
      30000,
      "Flux start",
    );
    const startText = await start.text();
    if (!start.ok)
      return result("flux-1.1-pro-ultra", false, `Start HTTP ${start.status}: ${startText.slice(0, 200)}`);
    const { id } = JSON.parse(startText);
    if (!id)
      return result("flux-1.1-pro-ultra", false, `No job ID returned: ${startText.slice(0, 200)}`);

    console.log(`   Job ID: ${id} — polling...`);

    // Step 2: poll
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 30; i++) {
      const poll = await withTimeout(
        (signal) =>
          fetch(`https://api.bfl.ml/v1/get_result?id=${id}`, {
            signal,
            headers: { "x-key": apiKey },
          }),
        15000,
        "Flux poll",
      );
      const data = await poll.json();
      if (data.status === "Ready" && data.result?.sample) {
        return result("flux-1.1-pro-ultra", true, `Image URL received (${data.result.sample.slice(0, 60)}...)`);
      }
      if (["Error", "Failed", "Content Moderated"].includes(data.status)) {
        return result("flux-1.1-pro-ultra", false, `Job status: ${data.status}`);
      }
      process.stdout.write(`   poll ${i + 1}/30 — status: ${data.status}\r`);
      await new Promise((r) => setTimeout(r, 1800));
    }
    result("flux-1.1-pro-ultra", false, "Polling timed out after 30 attempts");
  } catch (err) {
    result("flux-1.1-pro-ultra", false, err.message);
  }
}

async function testImagen() {
  const apiKey = key("GOOGLE_API_KEY");
  if (!apiKey) return result("imagen-4", false, "No GOOGLE_API_KEY set");

  try {
    const res = await withTimeout(
      (signal) =>
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              instances: [{ prompt: PROMPT }],
              parameters: { sampleCount: 1, aspectRatio: "1:1" },
            }),
          },
        ),
      30000,
      "Imagen",
    );
    const text = await res.text();
    if (!res.ok) return result("imagen-4", false, `HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (b64) result("imagen-4", true, `Base64 image received (${b64.length} chars)`);
    else result("imagen-4", false, `No base64 in response: ${text.slice(0, 200)}`);
  } catch (err) {
    result("imagen-4", false, err.message);
  }
}

async function testRecraft() {
  const apiKey = key("RECRAFT_API_KEY");
  if (!apiKey) return result("recraft-v3", false, "No RECRAFT_API_KEY set");

  try {
    const res = await withTimeout(
      (signal) =>
        fetch("https://external.api.recraft.ai/v1/images/generations", {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: PROMPT,
            style: "digital_illustration",
            model: "recraftv3",
            size: "1024x1024",
          }),
        }),
      30000,
      "Recraft",
    );
    const text = await res.text();
    if (!res.ok) return result("recraft-v3", false, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const url = data?.data?.[0]?.url;
    if (url) result("recraft-v3", true, `Image URL received (${url.slice(0, 60)}...)`);
    else result("recraft-v3", false, `No URL in response: ${text.slice(0, 200)}`);
  } catch (err) {
    result("recraft-v3", false, err.message);
  }
}

async function testGptImage() {
  const apiKey = key("OPENAI_API_KEY");
  if (!apiKey) return result("gpt-image-1", false, "No OPENAI_API_KEY set");

  try {
    const res = await withTimeout(
      (signal) =>
        fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-image-1",
            prompt: PROMPT,
            size: "1024x1024",
            n: 1,
          }),
        }),
      60000,
      "GPT Image",
    );
    const text = await res.text();
    if (!res.ok) return result("gpt-image-1", false, `HTTP ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const first = data?.data?.[0];
    if (first?.url) result("gpt-image-1", true, `Image URL received (${first.url.slice(0, 60)}...)`);
    else if (first?.b64_json) result("gpt-image-1", true, `Base64 image received (${first.b64_json.length} chars)`);
    else result("gpt-image-1", false, `No image in response: ${text.slice(0, 200)}`);
  } catch (err) {
    result("gpt-image-1", false, err.message);
  }
}

// ---------------------------------------------------------------------------
// Run all tests sequentially so logs are readable
// ---------------------------------------------------------------------------
console.log("=== Image Provider Tests ===");
console.log(`Prompt: "${PROMPT}"\n`);
console.log("Note: Flux test submits a real job (uses credits). Others are single requests.");

await testIdeogram();
await testFlux();
await testImagen();
await testRecraft();
await testGptImage();

console.log("\n=== Done ===\n");
