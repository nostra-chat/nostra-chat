/**
 * NostraGroupsSync
 *
 * Bridges GroupAPI ↔ display pipeline. Installs two callbacks on the
 * GroupAPI singleton:
 *
 *   - `onGroupMessage(groupId, rumor, senderPubkey)` — fired when an
 *     incoming gift-wrapped group message passes the sender/dedup checks
 *     in GroupAPI.handleIncomingGroupMessage. Persists the message to the
 *     IndexedDB message-store and dispatches `nostra_new_message` so the
 *     existing bubble-render pipeline (bubbles.ts listens) renders it.
 *
 *   - `onOutgoingMessage({groupId, messageId, rumorId, …})` — fired
 *     synchronously from GroupAPI.sendMessage AFTER the wraps are built
 *     but BEFORE the relay publish completes. Persists the sender's own
 *     row with `isOutgoing: true` and dispatches the same ui event so
 *     the bubble appears immediately (parallel to the optimistic render
 *     path for DMs in appMessagesManager.sendText).
 *
 * Before this module existed, `GroupAPI.onGroupMessage` was declared on
 * the class but never assigned anywhere — group messages reached
 * handleIncomingGroupMessage via chat-api-receive routing but were
 * silently dropped. FIND-dbe8fdd2 (POST-sendInGroup-bubble-on-sender)
 * documented this bug.
 *
 * Call `initGroupsSync(ownPubkey, dispatch)` once GroupAPI has been
 * initialized. Safe to call again — idempotent overwrite of the callbacks.
 */

import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';
import {groupIdToPeerId} from './group-types';

const LOG_PREFIX = '[NostraGroupsSync]';

type DispatchFn = (event: string, data: any) => void;

interface ParsedGroupRumor {
  content: string;
  type: string;
  messageId: string;
  timestamp: number;
}

function parseGroupRumorContent(raw: string): ParsedGroupRumor | null {
  try {
    const parsed = JSON.parse(raw);
    if(typeof parsed !== 'object' || parsed === null) return null;
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    const type = typeof parsed.type === 'string' ? parsed.type : 'text';
    const messageId = typeof parsed.id === 'string' ? parsed.id : '';
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
    if(!messageId) return null;
    return {content, type, messageId, timestamp};
  } catch{
    return null;
  }
}

export function initGroupsSync(ownPubkey: string, dispatch: DispatchFn): void {
  const mapper = new NostraPeerMapper();
  const store = getMessageStore();
  // Read the GroupAPI instance from window to avoid module-instance mismatch
  // in Vite dev where relative vs aliased imports can resolve to different
  // modules — callbacks set on a different instance would never fire.
  const api = typeof window !== 'undefined' ? (window as any).__nostraGroupAPI : null;
  if(!api) {
    console.warn(LOG_PREFIX, 'GroupAPI instance missing on window; bridge not wired');
    return;
  }

  // ─── Receive path ─────────────────────────────────────────────────
  api.onGroupMessage = async(groupId: string, rumor: any, senderPubkey: string) => {
    const parsed = parseGroupRumorContent(rumor.content);
    if(!parsed) {
      console.warn(LOG_PREFIX, 'received group rumor with unparseable content; dropping', {groupId, rumorId: rumor?.id});
      return;
    }

    const {content, type, messageId, timestamp: appTsMs} = parsed;
    const rumorId: string = rumor.id;
    // rumor.created_at is unix seconds; fall back to the payload ms timestamp / 1000.
    const timestampSec = typeof rumor.created_at === 'number' ?
      rumor.created_at :
      Math.floor((appTsMs || Date.now()) / 1000);

    let peerId: number;
    try {
      peerId = await groupIdToPeerId(groupId);
    } catch(err) {
      console.warn(LOG_PREFIX, 'groupIdToPeerId failed; dropping', {groupId, err});
      return;
    }

    const mid = await mapper.mapEventId(rumorId, timestampSec);

    try {
      await store.saveMessage({
        eventId: rumorId,
        appMessageId: messageId,
        conversationId: `group:${groupId}`,
        senderPubkey,
        content,
        type: type === 'text' ? 'text' : 'file',
        timestamp: timestampSec,
        deliveryState: 'delivered',
        mid,
        twebPeerId: peerId,
        isOutgoing: false
      });
    } catch(err) {
      console.warn(LOG_PREFIX, 'saveMessage (incoming) failed; dispatching anyway', {err});
    }

    console.log(LOG_PREFIX, 'dispatching nostra_new_message (rx)', {peerId, mid, groupId: groupId.slice(0, 8)});
    dispatch('nostra_new_message', {
      peerId,
      mid,
      senderPubkey,
      message: {id: messageId, content, type, from: senderPubkey, timestamp: timestampSec, groupId},
      timestamp: timestampSec
    });
  };

  // ─── Send path (optimistic render) ────────────────────────────────
  api.onOutgoingMessage = async(info: {
    groupId: string;
    messageId: string;
    rumorId: string;
    content: string;
    timestamp: number;
    type: string;
  }) => {
    const {groupId, messageId, rumorId, content, timestamp, type} = info;
    const timestampSec = Math.floor((timestamp || Date.now()) / 1000);

    let peerId: number;
    try {
      peerId = await groupIdToPeerId(groupId);
    } catch(err) {
      console.warn(LOG_PREFIX, 'groupIdToPeerId failed on outgoing; skipping', {groupId, err});
      return;
    }

    let mid: number;
    try {
      mid = await mapper.mapEventId(rumorId, timestampSec);
    } catch(err) {
      console.warn(LOG_PREFIX, 'mapEventId failed on outgoing; skipping', {err});
      return;
    }

    try {
      await store.saveMessage({
        eventId: rumorId,
        appMessageId: messageId,
        conversationId: `group:${groupId}`,
        senderPubkey: ownPubkey,
        content,
        type: type === 'text' ? 'text' : 'file',
        timestamp: timestampSec,
        deliveryState: 'sent',
        mid,
        twebPeerId: peerId,
        isOutgoing: true
      });
    } catch(err) {
      console.warn(LOG_PREFIX, 'saveMessage (outgoing) failed; dispatching anyway', {err});
    }

    console.log(LOG_PREFIX, 'dispatching nostra_new_message (tx)', {peerId, mid, groupId: groupId.slice(0, 8)});
    dispatch('nostra_new_message', {
      peerId,
      mid,
      senderPubkey: ownPubkey,
      message: {id: messageId, content, type, from: ownPubkey, timestamp: timestampSec, groupId},
      timestamp: timestampSec
    });
  };

  console.log(LOG_PREFIX, 'initialized — GroupAPI.onGroupMessage + onOutgoingMessage wired');
}
