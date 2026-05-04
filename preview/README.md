# Adwise · iPhone preview

A single self-contained HTML file (`adwise-demo.html`) that simulates the
whole Adwise flow with realistic mock data in the actual brand voice.
Zero dependencies — opens in any browser, no server, no API keys.

## How to view it on your iPhone in the Claude app

The Claude app supports HTML artifacts, so you can preview this thing
natively, right in the chat, on your phone.

**Easiest path (works from your phone):**

1. Open `adwise-demo.html` on GitHub from your phone.
2. Tap **Raw** to view the source.
3. Long-press → **Select All** → **Copy**.
4. Open the Claude app, start a new chat, paste the file in, and say:
   > Render this as an HTML artifact.
5. The artifact opens in-line — full-screen on iPhone, fully interactive.

**Even easier (from a desktop):**

1. Open `preview/adwise-demo.html` in GitHub.
2. Click **Raw**, hit Cmd+A, Cmd+C.
3. Paste into a Claude.ai chat with the same prompt.
4. The artifact syncs to your iPhone Claude app via the same conversation.

**Just want to see it without Claude:**

Open the file in any browser. Or `python3 -m http.server` from this
directory, then visit `http://localhost:8000/adwise-demo.html`.

## What's in the demo

A guided 6-step walkthrough of one client (Riverline Coffee Co.):

1. **Brief** — the 6-field intake, pre-filled.
2. **Analysis** — the website readout: TL;DR, positioning, audience,
   differentiators, objections, risks, plus a 3-paragraph plain-English
   briefing in the brand voice.
3. **Ads** — five generated variants, each with its own image-model
   routing decision (Ideogram for typography, FLUX for photoreal, Imagen
   for illustration, Kling for liquids/glass), full ad copy, CTA, and a
   one-sentence hypothesis.
4. **Launch** — the safe-by-default launch state explanation.
5. **Optimize** — a 7-day metrics review with TL;DR, full rationale,
   per-ad metrics, and concrete actions (scale up · kill · hold).
6. **Chat** — the AI companion with pre-baked answers to common
   questions, with fake-streaming output so it feels like the real thing.

## Mobile design notes

- Designed iPhone-first. Renders cleanly down to ~375px wide.
- Sticky header with horizontally-scrollable step navigation.
- All copy in the actual brand voice (smart, direct, plain English,
  zero "Great question!"). Reports follow the same TL;DR → findings →
  actions structure the real app uses.
- No external scripts. Tailwind isn't used here — bespoke CSS keeps the
  artifact size small and makes it work in restricted iframe contexts.
- Each ad has decorative SVG artwork stylistically matching the routed
  image model (typographic poster for Ideogram, illustration for Imagen,
  product photo composition for FLUX, etc).
