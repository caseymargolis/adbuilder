"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientRecord } from "@/lib/types";

interface AdAccount {
  id: string;
  name: string;
  accountStatus: number;
  currency: string;
  businessId?: string;
  businessName?: string;
}

interface Page {
  id: string;
  name: string;
  category?: string;
  hasAccessToken: boolean;
}

export default function Picker({ client }: { client: ClientRecord }) {
  const router = useRouter();
  const [adAccounts, setAdAccounts] = useState<AdAccount[] | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState(client.metaAdAccountId ?? "");
  const [pageId, setPageId] = useState(client.metaPageId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/meta/list-assets?clientId=${client.id}`,
      );
      const j = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(j.error || "Couldn't load assets.");
        return;
      }
      setAdAccounts(j.adAccounts);
      setPages(j.pages);
    })();
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  const selectedAccount = useMemo(
    () => adAccounts?.find((a) => a.id === adAccountId),
    [adAccounts, adAccountId],
  );

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/meta/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: client.id,
        adAccountId,
        pageId,
        adAccountName: selectedAccount?.name,
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
    if (!confirm("Disconnect this client from Meta?")) return;
    await fetch("/api/meta/oauth/disconnect", {
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
          Pick the ad account + page
        </h1>
        <p className="text-[color:var(--muted)] mt-1">
          Connected as <b>{client.metaOAuth?.userName}</b>. Choose where this
          client's ads should run. You can change this later.
        </p>
      </header>

      {error && <div className="pill pill-red">{error}</div>}

      <section className="card p-6 space-y-4">
        <div>
          <label className="label">Ad account</label>
          {adAccounts === null ? (
            <div className="text-sm text-[color:var(--muted)]">
              Loading ad accounts you can access…
            </div>
          ) : adAccounts.length === 0 ? (
            <div className="text-sm">
              No ad accounts found on this Facebook user. Make sure they have
              admin access to at least one ad account in a Business Manager.
            </div>
          ) : (
            <select
              className="select"
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
            >
              <option value="">Select an ad account…</option>
              {adAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                  {a.businessName ? ` · ${a.businessName}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="label">Facebook page</label>
          {pages === null ? (
            <div className="text-sm text-[color:var(--muted)]">
              Loading pages…
            </div>
          ) : pages.length === 0 ? (
            <div className="text-sm">
              No pages found. The Facebook user needs to be an admin of at
              least one page that the ads will run from.
            </div>
          ) : (
            <select
              className="select"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            >
              <option value="">Select a page…</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.category ? ` · ${p.category}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

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
            disabled={!adAccountId || !pageId || saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </section>

      <div className="text-xs text-[color:var(--muted)]">
        Token expires{" "}
        {client.metaOAuth?.expiresAt
          ? new Date(client.metaOAuth.expiresAt).toLocaleDateString()
          : "—"}
        . We refresh it automatically when it gets within a week of expiry.
      </div>
    </div>
  );
}
