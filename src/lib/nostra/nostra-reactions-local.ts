/**
 * Sender-side local reactions store for Nostra P2P (FIND-1526f892 Phase 2a).
 *
 * When a user taps a reaction, tweb's appReactionsManager.sendReaction goes
 * through the MTProto path and does NOT update any Nostra-visible UI. Until
 * Phase 2b adds the NIP-25 kind-7 relay publish + receive bridge, we
 * maintain a local-only store scoped to the sender's session so the
 * reaction appears immediately on the bubble.
 *
 * Intentionally in-memory (cleared on logout/reload) — reactions are not
 * persisted; receiving a reaction from the other side will come in 2b and
 * will use a separate store.
 */
import rootScope from '@lib/rootScope';

type Key = string; // `${peerId}:${mid}`

const key = (peerId: number, mid: number): Key => `${peerId}:${mid}`;

class NostraReactionsLocal {
  private store: Map<Key, Set<string>> = new Map();

  addReaction(peerId: number, mid: number, emoji: string): void {
    const k = key(peerId, mid);
    let set = this.store.get(k);
    if(!set) {set = new Set(); this.store.set(k, set);}
    const existed = set.has(emoji);
    set.add(emoji);
    if(!existed) {
      rootScope.dispatchEventSingle('nostra_reaction_added', {peerId, mid, emoji});
    }
  }

  getReactions(peerId: number, mid: number): string[] {
    const set = this.store.get(key(peerId, mid));
    return set ? Array.from(set) : [];
  }

  clear(): void {
    this.store.clear();
  }
}

export const nostraReactionsLocal = new NostraReactionsLocal();

if(typeof window !== 'undefined') {
  (window as any).__nostraReactionsLocal = nostraReactionsLocal;
}
