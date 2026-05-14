import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(new URL(".", import.meta.url).pathname, "../.env");
const envVars = {};
readFileSync(envPath, "utf8")
  .split("\n")
  .forEach((line) => {
    const [k, ...rest] = line.split("=");
    if (k && rest.length) envVars[k.trim()] = rest.join("=").trim();
  });

const key = (name) => envVars[name] || process.env[name] || null;
const PROMPT = "A red apple on a white table, product photo";

function pass(label, detail) { console.log(`\n✅ ${label}: PASS\n   ${detail}`); }
function fail(label, detail) { console.log(`\n❌ ${label}: FAIL\n   ${detail}`); }

// --- Flux ---
async function testFlux() {
  const apiKey = key("BFL_API_KEY");
  if (!apiKey) return fail("Flux", "No BFL_API_KEY set");

  console.log("\n⏳ Flux: Submitting job...");
  try {
    const start = await fetch("https://api.bfl.ml/v1/flux-pro-1.1", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "x-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: PROMPT, width: 512, height: 512, steps: 20, guidance: 3.5, safety_tolerance: 2, output_format: "jpeg" }),
    });
    const startText = await start.text();
    if (!start.ok) return fail("Flux", `Start HTTP ${start.status}: ${startText.slice(0, 300)}`);
    const { id } = JSON.parse(startText);
    if (!id) return fail("Flux", `No job ID: ${startText.slice(0, 300)}`);
    console.log(`   Job ID: ${id} — polling...`);
    await new Promise((r) => setTimeout(r, 2500));
    for (let i = 0; i < 30; i++) {
      const poll = await fetch(`https://api.bfl.ml/v1/get_result?id=${id}`, {
        signal: AbortSignal.timeout(15000),
        headers: { "x-key": apiKey },
      });
      const data = await poll.json();
      process.stdout.write(`   poll ${i + 1}/30 — status: ${data.status}   \r`);
      if (data.status === "Ready" && data.result?.sample)
        return pass("Flux", `Image URL: ${data.result.sample.slice(0, 80)}...`);
      if (["Error", "Failed", "Content Moderated"].includes(data.status))
        return fail("Flux", `Job ended with status: ${data.status}`);
      await new Promise((r) => setTimeout(r, 1800));
    }
    fail("Flux", "Polling timed out after 30 attempts");
  } catch (err) {
    fail("Flux", err.message + (err.cause ? ` | cause: ${err.cause.message}` : ""));
  }
}

// --- Imagen 4 ---
async function testImagen() {
  const apiKey = key("GOOGLE_API_KEY");
  if (!apiKey) return fail("Imagen-4", "No GOOGLE_API_KEY set");

  console.log("\n⏳ Imagen-4: Sending request...");
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: PROMPT }],
          parameters: { sampleCount: 1, aspectRatio: "1:1" },
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) return fail("Imagen-4", `HTTP ${res.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text);
    const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
    if (b64) pass("Imagen-4", `Base64 image received (${b64.length} chars)`);
    else fail("Imagen-4", `No base64 in response: ${text.slice(0, 200)}`);
  } catch (err) {
    fail("Imagen-4", err.message + (err.cause ? ` | cause: ${err.cause.message}` : ""));
  }
}

console.log("=== Flux + Google Imagen Test ===");
await testFlux();
await testImagen();
console.log("\n=== Done ===\n");
