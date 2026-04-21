# Adwise

Internal Meta Ads tool. Paste a client website, pick a goal, get a data-backed
test battery, launch it to Meta, and let the thing tune itself daily. Comes
with a chat companion that answers the question, not the LinkedIn version.

## What it actually does

1. **Reads the client's site.** Fetches the homepage, extracts the text, and
   briefs Claude Opus 4.7 on what the business actually sells, who's buying, and
   what'll bite us (compliance, thin landing page, bad offer, whatever).
2. **Generates a 5-variant test battery.** Not a brainstorm — a hypothesis-
   driven test plan. Each variant pulls a different lever (pain-point, social
   proof, contrarian take, outcome-specific, curiosity) and says why it should
   work for *this* audience.
3. **Pairs each ad with an image from the best model for the job.**
   - **Ideogram 3.0** for ads with text rendered in the image (posters).
   - **FLUX 1.1 Pro Ultra** for photorealistic product / lifestyle.
   - **Google Imagen 4** for illustrations / editorial / stylized.
   - **OpenAI gpt-image-1** as a forgiving generalist fallback.
   Claude picks per brief and the decision is persisted with the ad, so the
   router learns which model wins for which client over time.
4. **Launches to Meta (always paused).** Creates the campaign + ad set + ads via
   the Marketing API. Everything ships in `PAUSED` state. Nobody spends a cent
   until a human flips it live in Ads Manager.
5. **Daily optimization pass.** Pulls the last 7 days of metrics, judges each
   ad against the goal-appropriate primary metric (CPA for conversions, CPC for
   traffic, CTR for awareness), and produces a 2-paragraph plain-English report
   plus specific actions: pause, kill, scale up, scale down, duplicate and tweak.
   Run it manually or wire it to a cron.
6. **Chat companion.** Streams answers from Claude with the client's full
   account loaded in context. Ask "is ad 3 worth keeping?" and get a verdict,
   not a menu.

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
  on the analysis/generation/optimization calls, `effort: medium` on chat
- **Meta Marketing API** via thin wrapper in `lib/meta.ts`
- **File-backed JSON** persistence in `.data/clients.json`. Swap to Postgres
  when you're bored. The `lib/db.ts` interface is three async functions.

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
| `ANTHROPIC_API_KEY` | All the thinking — analysis, ad gen, optimization, chat, image routing | Yes |
| `META_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID` + `META_PAGE_ID` | Launch real ads. Without these, the app runs in "mock" mode and still demos the full flow | No (mock mode works) |
| `IDEOGRAM_API_KEY` | Best for text-in-image ad creatives | Optional |
| `BFL_API_KEY` | Best for photoreal product/lifestyle shots | Optional |
| `GOOGLE_API_KEY` | Best for illustration/editorial | Optional |
| `OPENAI_API_KEY` | Fallback generalist image model | Optional |

Without any image keys, the app still routes briefs through Claude and
generates deterministic SVG placeholders that clearly show which provider
*would* have been used. Add keys when you're ready to spend money.

## File layout

```
app/
  layout.tsx                     shell + nav + footer
  page.tsx                       dashboard home
  globals.css                    design tokens + tiny component classes
  clients/
    page.tsx                     client list
    new/page.tsx                 intake form (6 fields)
    [id]/page.tsx                server entry
    [id]/workspace.tsx           the 4-step workspace + chat
  api/
    clients/                     CRUD
    analyze/                     read site → website analysis
    generate-ads/                analysis → 5 creatives + 5 images
    launch-ads/                  creatives → Meta campaign + ad set + ads
    optimize/                    metrics → plain-English report + actions
    chat/                        streaming Claude chat with account context
components/
  AdCard.tsx                     single ad preview with metrics
  ChatPanel.tsx                  streaming chat UI
  ReportBlock.tsx                TL;DR + expandable body
lib/
  anthropic.ts                   SDK wrapper (askJson + streamChat)
  db.ts                          file-backed JSON persistence
  image-provider.ts              router + 4 provider clients + placeholder
  meta.ts                        Meta Marketing API wrapper (with mock mode)
  prompts.ts                     VOICE_GUIDE + 5 system prompts
  site-reader.ts                 homepage fetch + text extraction
  types.ts                       shared types
```

## Extending

**New ad angle?** Add it to the system prompt in `lib/prompts.ts` under
`AD_GENERATION_SYSTEM`. One line.

**New image provider?** Add a case to `generateImage` in `lib/image-provider.ts`
and an option to the `IMAGE_ROUTER_SYSTEM` prompt. Claude will start routing to
it automatically.

**Different voice?** Edit `VOICE_GUIDE` in `lib/prompts.ts`. That's it.

**Real database?** The three functions you need are `listClients`, `getClient`,
and `saveClients` in `lib/db.ts`. Everything else composes on those.

**Daily cron for optimization?** Hit `POST /api/optimize` with
`{ clientId, apply: true }` on a schedule. That's the whole integration.

## Known limits

- **JS-rendered sites** (SPAs) give us thin HTML. We detect and call it out in
  the analysis. For those, add a headless browser or have the user paste copy.
- **Targeting** starts broad (US 18-65, FB + IG). Meta's algo prefers that in
  recent API versions. Dial in via data, not vibes.
- **Mock mode** is obvious in the UI — every mock-backed ID is prefixed `mock_`
  and the Meta launch response includes `metaConfigured: false`.
