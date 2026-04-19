// @vitest-environment jsdom
import {describe, it, expect, vi} from 'vitest';
import {reactionDedupe, noKind7SelfEchoDrop, reactionAuthorCheck} from './reactions';

function mkCtx(rowsByUser: Record<'userA' | 'userB', any[]>): any {
  const mk = (rows: any[]) => ({
    page: {
      evaluate: vi.fn(async () => rows)
    }
  });
  return {
    users: {userA: mk(rowsByUser.userA), userB: mk(rowsByUser.userB)},
    relay: {getAllEvents: vi.fn(async (): Promise<any[]> => [])}
  };
}

describe('INV-reaction-dedupe', () => {
  it('passes when compound keys are unique', async () => {
    const ctx = mkCtx({
      userA: [{targetEventId: 'e1', fromPubkey: 'p1', emoji: '👍'}],
      userB: []
    });
    const r = await reactionDedupe.check(ctx);
    expect(r.ok).toBe(true);
  });

  it('fails when compound key repeats', async () => {
    const ctx = mkCtx({
      userA: [
        {targetEventId: 'e1', fromPubkey: 'p1', emoji: '👍'},
        {targetEventId: 'e1', fromPubkey: 'p1', emoji: '👍'}
      ],
      userB: []
    });
    const r = await reactionDedupe.check(ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/duplicate/);
  });
});

describe('INV-no-kind7-self-echo-drop', () => {
  it('passes when own emoji is in the store', async () => {
    const ctx = mkCtx({
      userA: [{emoji: '👍', fromPubkey: 'pA'}],
      userB: []
    });
    const r = await noKind7SelfEchoDrop.check(ctx, {
      name: 'reactToRandomBubble', args: {user: 'userA', emoji: '👍'}
    });
    expect(r.ok).toBe(true);
  });

  it('fails when own emoji missing', async () => {
    const ctx = mkCtx({
      userA: [{emoji: '❤️', fromPubkey: 'pA'}],
      userB: []
    });
    const r = await noKind7SelfEchoDrop.check(ctx, {
      name: 'reactToRandomBubble', args: {user: 'userA', emoji: '👍'}
    });
    expect(r.ok).toBe(false);
  });
});

describe('INV-reaction-author-check', () => {
  it('fails on malformed reactionEventId', async () => {
    const ctx = mkCtx({
      userA: [{emoji: '👍', fromPubkey: 'pA', reactionEventId: 'not-hex'}],
      userB: []
    });
    const r = await reactionAuthorCheck.check(ctx);
    expect(r.ok).toBe(false);
  });

  it('passes on well-formed reactionEventId (64 hex)', async () => {
    const ctx = mkCtx({
      userA: [{emoji: '👍', fromPubkey: 'pA', reactionEventId: 'a'.repeat(64)}],
      userB: []
    });
    const r = await reactionAuthorCheck.check(ctx);
    expect(r.ok).toBe(true);
  });
});
