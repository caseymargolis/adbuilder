"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    websiteUrl: "",
    goal: "leads",
    monthlyBudgetUsd: "1500",
    offer: "",
    audienceNotes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          monthlyBudgetUsd: Number(form.monthlyBudgetUsd),
        }),
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
      <h1 className="font-display text-3xl font-semibold">Add a client</h1>
      <p className="text-[color:var(--muted)] mt-2 mb-6">
        Six fields. We only ask for what we actually use. You'll get a website
        analysis and a test battery on the next screen.
      </p>

      <form onSubmit={submit} className="space-y-4 card p-6">
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

        <Field label="What they sell — in one sentence" hint="Be specific. 'Organic cold brew subscriptions shipped monthly' beats 'coffee.'">
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
          hint="Anything you already know about who buys. Skip if you don't."
        >
          <textarea
            className="textarea"
            rows={3}
            value={form.audienceNotes}
            onChange={(e) => setForm({ ...form, audienceNotes: e.target.value })}
            placeholder="30-45, coastal cities, owns an espresso machine and feels a little guilty about it."
          />
        </Field>

        {error && (
          <div className="pill pill-red">{error}</div>
        )}

        <div className="flex justify-end gap-3 pt-2">
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
