"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Form {
  name: string;
  websiteUrl: string;
  goal: string;
  monthlyBudgetUsd: string;
  offer: string;
  audienceNotes: string;
  notifyEmail: string;
  metaAdAccountId: string;
  metaPageId: string;
}

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState<Form>({
    name: "",
    websiteUrl: "",
    goal: "leads",
    monthlyBudgetUsd: "1500",
    offer: "",
    audienceNotes: "",
    notifyEmail: "",
    metaAdAccountId: "",
    metaPageId: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaStatus, setMetaStatus] = useState<
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; accountName: string }
    | { kind: "fail"; error: string }
  >({ kind: "idle" });

  async function checkMeta() {
    if (!form.metaAdAccountId || !form.metaPageId) {
      setMetaStatus({
        kind: "fail",
        error: "Fill in both ad account ID and page ID first.",
      });
      return;
    }
    setMetaStatus({ kind: "checking" });
    const res = await fetch("/api/meta/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adAccountId: form.metaAdAccountId,
        pageId: form.metaPageId,
      }),
    });
    const j = (await res.json()) as
      | { ok: true; accountName: string }
      | { ok: false; error: string };
    if (j.ok) setMetaStatus({ kind: "ok", accountName: j.accountName });
    else setMetaStatus({ kind: "fail", error: j.error });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        websiteUrl: form.websiteUrl,
        goal: form.goal,
        monthlyBudgetUsd: Number(form.monthlyBudgetUsd),
        offer: form.offer,
        audienceNotes: form.audienceNotes,
      };
      if (form.notifyEmail) payload.notifyEmail = form.notifyEmail;
      if (form.metaAdAccountId) payload.metaAdAccountId = form.metaAdAccountId;
      if (form.metaPageId) payload.metaPageId = form.metaPageId;
      if (metaStatus.kind === "ok") {
        payload.metaAccountName = metaStatus.accountName;
      }

      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Something broke. Check the server logs.");
      }
      const { client } = await res.json();
      router.push(`/clients/${client.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Onboard a client</h1>
      <p className="text-[color:var(--muted)] mt-2 mb-6">
        Two minutes. The brand bit asks for what we actually use; the Meta bit is
        optional but lets us launch ads to the right account.
      </p>

      <form onSubmit={submit} className="space-y-6">
        <section className="card p-6 space-y-4">
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Brand
          </div>

          <Field label="Client name" hint="What you'd call them in Slack.">
            <input
              className="input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Riverline Coffee Co."
            />
          </Field>

          <Field label="Website URL" hint="Paste the home page. http:// optional.">
            <input
              className="input"
              required
              value={form.websiteUrl}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              placeholder="riverlinecoffee.com"
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Primary goal" hint="What actually matters.">
              <select
                className="select"
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              >
                <option value="leads">Leads / signups</option>
                <option value="sales">Sales / purchases</option>
                <option value="traffic">Traffic</option>
                <option value="awareness">Awareness</option>
                <option value="app_installs">App installs</option>
                <option value="messages">Messages / DMs</option>
              </select>
            </Field>

            <Field label="Monthly ad budget ($)" hint="USD. We divide by 30 per day.">
              <input
                className="input"
                type="number"
                min={100}
                step={100}
                value={form.monthlyBudgetUsd}
                onChange={(e) =>
                  setForm({ ...form, monthlyBudgetUsd: e.target.value })
                }
              />
            </Field>
          </div>

          <Field
            label="What they sell — in one sentence"
            hint="'Organic cold brew subscriptions shipped monthly' beats 'coffee.'"
          >
            <input
              className="input"
              required
              value={form.offer}
              onChange={(e) => setForm({ ...form, offer: e.target.value })}
              placeholder="Organic cold brew subscriptions shipped monthly."
            />
          </Field>

          <Field
            label="Audience notes (optional)"
            hint="Anything you already know about who buys."
          >
            <textarea
              className="textarea"
              rows={2}
              value={form.audienceNotes}
              onChange={(e) =>
                setForm({ ...form, audienceNotes: e.target.value })
              }
              placeholder="30-45, coastal cities, owns an espresso machine and feels a little guilty about it."
            />
          </Field>
        </section>

        <section className="card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
              Meta connection
            </div>
            <span className="pill">optional</span>
          </div>
          <p className="small muted text-sm text-[color:var(--muted)]">
            Without this, the client launches in <b>mock mode</b> — you'll see
            the full pipeline but nothing hits real Meta. To launch real ads,
            paste the client's Ad Account ID and the Facebook Page ID their ads
            run from. We use a single agency System User token (configured at
            the server level) to authenticate.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <Field
              label="Ad account ID"
              hint="From Meta Ads Manager. Starts with act_."
            >
              <input
                className="input"
                value={form.metaAdAccountId}
                onChange={(e) =>
                  setForm({ ...form, metaAdAccountId: e.target.value })
                }
                placeholder="act_123456789012345"
              />
            </Field>
            <Field label="Facebook Page ID" hint="The page ads will run from.">
              <input
                className="input"
                value={form.metaPageId}
                onChange={(e) =>
                  setForm({ ...form, metaPageId: e.target.value })
                }
                placeholder="100012345678901"
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={checkMeta}
              disabled={
                metaStatus.kind === "checking" ||
                !form.metaAdAccountId ||
                !form.metaPageId
              }
            >
              {metaStatus.kind === "checking" ? "Testing…" : "Test connection"}
            </button>
            {metaStatus.kind === "ok" && (
              <span className="pill pill-green">
                ✓ Connected to {metaStatus.accountName}
              </span>
            )}
            {metaStatus.kind === "fail" && (
              <span className="pill pill-red">{metaStatus.error}</span>
            )}
          </div>
        </section>

        <section className="card p-6 space-y-4">
          <div className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
            Notifications
          </div>
          <Field
            label="Daily digest email (optional)"
            hint="Where the optimization summary goes after the daily review runs. Configure RESEND_API_KEY on the server to enable."
          >
            <input
              className="input"
              type="email"
              value={form.notifyEmail}
              onChange={(e) =>
                setForm({ ...form, notifyEmail: e.target.value })
              }
              placeholder="account-manager@yourshop.com"
            />
          </Field>
        </section>

        {error && <div className="pill pill-red">{error}</div>}

        <div className="flex justify-end gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && (
        <p className="text-xs text-[color:var(--muted)] mt-1">{hint}</p>
      )}
    </div>
  );
}
