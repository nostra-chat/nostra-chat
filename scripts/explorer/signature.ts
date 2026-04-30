import {existsSync, readFileSync, writeFileSync} from 'node:fs';

export interface SignatureKey {
  area: string;
  intent: string;
  oracle: string;
  hash: string;
}

export interface SeenEntry {
  find_id: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  status: 'open' | 'fixed' | 'allowlisted';
  fix_pr?: string;
  fix_branch?: string;
}

export type SeenStore = Record<string, SeenEntry>;

export interface Sighting {
  signature: string;
  findId: string;
  timestamp: string;
}

export interface RecordResult {
  isNew: boolean;
  regression: boolean;
  entry: SeenEntry;
}

export function computeSignature(key: SignatureKey): string {
  return `${key.area}:${key.intent}:${key.oracle}:${key.hash}`;
}

export async function loadStore(storePath: string): Promise<SeenStore> {
  if(!existsSync(storePath)) return {};
  const raw = readFileSync(storePath, 'utf8');
  if(!raw.trim()) return {};
  return JSON.parse(raw) as SeenStore;
}

export async function recordSighting(storePath: string, s: Sighting): Promise<RecordResult> {
  const store = await loadStore(storePath);
  const existing = store[s.signature];
  if(!existing) {
    const entry: SeenEntry = {
      find_id: s.findId,
      occurrences: 1,
      first_seen: s.timestamp,
      last_seen: s.timestamp,
      status: 'open'
    };
    store[s.signature] = entry;
    writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
    return {isNew: true, regression: false, entry};
  }
  const regression = existing.status === 'fixed';
  existing.occurrences += 1;
  existing.last_seen = s.timestamp;
  writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', 'utf8');
  return {isNew: false, regression, entry: existing};
}
