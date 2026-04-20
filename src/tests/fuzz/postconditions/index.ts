// @ts-nocheck
import type {Postcondition, Action, FuzzContext, FailureDetails} from '../types';
import {
  POST_sendText_bubble_appears,
  POST_sendText_input_cleared,
  POST_edit_preserves_mid,
  POST_edit_content_updated,
  POST_delete_local_bubble_gone,
  POST_react_emoji_appears,
  POST_react_peer_sees_emoji,
  POST_remove_reaction_peer_disappears,
  POST_react_multi_emoji_separate
} from './messaging';

export const POSTCONDITIONS: Record<string, Postcondition[]> = {
  sendText: [POST_sendText_bubble_appears, POST_sendText_input_cleared],
  replyToRandomBubble: [POST_sendText_bubble_appears],
  editRandomOwnBubble: [POST_edit_preserves_mid, POST_edit_content_updated],
  deleteRandomOwnBubble: [POST_delete_local_bubble_gone],
  reactToRandomBubble: [POST_react_emoji_appears, POST_react_peer_sees_emoji],
  removeReaction: [POST_remove_reaction_peer_disappears],
  reactMultipleEmoji: [POST_react_multi_emoji_separate]
};

export async function runPostconditions(
  ctx: FuzzContext,
  action: Action
): Promise<FailureDetails | null> {
  const list = POSTCONDITIONS[action.name] || [];
  for(const p of list) {
    const r = await p.check(ctx, action);
    if(!r.ok) {
      return {
        invariantId: p.id,
        tier: 'postcondition',
        message: r.message || 'postcondition failed',
        evidence: r.evidence,
        action
      };
    }
  }
  return null;
}
