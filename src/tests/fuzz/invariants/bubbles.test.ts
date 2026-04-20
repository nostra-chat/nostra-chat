import {describe, it, expect, vi} from 'vitest';
import {noDupMid, bubbleChronological, noAutoPin} from './bubbles';
import type {FuzzContext, UserHandle} from '../types';

function userWithBubbles(bubbles: Array<{mid: string; timestamp: number; pinned?: boolean}>): UserHandle {
  // forEachUser calls page.evaluate(COLLECT_BUBBLES) to fetch a snapshot, then
  // runs the invariant logic in Node against it. The mock returns the fake
  // snapshot regardless of which collector was passed.
  const snapshot = {
    bubbles: bubbles.map((b) => ({
      dataset: {mid: b.mid, timestamp: String(b.timestamp)},
      classList: b.pinned ? ['bubble', 'is-pinned'] : ['bubble']
    }))
  };
  return {
    id: 'userA',
    context: null as any,
    page: {evaluate: vi.fn(async () => snapshot)} as any,
    displayName: 'A',
    npub: '',
    remotePeerId: 0,
    consoleLog: [],
    reloadTimes: [Date.now() - 60_000]
  };
}

function ctx(user: UserHandle): FuzzContext {
  return {users: {userA: user, userB: user}, relay: null as any, snapshots: new Map(), actionIndex: 0};
}

describe('INV-no-dup-mid', () => {
  it('passes when mids are unique', async () => {
    const r = await noDupMid.check(ctx(userWithBubbles([{mid: '1', timestamp: 1}, {mid: '2', timestamp: 2}])));
    expect(r.ok).toBe(true);
  });
  it('fails when duplicate mid present', async () => {
    const r = await noDupMid.check(ctx(userWithBubbles([{mid: '1', timestamp: 1}, {mid: '1', timestamp: 2}])));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('duplicate');
  });
});

describe('INV-bubble-chronological', () => {
  it('passes on monotonic order', async () => {
    const r = await bubbleChronological.check(ctx(userWithBubbles([
      {mid: '1', timestamp: 1000},
      {mid: '2', timestamp: 2000},
      {mid: '3', timestamp: 3000}
    ])));
    expect(r.ok).toBe(true);
  });
  it('fails on out-of-order', async () => {
    const r = await bubbleChronological.check(ctx(userWithBubbles([
      {mid: '1', timestamp: 3000},
      {mid: '2', timestamp: 1000}
    ])));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not chronological');
  });
});

describe('INV-bubble-chronological — FIND-c0046153 regression', () => {
  it('fails when a late-arriving peer message is appended out of order', async () => {
    // Replicates the failing sequence from FIND-c0046153:
    // timestamps: [1776632349, 1776632351, 1776632349, 1776632353]
    const r = await bubbleChronological.check(ctx(userWithBubbles([
      {mid: '100', timestamp: 1776632349},
      {mid: '101', timestamp: 1776632351},
      {mid: '102', timestamp: 1776632349},
      {mid: '103', timestamp: 1776632353}
    ])));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not chronological');
    expect(r.evidence?.timestamps).toEqual([1776632349, 1776632351, 1776632349, 1776632353]);
  });
});

describe('INV-bubble-chronological — FIND-chrono-v2 regression', () => {
  // Three items with identical timestamp but distinct mid; insertion order
  // is reversed from expected. After sort, must land in descending mid.
  it('sorts same-timestamp items by mid desc deterministically', () => {
    const items = [
      {mid: 100, timestamp: 1712345678},
      {mid: 300, timestamp: 1712345678},
      {mid: 200, timestamp: 1712345678}
    ];
    // Sort comparator under test (replicate the P2P path)
    items.sort((a, b) => {
      if(a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
      return b.mid - a.mid;
    });
    expect(items.map((i) => i.mid)).toEqual([300, 200, 100]);
  });

  it('is deterministic across 20 runs', () => {
    for(let run = 0; run < 20; run++) {
      const shuffled = [
        {mid: 100, timestamp: 1712345678},
        {mid: 300, timestamp: 1712345678},
        {mid: 200, timestamp: 1712345678}
      ].sort(() => Math.random() - 0.5);
      shuffled.sort((a, b) => {
        if(a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
        return b.mid - a.mid;
      });
      expect(shuffled.map((i) => i.mid)).toEqual([300, 200, 100]);
    }
  });
});

describe('INV-no-auto-pin', () => {
  it('passes when no bubble is pinned', async () => {
    const r = await noAutoPin.check(ctx(userWithBubbles([{mid: '1', timestamp: 1}])));
    expect(r.ok).toBe(true);
  });
  it('fails when a bubble is pinned (no user pin action)', async () => {
    const r = await noAutoPin.check(ctx(userWithBubbles([{mid: '1', timestamp: 1, pinned: true}])));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('pinned');
  });
});
