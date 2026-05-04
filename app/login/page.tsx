"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Wrong password.");
      setBusy(false);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="max-w-md mx-auto card p-8 mt-20">
      <div className="font-display text-2xl font-semibold">Adwise<span className="text-[color:var(--terracotta)]">.</span></div>
      <p className="text-[color:var(--muted)] text-sm mt-1">
        Internal access. Punch in the password your admin gave you.
      </p>
      <form onSubmit={submit} className="space-y-4 mt-6">
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error && <div className="pill pill-red">{error}</div>}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="card p-6 mt-20 max-w-md mx-auto">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
