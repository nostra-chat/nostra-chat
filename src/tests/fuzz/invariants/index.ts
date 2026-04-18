// @ts-nocheck
import type {Invariant, InvariantTier, FuzzContext, Action, FailureDetails} from '../types';
import {consoleClean} from './console';
import {noDupMid, bubbleChronological, noAutoPin, sentBubbleVisibleAfterSend} from './bubbles';
import {deliveryUiMatchesTracker} from './delivery';
import {avatarDomMatchesCache} from './avatar';

export const ALL_INVARIANTS: Invariant[] = [
  consoleClean,
  noDupMid,
  bubbleChronological,
  noAutoPin,
  sentBubbleVisibleAfterSend,
  deliveryUiMatchesTracker,
  avatarDomMatchesCache
];

const MEDIUM_EVERY = 10;

export async function runTier(
  tier: InvariantTier,
  ctx: FuzzContext,
  action?: Action
): Promise<FailureDetails | null> {
  if(tier === 'medium' && ctx.actionIndex % MEDIUM_EVERY !== 0) return null;

  for(const inv of ALL_INVARIANTS) {
    if(inv.tier !== tier) continue;
    const result = await inv.check(ctx, action);
    if(!result.ok) {
      return {
        invariantId: inv.id,
        tier: inv.tier,
        message: result.message || 'invariant failed',
        evidence: result.evidence,
        action
      };
    }
  }
  return null;
}
