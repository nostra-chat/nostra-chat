import {describe, it, expect, beforeEach, vi} from 'vitest';

describe('nostra reactions local store', () => {
  let store: any;

  beforeEach(async() => {
    vi.resetModules();
    const mod = await import('@lib/nostra/nostra-reactions-local');
    store = mod.nostraReactionsLocal;
    store.clear();
  });

  it('returns empty list for an unknown (peerId, mid)', () => {
    expect(store.getReactions(42, 1000)).toEqual([]);
  });

  it('adds an emoji reaction for a message and returns it', () => {
    store.addReaction(42, 1000, '👍');
    expect(store.getReactions(42, 1000)).toEqual(['👍']);
  });

  it('deduplicates same emoji on same message', () => {
    store.addReaction(42, 1000, '👍');
    store.addReaction(42, 1000, '👍');
    expect(store.getReactions(42, 1000)).toEqual(['👍']);
  });

  it('keeps reactions per-message scoped', () => {
    store.addReaction(42, 1000, '👍');
    store.addReaction(42, 1001, '🔥');
    expect(store.getReactions(42, 1000)).toEqual(['👍']);
    expect(store.getReactions(42, 1001)).toEqual(['🔥']);
  });

  it('dispatches nostra_reaction_added on rootScope when a reaction is added', async() => {
    const dispatches: any[] = [];
    vi.doMock('@lib/rootScope', () => ({
      default: {
        dispatchEventSingle: (name: string, payload: any) => dispatches.push({name, payload})
      }
    }));
    vi.resetModules();
    const mod = await import('@lib/nostra/nostra-reactions-local');
    const fresh = mod.nostraReactionsLocal;
    fresh.clear();
    fresh.addReaction(42, 1000, '👍');
    expect(dispatches).toEqual([
      {name: 'nostra_reaction_added', payload: {peerId: 42, mid: 1000, emoji: '👍'}}
    ]);
    vi.unmock('@lib/rootScope');
  });
});
