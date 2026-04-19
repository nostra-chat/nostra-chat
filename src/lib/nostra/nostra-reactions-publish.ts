/**
 * NIP-25 publisher — kind-7 (reaction) + kind-5 (delete for remove).
 *
 * The module is a thin orchestrator: ChatAPI signs & fans out, store
 * persists. Consumers (appReactionsManager P2P shortcut, fuzz actions)
 * invoke publish()/unpublish() synchronously vs the UI update — the UI
 * reads the store, not the network.
 */
import rootScope from '@lib/rootScope';
import {nostraReactionsStore} from './nostra-reactions-store';

export interface PublishArgs {
  targetEventId: string;
  targetMid: number;
  targetPeerId: number;
  targetAuthor: string;
  emoji: string;
}

interface ChatAPILike {
  publishEvent(unsigned: {kind: number; created_at: number; tags: string[][]; content: string}): Promise<{id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string}>;
  ownId: string;
}

let chatAPI: ChatAPILike | null = null;

export function setChatAPI(c: ChatAPILike) {
  chatAPI = c;
}

class NostraReactionsPublish {
  async publish(args: PublishArgs): Promise<string> {
    if(!chatAPI) throw new Error('[nostra-reactions-publish] ChatAPI not wired — call setChatAPI first');
    const unsigned = {
      kind: 7,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', args.targetEventId],
        ['p', args.targetAuthor]
      ],
      content: args.emoji
    };
    const signed = await chatAPI.publishEvent(unsigned);
    const reactionEventId = signed?.id;
    if(!reactionEventId) throw new Error('[nostra-reactions-publish] published event has no id');
    await nostraReactionsStore.add({
      targetEventId: args.targetEventId,
      targetMid: args.targetMid,
      targetPeerId: args.targetPeerId,
      fromPubkey: chatAPI.ownId,
      emoji: args.emoji,
      reactionEventId,
      createdAt: unsigned.created_at
    });
    rootScope.dispatchEventSingle('nostra_reactions_changed', {
      peerId: args.targetPeerId,
      mid: args.targetMid
    });
    return reactionEventId;
  }

  async unpublish(reactionEventId: string): Promise<void> {
    if(!chatAPI) throw new Error('[nostra-reactions-publish] ChatAPI not wired');
    const rows = await nostraReactionsStore.getAll();
    const row = rows.find((r) => r.reactionEventId === reactionEventId);
    if(!row) return;
    const unsigned = {
      kind: 5,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', reactionEventId]],
      content: ''
    };
    await chatAPI.publishEvent(unsigned);
    await nostraReactionsStore.removeByReactionEventId(reactionEventId);
    rootScope.dispatchEventSingle('nostra_reactions_changed', {
      peerId: row.targetPeerId,
      mid: row.targetMid
    });
  }
}

export const nostraReactionsPublish = new NostraReactionsPublish();

if(typeof window !== 'undefined') {
  (window as any).__nostraReactionsPublish = nostraReactionsPublish;
}
