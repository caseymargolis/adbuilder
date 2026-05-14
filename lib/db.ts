/**
 * DB facade. If DATABASE_URL is set, we delegate to the Postgres adapter.
 * Otherwise we use the JSON file adapter, which is perfect for local dev and
 * single-user internal tools.
 *
 * The two adapters export the exact same function signatures, so switching
 * between them is a one-env-var change.
 */

import * as jsonAdapter from "./db-json";
import * as pgAdapter from "./db-postgres";
import type {
  AdRecord,
  ClientRecord,
  OptimizationLog,
} from "./types";

const usePostgres = !!process.env.DATABASE_URL;
const backend = usePostgres ? pgAdapter : jsonAdapter;

export async function listClients(): Promise<ClientRecord[]> {
  return backend.listClients();
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  return backend.getClient(id);
}

export async function upsertClient(client: ClientRecord): Promise<void> {
  return backend.upsertClient(client);
}

export async function addAd(clientId: string, ad: AdRecord): Promise<void> {
  return backend.addAd(clientId, ad);
}

export async function updateAd(
  clientId: string,
  adId: string,
  update: (ad: AdRecord) => AdRecord,
): Promise<AdRecord> {
  return backend.updateAd(clientId, adId, update);
}

export async function appendOptimization(
  clientId: string,
  log: OptimizationLog,
): Promise<void> {
  return backend.appendOptimization(clientId, log);
}

export async function removeAd(clientId: string, adId: string): Promise<void> {
  return backend.removeAd(clientId, adId);
}

export async function deleteClient(clientId: string): Promise<void> {
  return backend.deleteClient(clientId);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function dbBackend(): "postgres" | "json" {
  return usePostgres ? "postgres" : "json";
}
