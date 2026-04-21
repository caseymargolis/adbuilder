"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ClientRecord, OptimizationLog } from "@/lib/types";
import AdCard from "@/components/AdCard";
import ChatPanel from "@/components/ChatPanel";
import ReportBlock from "@/components/ReportBlock";

type Step = "analyze" | "generate" | "launch" | "optimize";

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

  async function runAnalyze() {
    setBusy("analyze");
    setError(null);
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
      setBusy(null);
    }
  }

  async function runGenerate() {
    setBusy("generate");
    setError(null);
    try {
      const res = await fetch("/api/generate-ads", {
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

  async function runLaunch(adIds: string[]) {
    setBusy("launch");
    setError(null);
    try {
      const res = await fetch("/api/launch-ads", {
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

  const draftAds = useMemo(
    () => client.ads.filter((a) => a.status === "draft"),
    [client.ads],
  );
  const launchedAds = useMemo(
    () => client.ads.filter((a) => a.status !== "draft" && a.status !== "killed"),
    [client.ads],
  );

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-8">
      <div className="space-y-8 min-w-0">
        <header>
          <div className="flex items-center gap-3">
            <Link href="/clients" className="text-sm text-[color:var(--muted)] hover:underline">← Clients</Link>
            <span className="pill">{client.goal.replace("_", " ")}</span>
          </div>
          <h1 className="font-display text-3xl font-semibold mt-2">{client.name}</h1>
          <p className="text-[color:var(--muted)]">
            {client.websiteUrl} · ${client.monthlyBudgetUsd}/mo · {client.offer}
          </p>
        </header>

        {error && <div className="pill pill-red">{error}</div>}

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
              <div className="grid md:grid-cols-2 gap-3">
                {draftAds.map((ad) => (
                  <AdCard key={ad.id} ad={ad} />
                ))}
              </div>
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
            <button
              className="btn btn-primary"
              onClick={runGenerate}
              disabled={busy === "generate" || !client.analysis}
            >
              {busy === "generate" ? "Cooking…" : "Generate ads"}
            </button>
          }
        />

        {/* Step 3: Launch */}
        <StepCard
          step={3}
          title="Launch to Meta (paused)"
          done={launchedAds.length > 0}
          disabled={draftAds.length === 0}
          disabledHint="Nothing to launch. Generate a battery first."
          children={
            launchedAds.length > 0 ? (
              <div className="grid md:grid-cols-2 gap-3">
                {launchedAds.map((ad) => (
                  <AdCard key={ad.id} ad={ad} launched />
                ))}
              </div>
            ) : (
              <p className="text-[color:var(--muted)]">
                We create the campaign + ad set on Meta and upload each ad in
                <b> PAUSED </b> state. Nothing spends a cent until you flip it live
                in Ads Manager. Daily budget: ${Math.round(client.monthlyBudgetUsd / 30)}.
              </p>
            )
          }
          action={
            <button
              className="btn btn-primary"
              onClick={() => runLaunch(draftAds.map((a) => a.id))}
              disabled={busy === "launch" || draftAds.length === 0}
            >
              {busy === "launch"
                ? "Launching…"
                : `Launch ${draftAds.length} ad${draftAds.length === 1 ? "" : "s"}`}
            </button>
          }
        />

        {/* Step 4: Optimize */}
        <StepCard
          step={4}
          title="Daily review & optimize"
          done={client.optimizations.length > 0}
          disabled={launchedAds.length === 0}
          disabledHint="Launch ads first. No ads, nothing to review."
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
            <div className="flex gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => runOptimize(false)}
                disabled={busy === "optimize" || launchedAds.length === 0}
              >
                {busy === "optimize" ? "Reviewing…" : "Review only"}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => runOptimize(true)}
                disabled={busy === "optimize" || launchedAds.length === 0}
              >
                Review & apply
              </button>
            </div>
          }
        />
      </div>

      <aside className="lg:sticky lg:top-20 h-[75vh] min-h-[500px]">
        <ChatPanel clientId={client.id} clientName={client.name} />
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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

