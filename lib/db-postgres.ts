/**
 * Postgres adapter. Uses node-postgres directly — no ORM — because the data
 * model is tiny (clients + ads + optimization_logs) and keeping this file
 * self-contained makes swapping to a hosted DB trivial.
 *
 * Schema is auto-applied on first use. All mutable fields live in a single
 * JSONB column per table so the app code stays identical to the JSON adapter.
 *
 * Enabled when DATABASE_URL is set. Any Postgres 14+ instance works
 * (Neon, Supabase, Render, a local docker).
 */

import type { AdRecord, ClientRecord, OptimizationLog } from "./types";

// Lazy-load pg so environments that don't use Postgres don't need the dep
// to exist at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

async function pool() {
  if (_pool) return _pool;
  // Dynamic import so the JSON path doesn't require `pg`.
  const pg = await import("pg").catch(() => null);
  if (!pg) {
    throw new Error(
      "DATABASE_URL is set but the `pg` package isn't installed. Run: npm install pg",
    );
  }
  const Pool = (pg as unknown as { default?: { Pool: new (c: unknown) => unknown }; Pool?: new (c: unknown) => unknown }).default?.Pool ?? (pg as unknown as { Pool: new (c: unknown) => unknown }).Pool;
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(_pool);
  return _pool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function migrate(p: any): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      data JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ads (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ads_client_id_idx ON ads(client_id);
    CREATE TABLE IF NOT EXISTS optimization_logs (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS opt_logs_client_idx
      ON optimization_logs(client_id, at DESC);
  `);
}

async function hydrate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
  clientRow: { id: string; data: Omit<ClientRecord, "ads" | "optimizations"> },
): Promise<ClientRecord> {
  const ads = (
    await p.query("SELECT data FROM ads WHERE client_id = $1 ORDER BY created_at ASC", [
      clientRow.id,
    ])
  ).rows.map((r: { data: AdRecord }) => r.data);
  const optimizations = (
    await p.query(
      "SELECT data FROM optimization_logs WHERE client_id = $1 ORDER BY at DESC LIMIT 100",
      [clientRow.id],
    )
  ).rows.map((r: { data: OptimizationLog }) => r.data);
  return { ...clientRow.data, ads, optimizations } as ClientRecord;
}

export async function listClients(): Promise<ClientRecord[]> {
  const p = await pool();
  const { rows } = await p.query(
    "SELECT id, data FROM clients ORDER BY created_at DESC",
  );
  const out: ClientRecord[] = [];
  for (const r of rows) out.push(await hydrate(p, r));
  return out;
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const p = await pool();
  const { rows } = await p.query("SELECT id, data FROM clients WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  return hydrate(p, rows[0]);
}

export async function upsertClient(client: ClientRecord): Promise<void> {
  const p = await pool();
  const { ads, optimizations, ...rest } = client;
  await p.query(
    `INSERT INTO clients (id, name, data) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data`,
    [client.id, client.name, rest],
  );
  // We don't nuke+restore ads/optimizations here — those flow through the ad
  // and optimization helpers below.
  void ads;
  void optimizations;
}

export async function addAd(clientId: string, ad: AdRecord): Promise<void> {
  const p = await pool();
  await p.query(
    `INSERT INTO ads (id, client_id, data) VALUES ($1, $2, $3)`,
    [ad.id, clientId, ad],
  );
}

export async function updateAd(
  clientId: string,
  adId: string,
  update: (ad: AdRecord) => AdRecord,
): Promise<AdRecord> {
  const p = await pool();
  const { rows } = await p.query(
    "SELECT data FROM ads WHERE id = $1 AND client_id = $2 FOR UPDATE",
    [adId, clientId],
  );
  if (rows.length === 0) throw new Error("ad not found");
  const next = update(rows[0].data as AdRecord);
  await p.query("UPDATE ads SET data = $1 WHERE id = $2", [next, adId]);
  return next;
}

export async function appendOptimization(
  clientId: string,
  log: OptimizationLog,
): Promise<void> {
  const p = await pool();
  await p.query(
    `INSERT INTO optimization_logs (id, client_id, at, data) VALUES ($1, $2, $3, $4)`,
    [log.id, clientId, log.at, log],
  );
}
