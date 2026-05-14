import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdRecord,
  ClientRecord,
  OptimizationLog,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(CLIENTS_FILE);
  } catch {
    await fs.writeFile(CLIENTS_FILE, "[]", "utf8");
  }
}

export async function listClients(): Promise<ClientRecord[]> {
  await ensureFile();
  const raw = await fs.readFile(CLIENTS_FILE, "utf8");
  return JSON.parse(raw) as ClientRecord[];
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const all = await listClients();
  return all.find((c) => c.id === id) ?? null;
}

async function saveClients(clients: ClientRecord[]): Promise<void> {
  await ensureFile();
  await fs.writeFile(CLIENTS_FILE, JSON.stringify(clients, null, 2), "utf8");
}

export async function upsertClient(client: ClientRecord): Promise<void> {
  const all = await listClients();
  const idx = all.findIndex((c) => c.id === client.id);
  if (idx >= 0) all[idx] = client;
  else all.push(client);
  await saveClients(all);
}

export async function addAd(clientId: string, ad: AdRecord): Promise<void> {
  const all = await listClients();
  const c = all.find((x) => x.id === clientId);
  if (!c) throw new Error("client not found");
  c.ads.push(ad);
  await saveClients(all);
}

export async function updateAd(
  clientId: string,
  adId: string,
  update: (ad: AdRecord) => AdRecord,
): Promise<AdRecord> {
  const all = await listClients();
  const c = all.find((x) => x.id === clientId);
  if (!c) throw new Error("client not found");
  const idx = c.ads.findIndex((a) => a.id === adId);
  if (idx < 0) throw new Error("ad not found");
  c.ads[idx] = update(c.ads[idx]);
  await saveClients(all);
  return c.ads[idx];
}

export async function appendOptimization(
  clientId: string,
  log: OptimizationLog,
): Promise<void> {
  const all = await listClients();
  const c = all.find((x) => x.id === clientId);
  if (!c) throw new Error("client not found");
  c.optimizations.unshift(log);
  await saveClients(all);
}

export async function removeAd(clientId: string, adId: string): Promise<void> {
  const all = await listClients();
  const c = all.find((x) => x.id === clientId);
  if (!c) throw new Error("client not found");
  c.ads = c.ads.filter((a) => a.id !== adId);
  await saveClients(all);
}

export async function deleteClient(clientId: string): Promise<void> {
  const all = await listClients();
  const filtered = all.filter((c) => c.id !== clientId);
  await saveClients(filtered);
}
