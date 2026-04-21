import Link from "next/link";
import { listClients } from "@/lib/db";

export default async function ClientsPage() {
  const clients = await listClients();
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
            <Link key={c.id} href={`/clients/${c.id}`} className="card p-4 hover:shadow-sm transition">
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
          ))}
        </div>
      )}
    </div>
  );
}
