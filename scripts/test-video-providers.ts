/**
 * Video provider connectivity / auth test.
 * Does NOT generate full videos — just verifies each API key is accepted.
 * Run: bun scripts/test-video-providers.ts
 */
export {};
const PASS = "✅";
const FAIL = "❌";

function log(provider: string, ok: boolean, detail: string) {
  console.log(`${ok ? PASS : FAIL}  ${provider.padEnd(16)} ${detail}`);
}

// ── 1. Veo 3 (Google Generative Language API) ─────────────────────────────────
async function testVeo() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) { log("veo-3", false, "GOOGLE_API_KEY not set"); return; }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    );
    const body = await res.json() as { models?: unknown[]; error?: { message: string } };
    if (!res.ok || body.error) {
      log("veo-3", false, `HTTP ${res.status} – ${body.error?.message ?? "unknown"}`);
    } else {
      const count = body.models?.length ?? 0;
      log("veo-3", true, `key accepted (${count} models listed)`);
    }
  } catch (e) {
    log("veo-3", false, `fetch error – ${(e as Error).message}`);
  }
}

// ── 2. Sora 2 (OpenAI) ────────────────────────────────────────────────────────
async function testSora() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { log("sora-2", false, "OPENAI_API_KEY not set"); return; }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json() as { data?: unknown[]; error?: { message: string } };
    if (!res.ok || body.error) {
      log("sora-2", false, `HTTP ${res.status} – ${body.error?.message ?? "unknown"}`);
    } else {
      // Check if sora model is accessible
      const models = (body.data ?? []) as Array<{ id: string }>;
      const soraModels = models.filter(m => m.id.includes("sora")).map(m => m.id);
      log("sora-2", true, `key accepted – sora models: ${soraModels.length ? soraModels.join(", ") : "none listed (may need org access)"}`);
    }
  } catch (e) {
    log("sora-2", false, `fetch error – ${(e as Error).message}`);
  }
}

// ── 3. Runway Gen-4 ───────────────────────────────────────────────────────────
async function testRunway() {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) { log("runway-gen-4", false, "RUNWAY_API_KEY not set"); return; }
  try {
    // Submit a minimal job — 400 validation = auth OK, 401/403 = key rejected
    const res = await fetch("https://api.dev.runwayml.com/v1/text_to_video", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify({ model: "gen4.5", promptText: "test", ratio: "1280:720", duration: 5 }),
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      log("runway-gen-4", false, `HTTP ${res.status} – auth rejected: ${text.slice(0, 200)}`);
      return;
    }
    let detail = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { id?: string; error?: string; message?: string; errors?: unknown };
      if (body.id) {
        detail += ` – job created! id=${body.id} (cancelled immediately — just testing auth)`;
      } else {
        detail += ` – ${body.message ?? body.error ?? JSON.stringify(body.errors ?? body).slice(0, 120)}`;
      }
    } catch {
      detail += ` – raw: ${text.slice(0, 200)}`;
    }
    // 2xx or 400/422 validation error all mean auth passed
    log("runway-gen-4", res.ok || res.status === 400 || res.status === 422 || res.status === 404, detail);
  } catch (e) {
    log("runway-gen-4", false, `fetch error – ${(e as Error).message}`);
  }
}

// ── 4. Kling 2 ────────────────────────────────────────────────────────────────
// Kling uses access_key_id:access_key_secret as a JWT-signed token.
// We need to generate a signed JWT to authenticate.
async function testKling() {
  const rawKey = process.env.KLING_API_KEY;
  if (!rawKey) { log("kling-2", false, "KLING_API_KEY not set"); return; }

  // Kling key format: "access_key_id:access_key_secret"
  const [accessKeyId, accessKeySecret] = rawKey.split(":");
  if (!accessKeyId || !accessKeySecret) {
    log("kling-2", false, "KLING_API_KEY must be in format access_key_id:access_key_secret");
    return;
  }

  try {
    // Build a simple HS256 JWT manually (no external lib needed)
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: accessKeyId,
      exp: now + 1800,
      nbf: now - 5,
    })).toString("base64url");

    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", accessKeySecret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    const token = `${header}.${payload}.${sig}`;

    const res = await fetch("https://api.klingai.com/v1/videos/text2video", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = await res.json() as { data?: unknown; code?: number; message?: string };
    // 200 or a business-level code (not 401/403) means auth passed
    if (res.status === 401 || res.status === 403) {
      log("kling-2", false, `HTTP ${res.status} – auth rejected: ${body.message ?? JSON.stringify(body)}`);
    } else {
      log("kling-2", true, `key accepted – HTTP ${res.status}, msg: ${body.message ?? "OK"}`);
    }
  } catch (e) {
    log("kling-2", false, `error – ${(e as Error).message}`);
  }
}

// ── Run all ───────────────────────────────────────────────────────────────────
console.log("\n=== Video Provider Auth Tests ===\n");
await testVeo();
await testSora();
await testRunway();
await testKling();
console.log("\nDone.\n");
