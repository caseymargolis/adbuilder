# Adwise

Internal Meta Ads tool. Paste a client website, pick a goal, get a data-backed
test battery (images **or** video), launch it to Meta, and let the thing tune
itself daily. Comes with a chat companion that answers the question, not the
LinkedIn version.

## What it actually does

1. **Reads the client's site.** Fetches the homepage and briefs Claude Opus 4.7
   on what the business actually sells, who's buying, and what'll bite us. Two
   reader paths: a fast `fetch`-based one (default) and an optional headless
   Chromium pass via Playwright for JS-rendered SPAs. The app upgrades
   automatically when the headless dep is installed.
2. **Generates a 5-variant test battery.** Each variant pulls a different lever
   (pain-point, social proof, contrarian, outcome-specific, curiosity) and
   says *why* it should work for *this* audience.
3. **Pairs each ad with an image from the best model for the job.**
   - **Ideogram 3.0** for ads with text rendered in the image (posters).
   - **FLUX 1.1 Pro Ultra** for photorealistic product / lifestyle.
   - **Google Imagen 4** for illustrations / editorial / stylized.
   - **OpenAI gpt-image-1** as a forgiving generalist fallback.
4. **Generates video ads on demand, with a built-in editor.** Click "+ Video
   variant" on any ad card. Claude writes a video prompt from the ad's angle,
   routes to the best video model, and pulls back a clip:
   - **Veo 3** — photoreal ads with native audio (product, lifestyle).
   - **Sora 2** — longer clips with narrative and audio.
   - **Runway Gen-4** — cinematic / editorial, strong camera control.
   - **Kling 2** — physics (pouring, splashing, fabric, food).

   Because 2026 video gen is *usable* but not reliable enough to ship raw, the
   raw clip opens in an in-browser editor (`/clients/[id]/ads/[adId]/edit`)
   where you trim, crop to ad-spec aspect ratios (1:1 / 4:5 / 9:16 / 16:9),
   overlay the headline + CTA, mute or keep the soundtrack, and export a
   final webm. Canvas + MediaRecorder export — no FFmpeg.wasm dependency.
5. **Launches to Meta (always paused).** Creates the campaign + ad set + ads
   via the Marketing API. Everything ships `PAUSED`. Nobody spends a cent
   until a human flips it live in Ads Manager.
6. **Daily optimization pass.** Pulls the last 7 days of metrics, judges each
   ad against the goal-appropriate primary metric (CPA for conversions, CPC
   for traffic, CTR for awareness), and produces a 2-paragraph plain-English
   report plus specific actions: pause, kill, scale up, scale down, duplicate
   and tweak. Runs manually **or** on a daily schedule (see *Daily cron* below).
7. **Chat companion.** Streams answers from Claude with the client's full
   account loaded in context. Ask "is ad 3 worth keeping?" and get a verdict.

## Voice & tone (don't skip this)

Every report, every ad, every chat answer uses the same voice. It's enforced
via a shared `VOICE_GUIDE` block in `lib/prompts.ts` that rides along with
every Claude call. The short version:

- Smart but doesn't show off.
- Confident and direct. No "it depends." No "consider optimizing."
- Concrete. Numbers, thresholds, specific tests.
- Plain English. If jargon appears, define it inline once, then use the plain
  word after. `"CPA (cost to get one signup)"`.
- Dry, warm, human. Can be funny, never clowns.
- Anti-fluff. Zero "Great question!", zero "As an AI..."
- Reports always: **TL;DR → What we found → What we test next → What 'good' looks like**.

Change the voice in one place (`VOICE_GUIDE` in `lib/prompts.ts`) and every
surface inherits it.

## Stack

- **Next.js 14** (App Router, TypeScript, React Server Components where useful)
- **Tailwind CSS** for styles; design tokens in `globals.css`
- **Anthropic SDK** with `claude-opus-4-7`, adaptive thinking, `effort: high`
  on analysis/generation/optimization, `effort: medium` on chat
- **Meta Marketing API** via thin wrapper in `lib/meta.ts`
- **Persistence**: JSON file by default (dev). Set `DATABASE_URL` and install
  `pg` to switch to Postgres — schema is auto-applied on first use.
- **Headless browser (optional)**: Playwright for SPAs — lazy-loaded only if
  installed; the base project doesn't require the 200MB browser binary.

## Setup

```bash
npm install
cp .env.example .env
# fill in ANTHROPIC_API_KEY at minimum
npm run dev
```

Open http://localhost:3000 and add a client.

### API keys

| Env var | What it does | Required? |
|---|---|---|
| `ANTHROPIC_API_KEY` | All the thinking — analysis, ad gen, optimization, chat, image/video routing | Yes |
| `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` + `META_PAGE_ID` | Launch real ads. Without these, mock mode tagged `mock: true` | No |
| `IDEOGRAM_API_KEY` | Best for text-in-image ad creatives | Optional |
| `BFL_API_KEY` | Best for photoreal product/lifestyle shots | Optional |
| `GOOGLE_API_KEY` | Imagen 4 (images) + Veo 3 (video) | Optional |
| `OPENAI_API_KEY` | gpt-image-1 (images) + Sora 2 (video) | Optional |
| `RUNWAY_API_KEY` | Runway Gen-4 (video) | Optional |
| `KLING_API_KEY` | Kling 2 (video) | Optional |
| `DATABASE_URL` | Postgres connection string | Optional (JSON fallback) |
| `USE_HEADLESS_SITE_READER=1` | Use Playwright for SPA site reads | Optional |
| `CRON_SECRET` | Protects `/api/cron/optimize-all` | Required for cron |

Without image or video keys, the app still routes briefs through Claude and
generates clearly-labeled SVG placeholders tagged with the provider that
*would* have been used. Add keys when you're ready to spend money.

## Daily cron

Hit `GET /api/cron/optimize-all` on a schedule with
`Authorization: Bearer $CRON_SECRET`. The endpoint runs `POST /api/optimize`
with `apply: true` for every client that has live ads and returns a JSON
summary.

**Vercel:** `vercel.json` is already wired to run it at 14:00 UTC daily.
Set `CRON_SECRET` in the Vercel dashboard — Vercel's cron hits the endpoint
with that token automatically.

**Anywhere else** (GitHub Actions, a box with crond, a cheap scheduler):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-host.example.com/api/cron/optimize-all
```

## Postgres

Set `DATABASE_URL` to switch off the JSON file:

```bash
npm install pg
# schema auto-applies on first use — no migrations to run
```

Schema is three JSONB-backed tables (`clients`, `ads`, `optimization_logs`),
so app types match the JSON adapter exactly. See `lib/db-postgres.ts`. To
go back to JSON, unset `DATABASE_URL`.

## Headless site reader (for SPAs)

The default fetch-based reader catches most marketing sites. For JS-heavy
SPAs (Shopify Hydrogen, Remix, pure React), install Playwright:

```bash
npm install playwright
npx playwright install chromium
```

Then either set `USE_HEADLESS_SITE_READER=1` to always use it, or leave it
unset — the default reader detects SPA markers and upgrades automatically
when Playwright is available.

## File layout

```
app/
  layout.tsx                                shell + nav + footer
  page.tsx                                  dashboard home
  globals.css                               design tokens
  clients/
    page.tsx                                client list
    new/page.tsx                            intake form (6 fields)
    [id]/page.tsx                           server entry
    [id]/workspace.tsx                      4-step workspace + chat
    [id]/ads/[adId]/edit/page.tsx           video editor entry
    [id]/ads/[adId]/edit/editor.tsx         in-browser video editor
  api/
    clients/                                CRUD
    analyze/                                read site → website analysis
    generate-ads/                           analysis → 5 creatives + 5 images
    generate-video/                         add a video variant to an ad
    save-edited-video/                      receives blob from editor, stores it
    launch-ads/                             creatives → Meta campaign/ad set/ads
    optimize/                               metrics → report + actions
    cron/optimize-all/                      daily cron target
    chat/                                   streaming Claude chat
components/
  AdCard.tsx                                ad preview (image or video) + actions
  ChatPanel.tsx                             streaming chat UI
  ReportBlock.tsx                           TL;DR + expandable body
lib/
  anthropic.ts                              SDK wrapper (askJson + streamChat)
  db.ts                                     facade selecting postgres or json
  db-json.ts                                file-backed adapter
  db-postgres.ts                            pg adapter, auto-migrates
  image-provider.ts                         router + 4 image providers
  video-provider.ts                         router + 4 video providers
  meta.ts                                   Meta Marketing API wrapper
  prompts.ts                                VOICE_GUIDE + all system prompts
  site-reader.ts                            fetch-based reader + upgrade path
  site-reader-headless.ts                   optional Playwright reader
  types.ts                                  shared types
vercel.json                                 daily cron schedule
```

## Extending

**New ad angle?** Add it to `AD_GENERATION_SYSTEM` in `lib/prompts.ts`.

**New image or video provider?** Add a case to `generateImage` or
`generateVideo` and an option to the matching router system prompt. Claude
will start routing to it automatically.

**Different voice?** Edit `VOICE_GUIDE`.

**Swap MediaRecorder export for FFmpeg.wasm?** Replace `exportToBlob` in
`app/clients/[id]/ads/[adId]/edit/editor.tsx`. Everything else stays the same.

## Known limits

- **Mock mode is obvious in the UI** — any mock-backed ID is prefixed `mock_`,
  and placeholder images/videos are labeled with the provider that would have
  run.
- **Export is webm**, not mp4. Meta accepts webm for ads. If you need mp4,
  swap in FFmpeg.wasm at the export boundary — single function to replace.
- **Targeting** starts broad (US 18-65, FB + IG) because Meta's algo prefers
  that on recent API versions. Dial in via data, not vibes.
