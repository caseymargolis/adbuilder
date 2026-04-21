import Link from "next/link";
import { listClients } from "@/lib/db";

export default async function HomePage() {
  const clients = await listClients();
  return (
    <div className="space-y-10">
      <section className="pt-4">
        <p className="text-xs uppercase tracking-widest text-[color:var(--muted)] font-semibold">
          Meta ads, for humans
        </p>
        <h1 className="font-display text-5xl leading-tight mt-2 max-w-3xl">
          Paste a website. Get ads that are worth testing.
        </h1>
        <p className="mt-4 max-w-2xl text-[color:var(--muted)]">
          Adwise reads the client's site, writes the test battery, pairs each ad
          with an image from whichever model is best at the job, launches to Meta,
          and checks in daily to kill what's losing and double down on what isn't.
          The chat companion answers the question, not the LinkedIn version of it.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/clients/new" className="btn btn-primary">
            Add a client
          </Link>
          <Link href="/clients" className="btn btn-ghost">
            See existing clients
          </Link>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <Feature
          title="One form, five ads"
          body="Client URL + a sentence about the offer. We handle positioning, audience read, and a five-variant test plan with hypotheses."
        />
        <Feature
          title="Best model for the job"
          body="Text-heavy posters go to Ideogram 3.0. Photoreal goes to FLUX 1.1 Pro. Illustration goes to Imagen 4. Claude picks, and it says why."
        />
        <Feature
          title="Daily reviews, plain English"
          body="Every morning: what's working, what's tired, what to kill, and what to scale. With numbers. No 'consider optimizing.'"
        />
      </section>

      <section>
        <div className="flex items-end justify-between mb-3">
          <h2 className="font-display text-2xl font-semibold">Recent clients</h2>
          <Link href="/clients" className="text-sm underline">See all →</Link>
        </div>
        {clients.length === 0 ? (
          <div className="card p-6 text-[color:var(--muted)]">
            No clients yet. Once you add one, you'll see them here. It takes
            about 90 seconds — URL, goal, a sentence about the offer.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {clients.slice(0, 4).map((c) => (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="card p-4 hover:shadow-sm transition"
              >
                <div className="flex items-center justify-between">
                  <div className="font-display text-lg font-semibold">{c.name}</div>
                  <span className="pill">{c.goal}</span>
                </div>
                <div className="text-sm text-[color:var(--muted)] mt-1">
                  {c.websiteUrl}
                </div>
                <div className="text-xs text-[color:var(--muted)] mt-2">
                  {c.ads.length} ad{c.ads.length === 1 ? "" : "s"} · ${c.monthlyBudgetUsd}/mo
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-5">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="text-sm mt-2 text-[color:var(--muted)] leading-relaxed">{body}</p>
    </div>
  );
}
