"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientRecord } from "@/lib/types";

interface Customer {
  resourceName: string;
  customerId: string;
  descriptiveName?: string;
  currencyCode?: string;
  manager?: boolean;
}

export default function Picker({ client }: { client: ClientRecord }) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState(client.googleAds?.customerId ?? "");
  const [loginCustomerId, setLoginCustomerId] = useState(
    client.googleAds?.loginCustomerId ?? "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/google/list-customers?clientId=${client.id}`,
      );
      const j = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(j.error || "Couldn't load Google Ads customers.");
        return;
      }
      setCustomers(j.customers as Customer[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  const selected = useMemo(
    () => customers?.find((c) => c.customerId === customerId),
    [customers, customerId],
  );
  const managers = useMemo(
    () => customers?.filter((c) => c.manager) ?? [],
    [customers],
  );

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/google/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        customerId,
        loginCustomerId: loginCustomerId || undefined,
        customerName: selected?.descriptiveName,
      }),
    });
    if (!res.ok) {
      const j = await res.json();
      setError(j.error || "Save failed");
      setSaving(false);
      return;
    }
    router.push(`/clients/${client.id}`);
  }

  async function disconnect() {
    if (!confirm("Disconnect this client from Google Ads?")) return;
    await fetch("/api/google/oauth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id }),
    });
    router.refresh();
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <Link
          href={`/clients/${client.id}`}
          className="text-sm text-[color:var(--muted)] hover:underline"
        >
          ← {client.name}
        </Link>
        <h1 className="font-display text-3xl font-semibold mt-2">
          Pick the Google Ads customer
        </h1>
        <p className="text-[color:var(--muted)] mt-1">
          Connected as <b>{client.googleOAuth?.email}</b>. If access is via an
          MCC manager, also pick the manager.
        </p>
      </header>

      {error && <div className="pill pill-red">{error}</div>}

      <section className="card p-6 space-y-4">
        <div>
          <label className="label">Customer (the account that runs ads)</label>
          {customers === null ? (
            <div className="text-sm text-[color:var(--muted)]">Loading…</div>
          ) : customers.length === 0 ? (
            <div className="text-sm">
              No accessible customers. The signed-in Google user must be linked
              to at least one Google Ads customer.
            </div>
          ) : (
            <select
              className="select"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {customers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.descriptiveName || c.customerId}
                  {c.currencyCode ? ` · ${c.currencyCode}` : ""}
                  {c.manager ? " · manager" : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {managers.length > 0 && (
          <div>
            <label className="label">
              Login customer (manager / MCC) — optional
            </label>
            <select
              className="select"
              value={loginCustomerId}
              onChange={(e) => setLoginCustomerId(e.target.value)}
            >
              <option value="">Direct access (no manager)</option>
              {managers.map((c) => (
                <option key={c.customerId} value={c.customerId}>
                  {c.descriptiveName || c.customerId} · manager
                </option>
              ))}
            </select>
            <p className="text-xs text-[color:var(--muted)] mt-1">
              Only needed if the customer above is accessed through a manager
              account. Pick the manager if so.
            </p>
          </div>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-[color:var(--line)]">
          <button
            type="button"
            className="text-sm text-[color:var(--terracotta)] hover:underline"
            onClick={disconnect}
          >
            Disconnect
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!customerId || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
