# Deploying Adwise

The goal of this doc: get to "real client onboarded, real ads launched" in
under an hour.

## What you need before you start

| Thing | Where to get it | Why |
|---|---|---|
| Anthropic API key | console.anthropic.com | Required. Powers everything text. |
| A Meta Business Manager | business.facebook.com | Required for real ad launches. |
| A System User access token | Business Manager → Business Settings → Users → System Users | Long-lived token; one for the whole agency. |
| A hosted Postgres (Neon / Supabase / Render) | neon.tech free tier is fine | Required in prod (Vercel filesystem is ephemeral). |
| A Vercel Blob store | Vercel dashboard → Storage → Create | Required for video editor outputs. |
| A Resend account + verified domain | resend.com | For daily digest emails. Optional but you'll want it. |
| A 32-char random hex string | `openssl rand -hex 32` | For `AUTH_SECRET`. |

You can skip any of the optional API keys (Brandfetch, Firecrawl, Exa,
Perplexity, Apify, Ideogram, FLUX, Recraft, Runway, Kling). The pipeline
runs on whatever's configured and notes the gaps in each report.

## 1. Provision Postgres

Pick any Postgres 14+ host. With Neon:

1. Sign up, create a project.
2. Copy the connection string into `DATABASE_URL`.
3. That's it. The schema auto-migrates on first request.

## 2. Set up Meta

This is the part that confuses people. Do these in order:

1. **Create a Business Manager** at business.facebook.com (skip if you have one).
2. **Add the client's ad account** to your BM: Business Settings → Accounts →
   Ad Accounts → Add → "Request access to an ad account".
3. **Add the client's Facebook Page** the same way: Accounts → Pages → Add.
4. **Create a System User**: Users → System Users → Add. Give it Admin access.
5. **Generate a token**: in the System User's row, click "Generate New Token".
   Pick the app you'll attach it to (create one if needed in Meta for Devs).
   Scopes: `ads_management`, `ads_read`, `business_management`,
   `pages_show_list`, `pages_read_engagement`. **Copy this — it's your
   `META_ACCESS_TOKEN`.**
6. **Assign the System User to the ad account + page** with Manage permission.

You'll need the client's:
- Ad Account ID (Ads Manager URL: `/select/?act=123456789012345`)
- Page ID (page → About → Page transparency → Page ID)

These go into the client intake form, not the env.

## 3. Deploy on Vercel

```bash
# From a clean checkout
vercel link
vercel env pull
# Edit .env.local: paste every key from the table below.
vercel deploy --prod
```

### Required env vars

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `ADMIN_PASSWORD` | A strong password — anyone with this can use the app |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `META_ACCESS_TOKEN` | The System User token from step 2 |
| `DATABASE_URL` | Postgres connection string |
| `BLOB_READ_WRITE_TOKEN` | From Vercel Storage |
| `CRON_SECRET` | A second random string — `openssl rand -hex 32` |
| `APP_BASE_URL` | Your Vercel domain — e.g. `https://adwise.vercel.app` |

### Recommended env vars

| Variable | Why |
|---|---|
| `RESEND_API_KEY` + `RESEND_FROM` | Daily digest emails |
| `BRANDFETCH_API_KEY` | Canonical brand assets — big quality win |
| `FIRECRAWL_API_KEY` | Multi-page scraping for the analysis |
| `EXA_API_KEY` | Competitor lookup with citations |
| `PERPLEXITY_API_KEY` | Live category research |
| `APIFY_API_TOKEN` | Trustpilot reviews scraping |

### Image / video providers

Add as many as you want. If you set zero, the app generates SVG
placeholders clearly labeled with the provider that *would* have run.

| Variable | Provider |
|---|---|
| `IDEOGRAM_API_KEY` | Ideogram 3.0 (text-in-image) |
| `BFL_API_KEY` | FLUX 1.1 Pro Ultra (photoreal) |
| `GOOGLE_API_KEY` | Imagen 4 + Veo 3 |
| `RECRAFT_API_KEY` | Recraft v3 (brand-aligned design) |
| `OPENAI_API_KEY` | gpt-image-1 + Sora 2 |
| `RUNWAY_API_KEY` | Runway Gen-4 |
| `KLING_API_KEY` | Kling 2 |

### Vercel project settings

```bash
vercel install pg
vercel install @vercel/blob
```

In the Vercel dashboard:

- **Functions** → Function maxDuration: **300s** (Pro plan; Hobby caps at 60s
  which is enough for most analyses but tight for a full multi-page crawl).
- **Crons** are picked up automatically from `vercel.json`. Set the
  `CRON_SECRET` env var; Vercel sends it as `Authorization: Bearer`.

## 4. Onboard the first client

1. Visit your deployed URL. You'll be redirected to `/login`.
2. Enter `ADMIN_PASSWORD`.
3. Click **+ New client**.
4. Fill in the brand fields (5 required: name, website, goal, budget, offer).
5. **Meta connection** section: paste the client's Ad Account ID + Page ID.
   Click **Test connection** — you should see "✓ Connected to {name}".
6. Optional: paste the digest email recipient.
7. Save. You're in the workspace.
8. Click **Analyze the site** — wait ~60s while the orchestrator runs.
9. Click **Generate ads** — gets you 5 variants with images.
10. Optional: on any ad card, click **+ Video variant** to generate a video
    via the routed provider, then click **Edit video** to open the editor.
11. Click **Launch to Meta (paused)**. Verify the ads land in Ads Manager.
12. Flip them live in Ads Manager. The system will not auto-spend.

## 5. Wire up the daily review

Vercel cron is already configured in `vercel.json` to run at 14:00 UTC
daily. You can change the schedule there. To run it manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/optimize-all
```

If `RESEND_API_KEY` is set and the client has a `notifyEmail`, the digest
goes out automatically after each run.

## OAuth setup — Meta

To enable one-click "Connect with Meta" instead of pasting IDs:

1. Go to developers.facebook.com → My Apps → **Create App**.
2. Type: "Business". Add the **Facebook Login for Business** product.
3. App Settings → Basic — copy **App ID** → `META_APP_ID` and the
   **App Secret** → `META_APP_SECRET`.
4. Facebook Login → Settings → Valid OAuth Redirect URIs — add
   `{APP_BASE_URL}/api/meta/oauth/callback`.
5. App Review → Permissions and Features — for production with non-developer
   accounts, request access to: `ads_management`, `ads_read`,
   `business_management`, `pages_manage_ads`, `pages_read_engagement`.
   You'll need a privacy policy URL, data deletion URL, and a screencast
   showing the flow. Ballpark 1–2 weeks of review.
6. While in development mode, only users you add as Roles → Developers /
   Testers can connect. That's fine for an internal-only tool.

Once configured, click "Connect with Meta" on any client. They'll go through
the standard FB consent dialog, come back to the picker page, choose an ad
account + page from dropdowns, and they're live. The token is encrypted at
rest with `AUTH_SECRET` and refreshed automatically when it gets within 7
days of expiry.

## OAuth setup — Google Ads

1. Cloud console → APIs & Services → **Enable Google Ads API**.
2. APIs & Services → OAuth consent screen — pick "External", add the
   `https://www.googleapis.com/auth/adwords` scope.
3. APIs & Services → Credentials → **Create OAuth 2.0 Client ID** (type:
   "Web application"). Add `{APP_BASE_URL}/api/google/oauth/callback` to
   "Authorized redirect URIs". Copy Client ID / Secret.
4. ads.google.com → Tools & Settings → API Center → apply for a
   **developer token**. Test access is instant; production access requires
   a short application form. Copy the token.
5. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
   `GOOGLE_ADS_DEVELOPER_TOKEN` in env.

Once configured, every client gets a "Connect with Google" link in their
workspace. You'll pick the customer (and manager / MCC if relevant) from
the dropdown after OAuth.

The Google Ads pipeline produces **Responsive Search Ads** (RSAs) — 12
headlines + 4 descriptions per ad, mixed by Google at serve time. Same
voice + analysis backbone as Meta; different ad shape.

## What's still on the roadmap

These don't block production launches but are real next steps:

- **Performance Max for Google** — RSAs only for now. Adding PMax means
  generating multiple asset groups (text + images + videos) and using the
  Asset Groups API.
- **Real-time webhooks** — currently we poll metrics on the optimize cron.
  Meta webhooks would let us react to status / budget changes immediately.
- **Multi-tenant** — the current auth is one shared password for the whole
  team. For agencies handing access to multiple AMs, swap to NextAuth or
  Clerk. The code change is small (lib/auth.ts is the call site).
- **Sentry / structured logging** — there's nothing currently catching
  errors in production. Add Sentry and you'll catch the long-tail.
- **Stripe** — only needed if this becomes a SaaS, not an internal tool.

## Troubleshooting

**"Mock mode" pill on a client that should be real.**
Either the per-client Meta IDs are missing, or `META_ACCESS_TOKEN` isn't set
on the server. Hit `POST /api/meta/validate` from the intake form to confirm.

**Launch returns "No usable media — Meta won't accept SVG placeholders".**
The image provider returned a placeholder because no `IDEOGRAM_API_KEY` /
`BFL_API_KEY` / etc. is set. Add at least one and re-generate the ads.

**Analysis times out on Vercel Hobby.**
Hobby plan caps function duration at 60s. The full orchestrated analysis
fans out 4 parallel HTTP calls plus an Opus 4.7 synthesis — usually 30-50s
but can spike. Upgrade to Pro for `maxDuration: 300`, or skip Firecrawl's
multi-page mode by leaving `FIRECRAWL_API_KEY` unset (homepage-only is faster).

**Edited video won't show.**
Without `BLOB_READ_WRITE_TOKEN`, edited videos write to local disk
(`public/uploads`). On Vercel that disk is ephemeral — the file vanishes
on the next deploy. Add the blob token.
