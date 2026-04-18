// @ts-nocheck
import type {Invariant, FuzzContext, InvariantResult} from '../types';

export const noNip04: Invariant = {
  id: 'INV-no-nip04',
  tier: 'regression',
  async check(ctx: FuzzContext): Promise<InvariantResult> {
    const relay: any = ctx.relay;
    if(!relay?.getAllEvents) return {ok: true}; // in unit tests without relay
    const events = await relay.getAllEvents();
    const nip04 = events.filter((e: any) => e.kind === 4);
    if(nip04.length > 0) {
      return {ok: false, message: `found ${nip04.length} kind 4 (NIP-04) events on relay — Nostra must use NIP-44 (kind 1059 gift-wrap)`, evidence: {kindCounts: {nip04: nip04.length, total: events.length}}};
    }
    return {ok: true};
  }
};

const DUMP_IDENTITY_IDB = async() => {
  try {
    const req = indexedDB.open('Nostra.chat');
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if(!db.objectStoreNames.contains('nostra_identity')) {
      db.close();
      return '';
    }
    const tx = db.transaction('nostra_identity', 'readonly');
    const store = tx.objectStore('nostra_identity');
    const all: any[] = await new Promise((resolve, reject) => {
      const r = store.getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return JSON.stringify(all);
  } catch {
    return '';
  }
};

export const idbSeedEncrypted: Invariant = {
  id: 'INV-idb-seed-encrypted',
  tier: 'regression',
  async check(ctx: FuzzContext): Promise<InvariantResult> {
    for(const id of ['userA', 'userB'] as const) {
      const u: any = ctx.users[id];
      const dump = await u.page.evaluate(DUMP_IDENTITY_IDB);
      if(/\bnsec1[0-9a-z]{20,}/.test(dump)) {
        return {ok: false, message: `plaintext nsec1… found in nostra_identity IDB on ${id}`, evidence: {user: id, dumpSample: dump.slice(0, 200)}};
      }
      // 12-word seed phrase heuristic: four space-separated words >=3 chars each
      if(/\b[a-z]{3,12}\b(?:\s+\b[a-z]{3,12}\b){3,}/.test(dump)) {
        const hasCrypto = /ciphertext|encrypted|aesgcm|iv/i.test(dump);
        if(!hasCrypto) {
          return {ok: false, message: `plaintext seed phrase pattern found in nostra_identity IDB on ${id} (no ciphertext markers)`, evidence: {user: id, dumpSample: dump.slice(0, 200)}};
        }
      }
    }
    return {ok: true};
  }
};
