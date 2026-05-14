"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function ClientsPage() {
  const [clients, setClients] = useState<{ id: string; name: string; websiteUrl: string; goal: string; monthlyBudgetUsd: number; ads: unknown[]; analysis: unknown }[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => {
        setClients(data.clients);
        setLoading(false);
      });
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await fetch(`/api/clients/${id}`, { method: "DELETE" });
      setClients((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert("Failed to delete client");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return <div className="text-[color:var(--muted)]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="font-display text-3xl font-semibold">Clients</h1>
        <Link href="/clients/new" className="btn btn-primary">+ New client</Link>
      </div>
      {clients.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[color:var(--muted)]">
            Nothing here yet. The first client takes about a minute.
          </p>
          <Link href="/clients/new" className="btn btn-primary mt-4 inline-flex">
            Add your first client
          </Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {clients.map((c) => (
            <div key={c.id} className="card p-4 hover:shadow-sm transition relative">
              <Link href={`/clients/${c.id}`} className="block">
                <div className="flex items-center justify-between">
                  <div className="font-display text-xl font-semibold">{c.name}</div>
                  <span className="pill">{c.goal.replace("_", " ")}</span>
                </div>
                <div className="text-sm text-[color:var(--muted)] mt-1">{c.websiteUrl}</div>
                <div className="mt-3 flex gap-4 text-xs text-[color:var(--muted)]">
                  <span>{c.ads.length} ad{c.ads.length === 1 ? "" : "s"}</span>
                  <span>${c.monthlyBudgetUsd}/mo</span>
                  <span>{c.analysis ? "Analyzed" : "Not analyzed yet"}</span>
                </div>
              </Link>
              <button
                className="absolute top-4 right-4 text-xs text-red-600 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete(c.id, c.name);
                }}
                disabled={deleting === c.id}
              >
                {deleting === c.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
