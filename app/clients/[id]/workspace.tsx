"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { rosterFor, AGENTS } from "@/lib/agents";
import type {
  ClientRecord,
  GamePlan,
  GamePlanScope,
  OptimizationLog,
  OrganicPlatform,
  OrganicPost,
  Report,
} from "@/lib/types";
import { getLiveAds, hasLiveAds } from "@/lib/ad-utils";
import AdCard from "@/components/AdCard";
import GoogleAdCard from "@/components/GoogleAdCard";
import ChatPanel from "@/components/ChatPanel";
import ReportBlock from "@/components/ReportBlock";

type Step =
  | "analyze"
  | "generate"
  | "launch"
  | "optimize"
  | "game-plan"
  | "organic"
  | "report";

export default function ClientWorkspace({
  initialClient,
}: {
  initialClient: ClientRecord;
}) {
  const [client, setClient] = useState(initialClient);
  const [busy, setBusy] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/clients/${client.id}`, { cache: "no-store" });
    if (res.ok) {
      const { client: fresh } = await res.json();
      setClient(fresh);
    }
  }

  async function handleDelete(adId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/ads/${adId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRegenerate(adId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/ads/${adId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Regenerate failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const [analyzePhase, setAnalyzePhase] = useState<string>("");

  async function runAnalyze() {
    setBusy("analyze");
    setError(null);
    // Cycle through phase strings while the (long) request is in flight,
    // so the user knows the system isn't frozen.
    const phases = [
      "Pulling brand assets from Brandfetch…",
      "Crawling the site (Firecrawl)…",
      "Asking Exa for direct competitors…",
      "Checking what competitors are running on Meta…",
      "Pulling voice-of-customer from Reddit + Trustpilot…",
      "Synthesizing — Claude Opus 4.7 is thinking…",
    ];
    let i = 0;
    setAnalyzePhase(phases[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, phases.length - 1);
      setAnalyzePhase(phases[i]);
    }, 9000);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Analyze failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(interval);
      setAnalyzePhase("");
      setBusy(null);
    }
  }

  async function runGenerate(platform: "meta" | "google" = "meta") {
    setBusy("generate");
    setError(null);
    try {
      const path =
        platform === "google" ? "/api/generate-google-ads" : "/api/generate-ads";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Generate failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function updateOrganicPost(updated: OrganicPost) {
    setClient((prev) => {
      if (!prev) return prev;
      const updatedPosts = (prev.organicPosts ?? []).map((p) =>
        p.id === updated.id ? updated : p,
      );
      return { ...prev, organicPosts: updatedPosts };
    });
  }

  async function runLaunch(adIds: string[], platform: "meta" | "google" = "meta") {
    setBusy("launch");
    setError(null);
    try {
      const path =
        platform === "google" ? "/api/launch-google-ads" : "/api/launch-ads";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, adIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Launch failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runOptimize(apply: boolean) {
    setBusy("optimize");
    setError(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, apply }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Optimize failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runSyncAdStatus() {
    setBusy("optimize");
    setError(null);
    try {
      const res = await fetch("/api/sync-ad-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Sync failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runGamePlan(scope: GamePlanScope) {
    setBusy("game-plan");
    setError(null);
    try {
      const res = await fetch("/api/generate-game-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, scope }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Game plan failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runGenerateOrganic(platforms: OrganicPlatform[]) {
    setBusy("organic");
    setError(null);
    try {
      const res = await fetch("/api/generate-organic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, platforms, withImages: true }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Organic gen failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runSchedulePost(postId: string) {
    setError(null);
    try {
      const res = await fetch("/api/schedule-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, postId }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Schedule failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runCancelPost(postId: string) {
    setError(null);
    try {
      const res = await fetch("/api/cancel-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, postId }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Cancel failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runGenerateReport(audience: "client" | "pm") {
    setBusy("report");
    setError(null);
    if (!hasLive) {
      setError("Reports need a live ad before they can be generated.");
      setBusy(null);
      return;
    }
    try {
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, audience }),
      });
      if (!res.ok)
        throw new Error((await res.json()).error || "Report failed.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const draftAds = useMemo(
    () => client.ads.filter((a) => a.status === "draft"),
    [client.ads],
  );
  const draftMeta = useMemo(
    () => draftAds.filter((a) => (a.platform ?? "meta") === "meta"),
    [draftAds],
  );
  const draftGoogle = useMemo(
    () => draftAds.filter((a) => a.platform === "google"),
    [draftAds],
  );
  const launchedAds = useMemo(
    () => client.ads.filter((a) => a.status !== "draft" && a.status !== "killed"),
    [client.ads],
  );
  const liveAds = useMemo(() => getLiveAds(client), [client.ads]);
  const hasLive = useMemo(() => hasLiveAds(client), [client.ads]);

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-8">
      <div className="space-y-8 min-w-0">
        <header>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/clients" className="text-sm text-[color:var(--muted)] hover:underline">← Clients</Link>
            <span className="pill">{client.goal.replace("_", " ")}</span>
            {client.metaAdAccountId && client.metaOAuth ? (
              <span className="pill pill-green">
                Meta · OAuth · {client.metaAccountName ?? client.metaOAuth.userName}
              </span>
            ) : client.metaAdAccountId ? (
              <span className="pill pill-green">
                Meta connected{client.metaAccountName ? ` · ${client.metaAccountName}` : ""}
              </span>
            ) : (
              <span className="pill pill-amber">Meta — mock mode</span>
            )}
            {client.googleAds?.customerId ? (
              <span className="pill pill-green">
                Google · {client.googleAds.customerName ?? client.googleAds.customerId}
              </span>
            ) : (
              <span className="pill pill-amber">Google — not connected</span>
            )}
            <Link
              href={`/clients/${client.id}/connect-meta`}
              className="text-xs underline text-[color:var(--muted)]"
            >
              {client.metaOAuth ? "Manage Meta" : "+ Meta"}
            </Link>
            <Link
              href={`/clients/${client.id}/connect-google`}
              className="text-xs underline text-[color:var(--muted)]"
            >
              {client.googleOAuth ? "Manage Google" : "+ Google"}
            </Link>
          </div>
          <h1 className="font-display text-3xl font-semibold mt-2">{client.name}</h1>
          <p className="text-[color:var(--muted)]">
            {client.websiteUrl} · ${client.monthlyBudgetUsd}/mo · {client.offer}
          </p>
        </header>

        {error && <div className="pill pill-red">{error}</div>}

        {/* Roster — your team */}
        <section className="card p-4">
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold mb-2">
            Your team on this account
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {rosterFor(client).map((a) => (
              <div
                key={a.id}
                className="p-3 border border-[color:var(--line)] rounded-lg flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: a.accent }}
                  />
                  <div className="font-display font-semibold">{a.name}</div>
                </div>
                <div className="text-[11px] text-[color:var(--muted)] uppercase tracking-wider">
                  {a.role}
                </div>
                <div className="text-xs text-[color:var(--muted)] mt-0.5">
                  {a.bio}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Step 1: Analyze */}
        <StepCard
          step={1}
          title="Read the website"
          done={!!client.analysis}
          children={
            client.analysis ? (
              <ReportBlock
                tldr={client.analysis.tldr}
                body={client.analysis.raw}
                meta={`Analyzed ${relativeTime(client.analysis.generatedAt)}`}
                badges={client.analysis.differentiators.slice(0, 4)}
              />
            ) : (
              <p className="text-[color:var(--muted)]">
                We'll fetch the homepage, read it, and come back with a 3-paragraph
                briefing: who they are, who buys, what's the angle, what'll bite us.
              </p>
            )
          }
          action={
            <div className="flex flex-col items-end gap-1">
              <button
                className="btn btn-primary"
                onClick={runAnalyze}
                disabled={busy === "analyze"}
              >
                {busy === "analyze"
                  ? "Reading…"
                  : client.analysis
                    ? "Re-analyze"
                    : "Analyze the site"}
              </button>
              {busy === "analyze" && analyzePhase && (
                <div className="text-xs text-[color:var(--muted)] italic max-w-[16rem] text-right">
                  {analyzePhase}
                </div>
              )}
            </div>
          }
        />

        {/* Step 2: Generate ads */}
        <StepCard
          step={2}
          title="Generate a 5-variant test battery"
          done={client.ads.length > 0}
          disabled={!client.analysis}
          disabledHint="Analyze the site first. We don't guess."
          children={
            draftAds.length > 0 ? (
              <>
                {draftMeta.length > 0 && (
                  <>
                    <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold mt-1 mb-2">
                      Meta drafts
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      {draftMeta.map((ad) => (
                        <AdCard key={ad.id} ad={ad} onDelete={() => handleDelete(ad.id)} onRegenerate={() => handleRegenerate(ad.id)} />
                      ))}
                    </div>
                  </>
                )}
                {draftGoogle.length > 0 && (
                  <>
                    <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold mt-4 mb-2">
                      Google drafts (Responsive Search Ads)
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      {draftGoogle.map((ad) => (
                        <GoogleAdCard key={ad.id} ad={ad} onDelete={() => handleDelete(ad.id)} onRegenerate={() => handleRegenerate(ad.id)} />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : launchedAds.length > 0 ? (
              <p className="text-[color:var(--muted)]">
                All generated variants have been launched. Generate a new battery
                below if you want fresh angles to test.
              </p>
            ) : (
              <p className="text-[color:var(--muted)]">
                Five ads, each testing a different angle: pain-point, social proof,
                contrarian, concrete outcome, curiosity. Each one says why it should work.
              </p>
            )
          }
          action={
            <div className="flex gap-2 flex-wrap justify-end">
              <button
                className="btn btn-primary"
                onClick={() => runGenerate("meta")}
                disabled={busy === "generate" || !client.analysis}
              >
                {busy === "generate" ? "Cooking…" : "Generate Meta ads"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => runGenerate("google")}
                disabled={busy === "generate" || !client.analysis}
              >
                Generate Google ads
              </button>
            </div>
          }
        />

        {/* Step 3: Launch */}
        <StepCard
          step={3}
          title="Launch (paused)"
          done={launchedAds.length > 0}
          disabled={draftAds.length === 0}
          disabledHint="Nothing to launch. Generate a battery first."
          children={
            launchedAds.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-3">
                {launchedAds.map((ad) =>
                  ad.platform === "google" ? (
                    <GoogleAdCard key={ad.id} ad={ad} launched />
                  ) : (
                    <AdCard key={ad.id} ad={ad} launched />
                  )
                )}
              </div>
            ) : (
              <p className="text-[color:var(--muted)]">
                We upload each ad in <b>PAUSED</b> state. Nothing spends a cent
                until you flip it live in Ads Manager. Daily budget: $
                {Math.round(client.monthlyBudgetUsd / 30)}.
              </p>
            )
          }
          action={
            <div className="flex gap-2 flex-wrap justify-end">
              {draftMeta.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => runLaunch(draftMeta.map((a) => a.id), "meta")}
                  disabled={busy === "launch"}
                >
                  {busy === "launch"
                    ? "Launching…"
                    : `Launch ${draftMeta.length} to Meta`}
                </button>
              )}
              {draftGoogle.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => runLaunch(draftGoogle.map((a) => a.id), "google")}
                  disabled={busy === "launch"}
                >
                  {busy === "launch"
                    ? "Launching…"
                    : `Launch ${draftGoogle.length} to Google`}
                </button>
              )}
            </div>
          }
        />

        {/* Step 4: Optimize */}
        <StepCard
          step={4}
          title="Daily review & optimize"
          done={client.optimizations.length > 0}
          disabled={liveAds.length === 0}
          disabledHint="Launch ads to Meta/Google, then flip them to ACTIVE in the respective ad manager before running optimization."
          children={
            client.optimizations.length > 0 ? (
              <OptimizationHistory logs={client.optimizations.slice(0, 3)} />
            ) : (
              <p className="text-[color:var(--muted)]">
                We pull the last 7 days of metrics, figure out what's working and
                what's not, and suggest actions with specific numbers. Run it daily
                or set it and forget it.
              </p>
            )
          }
          action={
            <div className="flex flex-col items-end gap-2">
              {launchedAds.length > 0 && liveAds.length === 0 && (
                <button
                  className="btn btn-ghost text-xs"
                  onClick={runSyncAdStatus}
                  disabled={busy === "optimize"}
                >
                  {busy === "optimize" ? "Syncing…" : "Sync status from platforms"}
                </button>
              )}
              <div className="flex gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => runOptimize(false)}
                  disabled={busy === "optimize" || liveAds.length === 0}
                >
                  {busy === "optimize" ? "Reviewing…" : "Review only"}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => runOptimize(true)}
                  disabled={busy === "optimize" || liveAds.length === 0}
                >
                  Review & apply
                </button>
              </div>
            </div>
          }
        />

        <GamePlanSection
          plans={client.gamePlans ?? []}
          busy={busy === "game-plan"}
          disabled={!client.analysis}
          onGenerate={runGamePlan}
        />

        <OrganicSection
          posts={client.organicPosts ?? []}
          busy={busy === "organic"}
          disabled={!client.analysis}
          onGenerate={runGenerateOrganic}
          onSchedule={runSchedulePost}
          onCancel={runCancelPost}
          clientId={client.id}
          onUpdatePost={updateOrganicPost}
        />

        <ReportsSection
          reports={client.reports ?? []}
          busy={busy === "report"}
          onGenerate={runGenerateReport}
          hasLive={hasLive}
        />
      </div>

      <aside className="lg:sticky lg:top-20 h-[75vh] min-h-[500px]">
        <ChatPanel
          clientId={client.id}
          clientName={client.name}
          roster={rosterFor(client)}
        />
      </aside>
    </div>
  );
}

function StepCard({
  step,
  title,
  done,
  disabled,
  disabledHint,
  children,
  action,
}: {
  step: number;
  title: string;
  done?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${disabled ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Step {step} {done && <span className="pill pill-green ml-2">done</span>}
          </div>
          <h2 className="font-display text-xl font-semibold mt-1">{title}</h2>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      <div className="mt-4">{children}</div>
      {disabled && disabledHint && (
        <p className="text-xs text-[color:var(--muted)] mt-3 italic">{disabledHint}</p>
      )}
    </section>
  );
}

function OptimizationHistory({ logs }: { logs: OptimizationLog[] }) {
  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <div key={log.id} className="border border-[color:var(--line)] rounded-lg p-4 bg-white/50">
          <div className="text-xs text-[color:var(--muted)] mb-2">
            {new Date(log.at).toLocaleString()}
          </div>
          <div className="font-medium mb-2">{log.summary}</div>
          <details className="text-sm">
            <summary className="cursor-pointer text-[color:var(--muted)] hover:underline">
              Full rationale ({log.actions.length} action{log.actions.length === 1 ? "" : "s"})
            </summary>
            <div className="prose-report mt-3 whitespace-pre-wrap">{log.raw}</div>
            <div className="mt-3 space-y-1">
              {log.actions.map((a, i) => (
                <div key={i} className="text-xs flex gap-2">
                  <span className={`pill ${
                    a.kind === "kill" || a.kind === "pause"
                      ? "pill-red"
                      : a.kind === "scale_up"
                        ? "pill-green"
                        : "pill-amber"
                  }`}>{a.kind.replace("_", " ")}</span>
                  <span className="font-mono">{a.adId.slice(-6)}</span>
                  <span>— {a.reason}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function GamePlanSection({
  plans,
  busy,
  disabled,
  onGenerate,
}: {
  plans: GamePlan[];
  busy: boolean;
  disabled: boolean;
  onGenerate: (scope: GamePlanScope) => void;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Game plan · written by Atlas
          </div>
          <h2 className="font-display text-xl font-semibold mt-1">
            The bet, in writing
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => onGenerate("meta")}
            disabled={busy || disabled}
          >
            {busy ? "Cooking…" : "Meta plan"}
          </button>
          <button
            className="btn btn-ghost text-xs"
            onClick={() => onGenerate("google")}
            disabled={busy || disabled}
          >
            {busy ? "Cooking…" : "Google plan"}
          </button>
          <button
            className="btn btn-ghost text-xs"
            onClick={() => onGenerate("organic")}
            disabled={busy || disabled}
          >
            {busy ? "Cooking…" : "Organic plan"}
          </button>
        </div>
      </div>
      {disabled && (
        <p className="text-xs text-[color:var(--muted)] mt-3 italic">
          Run the analysis first; Atlas needs the brand brief to write a plan.
        </p>
      )}
      {plans.length === 0 ? (
        <p className="text-[color:var(--muted)] mt-3">
          Each plan is a phased rollout — a discovery test, then scale, then
          iterate — with explicit success checks like "if CPA &lt; $12 by day
          14, scale; else pivot." Generate one per channel you're running.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {plans.map((p) => (
            <details
              key={p.id}
              className="border border-[color:var(--line)] rounded-lg p-4 bg-white/50"
            >
              <summary className="cursor-pointer flex items-center gap-2">
                <span className="pill">{p.scope}</span>
                <span className="font-display text-base font-semibold">
                  {p.tldr}
                </span>
              </summary>
              <div className="mt-3 space-y-2 text-sm">
                <div className="text-xs italic text-[color:var(--muted)]">
                  Positioning: {p.positioning}
                </div>
                <ol className="space-y-2 list-decimal pl-4">
                  {p.phases.map((ph) => (
                    <li key={ph.number}>
                      <b>{ph.name}</b> · {ph.durationDays}d
                      <div className="text-xs text-[color:var(--muted)]">
                        {ph.goal}
                      </div>
                      <ul className="text-xs list-disc pl-4 mt-1">
                        {ph.actions.map((act, i) => (
                          <li key={i}>{act}</li>
                        ))}
                      </ul>
                      <div className="text-xs italic mt-1">
                        Success check: {ph.successCheck}
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="prose-report mt-3 whitespace-pre-wrap text-sm">
                  {p.raw}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function OrganicSection({
  posts,
  busy,
  disabled,
  onGenerate,
  onSchedule,
  onCancel,
  onUpdatePost,
  clientId,
}: {
  posts: OrganicPost[];
  busy: boolean;
  disabled: boolean;
  onGenerate: (platforms: OrganicPlatform[]) => void;
  onSchedule: (postId: string) => Promise<void> | void;
  onCancel: (postId: string) => Promise<void> | void;
  onUpdatePost: (post: OrganicPost) => void;
  clientId: string;
}) {
  const PLATFORMS: OrganicPlatform[] = [
    "instagram",
    "linkedin",
    "twitter",
    "tiktok",
    "facebook",
    "threads",
  ];
  const [picked, setPicked] = useState<OrganicPlatform[]>([
    "instagram",
    "linkedin",
  ]);
  const [schedulingIds, setSchedulingIds] = useState<Set<string>>(new Set());
  const [cancelingIds, setCancelingIds] = useState<Set<string>>(new Set());
  const [regeneratingImageIds, setRegeneratingImageIds] = useState<Set<string>>(new Set());
  const [regeneratingPostIds, setRegeneratingPostIds] = useState<Set<string>>(new Set());
  const togglePlat = (p: OrganicPlatform) => {
    setPicked((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  };

  async function handleSchedule(postId: string) {
    setSchedulingIds((s) => new Set(s).add(postId));
    try { await onSchedule(postId); } finally {
      setSchedulingIds((s) => { const n = new Set(s); n.delete(postId); return n; });
    }
  }

  async function handleCancel(postId: string) {
    setCancelingIds((s) => new Set(s).add(postId));
    try { await onCancel(postId); } finally {
      setCancelingIds((s) => { const n = new Set(s); n.delete(postId); return n; });
    }
  }

  async function handleRegenerateImage(postId: string) {
    setRegeneratingImageIds((s) => new Set(s).add(postId));
    try {
      const res = await fetch(`/api/organic/${postId}/regenerate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Regenerate image failed.");
      onUpdatePost(payload.post);
    } catch (e) {
      console.error((e as Error).message);
    } finally {
      setRegeneratingImageIds((s) => { const n = new Set(s); n.delete(postId); return n; });
    }
  }

  async function handleRegeneratePost(postId: string) {
    setRegeneratingPostIds((s) => new Set(s).add(postId));
    try {
      const res = await fetch(`/api/organic/${postId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Regenerate post failed.");
      onUpdatePost(payload.post);
    } catch (e) {
      console.error((e as Error).message);
    } finally {
      setRegeneratingPostIds((s) => { const n = new Set(s); n.delete(postId); return n; });
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Organic · written by River
          </div>
          <h2 className="font-display text-xl font-semibold mt-1">
            12-post calendar
          </h2>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => onGenerate(picked)}
          disabled={busy || disabled || picked.length === 0}
        >
          {busy ? "Drafting…" : "Generate"}
        </button>
      </div>
      {disabled && (
        <p className="text-xs text-[color:var(--muted)] mt-3 italic">
          Run the analysis first.
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            className={`pill text-xs ${picked.includes(p) ? "" : "opacity-50"}`}
            onClick={() => togglePlat(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {posts.length === 0 ? (
        <p className="text-[color:var(--muted)] mt-4">
          River will produce 12 posts across the platforms you pick — different
          angle each, suggested day &amp; hour, hashtags where they help. Schedule
          via Buffer when configured; copy-paste reminders by email when not.
        </p>
      ) : (
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {posts.slice(0, 24).map((p) => (
            <div
              key={p.id}
              className="border border-[color:var(--line)] rounded-lg p-3 bg-white/50 text-sm"
            >
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="pill">{p.platform}</span>
                <span className="pill">{p.angle}</span>
                <span
                  className={`pill ${
                    p.status === "published"
                      ? "pill-green"
                      : p.status === "scheduled"
                        ? "pill-amber"
                        : p.status === "failed"
                          ? "pill-red"
                          : ""
                  }`}
                >
                  {p.status}
                </span>
              </div>
              {p.mediaUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.mediaUrl}
                  alt=""
                  className="w-full max-h-40 object-cover rounded mb-2"
                />
              )}
              <p className="whitespace-pre-wrap leading-relaxed">{p.caption}</p>
              {p.hashtags.length > 0 && (
                <div className="text-[11px] text-[color:var(--muted)] mt-1">
                  {p.hashtags.map((h) => `#${h}`).join(" ")}
                </div>
              )}
              <div className="text-[11px] text-[color:var(--muted)] mt-2 italic">
                Why: {p.hypothesis}
              </div>
              <div className="mt-2 pt-2 border-t border-[color:var(--line)]">
                <div className="text-[11px] text-[color:var(--muted)] mb-2">
                  {p.scheduledAt
                    ? new Date(p.scheduledAt).toLocaleString()
                    : "no time set"}
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.status === "draft" && (
                    <>
                      {p.mediaUrl && (
                        <button
                          className="btn btn-ghost text-xs"
                          onClick={() => handleRegenerateImage(p.id)}
                          disabled={regeneratingImageIds.has(p.id)}
                        >
                          {regeneratingImageIds.has(p.id) ? "Regenerating…" : "Regen image"}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={() => handleRegeneratePost(p.id)}
                        disabled={regeneratingPostIds.has(p.id)}
                      >
                        {regeneratingPostIds.has(p.id) ? "Regenerating…" : "Regen post"}
                      </button>
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={() => handleSchedule(p.id)}
                        disabled={schedulingIds.has(p.id)}
                      >
                        {schedulingIds.has(p.id) ? "Scheduling…" : "Schedule"}
                      </button>
                    </>
                  )}
                  {p.status === "scheduled" && (
                    <button
                      className="btn btn-ghost text-xs text-red-600"
                      onClick={() => handleCancel(p.id)}
                      disabled={cancelingIds.has(p.id)}
                    >
                      {cancelingIds.has(p.id) ? "Canceling…" : "Cancel"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportsSection({
  reports,
  busy,
  onGenerate,
  hasLive,
}: {
  reports: Report[];
  busy: boolean;
  onGenerate: (audience: "client" | "pm") => void;
  hasLive: boolean;
}) {
  return (
    <section className={`card p-5 ${!hasLive ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Reports · written by Lex
          </div>
          <h2 className="font-display text-xl font-semibold mt-1">
            Two registers, same voice
          </h2>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => onGenerate("client")}
            disabled={busy || !hasLive}
          >
            {busy ? "Cooking…" : "Client report"}
          </button>
          <button
            className="btn btn-ghost text-xs"
            onClick={() => onGenerate("pm")}
            disabled={busy || !hasLive}
          >
            {busy ? "Cooking…" : "PM brief"}
          </button>
        </div>
      </div>
      {!hasLive && (
        <p className="text-xs text-[color:var(--muted)] mt-2 italic">
          Reports require a live or winner ad with real platform IDs so the numbers
          aren’t just mocks.
        </p>
      )}
      {reports.length === 0 ? (
        <p className="text-[color:var(--muted)] mt-3">
          Lex writes weekly client reports (jargon-free, outcome-first) and
          daily PM briefs (every number, every decision). Both auto-email when
          the cron runs.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {reports.slice(0, 5).map((r) => (
            <details
              key={r.id}
              className="border border-[color:var(--line)] rounded-lg p-4 bg-white/50"
            >
              <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                <span className={`pill ${r.audience === "client" ? "pill-green" : "pill-amber"}`}>
                  {r.audience === "client" ? "Client report" : "PM brief"}
                </span>
                <span className="text-xs text-[color:var(--muted)]">
                  {new Date(r.generatedAt).toLocaleString()}
                </span>
                <span className="font-display ml-1 truncate">{r.tldr}</span>
              </summary>
              <div className="mt-3 text-sm space-y-2">
                {r.highlights.length > 0 && (
                  <ul className="list-disc pl-5">
                    {r.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                )}
                <div
                  className="prose-report"
                  dangerouslySetInnerHTML={{ __html: r.bodyHtml }}
                />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

