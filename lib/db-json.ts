import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdRecord,
  ClientRecord,
  OptimizationLog,
} from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");
const LOCK_FILE = path.join(DATA_DIR, "clients.lock");

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(CLIENTS_FILE);
  } catch {
    await fs.writeFile(CLIENTS_FILE, "[]", "utf8");
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const maxWait = 10000; // 10 seconds max wait
  const interval = 50;
  let waited = 0;

  while (waited < maxWait) {
    try {
      await fs.writeFile(LOCK_FILE, Date.now().toString(), { flag: "wx" });
      try {
        return await fn();
      } finally {
        await fs.unlink(LOCK_FILE);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await new Promise((resolve) => setTimeout(resolve, interval));
      waited += interval;
    }
  }
  throw new Error("Could not acquire file lock");
}

export async function listClients(): Promise<ClientRecord[]> {
  await ensureFile();
  const raw = await fs.readFile(CLIENTS_FILE, "utf8");
  try {
    return JSON.parse(raw) as ClientRecord[];
  } catch (e) {
    console.error("Failed to parse clients.json, resetting file:", (e as Error).message);
    // Reset corrupted file
    await fs.writeFile(CLIENTS_FILE, "[]", "utf8");
    return [];
  }
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const all = await listClients();
  return all.find((c) => c.id === id) ?? null;
}

async function saveClients(clients: ClientRecord[]): Promise<void> {
  await ensureFile();
  const tempFile = CLIENTS_FILE + ".tmp";
  await fs.writeFile(tempFile, JSON.stringify(clients, null, 2), "utf8");
  await fs.rename(tempFile, CLIENTS_FILE);
}

export async function upsertClient(client: ClientRecord): Promise<void> {
  await withLock(async () => {
    const all = await listClients();
    const idx = all.findIndex((c) => c.id === client.id);
    if (idx >= 0) all[idx] = client;
    else all.push(client);
    await saveClients(all);
  });
}

export async function addAd(clientId: string, ad: AdRecord): Promise<void> {
  await withLock(async () => {
    const all = await listClients();
    const c = all.find((x) => x.id === clientId);
    if (!c) throw new Error("client not found");
    c.ads.push(ad);
    await saveClients(all);
  });
}

export async function updateAd(
  clientId: string,
  adId: string,
  update: (ad: AdRecord) => AdRecord,
): Promise<AdRecord> {
  return await withLock(async () => {
    const all = await listClients();
    const c = all.find((x) => x.id === clientId);
    if (!c) throw new Error("client not found");
    const idx = c.ads.findIndex((a) => a.id === adId);
    if (idx < 0) throw new Error("ad not found");
    c.ads[idx] = update(c.ads[idx]);
    await saveClients(all);
    return c.ads[idx];
  });
}

export async function appendOptimization(
  clientId: string,
  log: OptimizationLog,
): Promise<void> {
  await withLock(async () => {
    const all = await listClients();
    const c = all.find((x) => x.id === clientId);
    if (!c) throw new Error("client not found");
    c.optimizations.unshift(log);
    await saveClients(all);
  });
}

export async function removeAd(clientId: string, adId: string): Promise<void> {
  await withLock(async () => {
    const all = await listClients();
    const c = all.find((x) => x.id === clientId);
    if (!c) throw new Error("client not found");
    c.ads = c.ads.filter((a) => a.id !== adId);
    await saveClients(all);
  });
}

export async function deleteClient(clientId: string): Promise<void> {
  await withLock(async () => {
    const all = await listClients();
    const filtered = all.filter((c) => c.id !== clientId);
    await saveClients(filtered);
  });
}
