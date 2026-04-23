/**
 * NostraGroupsSync
 *
 * Bridges GroupAPI ↔ display pipeline for multi-party group messages.
 * Installs two callbacks on the GroupAPI singleton:
 *
 *   - `onGroupMessage(groupId, rumor, senderPubkey)` — incoming group
 *     messages from other members. Persists + renders the bubble on the
 *     receiver side.
 *
 *   - `onOutgoingMessage({groupId, messageId, rumorId, …})` — own sends.
 *     Persists + renders the sender-side optimistic bubble. The self-wrap
 *     relay echo is dropped by GroupAPI.sentMessageIds dedup, so this
 *     callback is the sole sender-side render path.
 *
 * Render pipeline (both paths):
 *   1. Persist to IndexedDB message-store (keyed by eventId = rumor id).
 *   2. Build a tweb Message via NostraPeerMapper (peerId = group peerId,
 *      fromPeerId = sender's user peerId).
 *   3. Write to `apiManagerProxy.mirrors.messages[<groupPeerId>_history][mid]`.
 *   4. Push to Worker storage via `appMessagesManager.setMessageToStorage`.
 *   5. `invalidateHistoryCache(groupPeerId)` so reopen-chat refetches.
 *   6. Dispatch `history_append` for live render when chat is open.
 *   7. Build tweb Dialog, dispatch `dialogs_multiupdate` TWICE (required
 *      by the two-dispatch rule for synthetic dialogs).
 *
 * Before this module existed, `GroupAPI.onGroupMessage` was declared on
 * the class but never assigned anywhere — group messages reached
 * `handleIncomingGroupMessage` but were silently dropped. FIND-dbe8fdd2.
 *
 * Call `initGroupsSync(ownPubkey, dispatch)` once GroupAPI has been
 * initialized.
 */

import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';
import {groupIdToPeerId} from './group-types';
import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '@lib/rootScope';

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

async function injectGroupMessageIntoMirrors(
  groupPeerId: number,
  msg: any
): Promise<void> {
  const proxy = MOUNT_CLASS_TO.apiManagerProxy as any;
  if(proxy?.mirrors?.messages) {
    const storageKey = `${groupPeerId}_history`;
    if(!proxy.mirrors.messages[storageKey]) proxy.mirrors.messages[storageKey] = {};
    proxy.mirrors.messages[storageKey][msg.mid || msg.id] = msg;
  }

  try {
    const storageKey = `${groupPeerId}_history` as any;
    await rootScope.managers.appMessagesManager.setMessageToStorage(storageKey, msg);
  } catch(e: any) {
    console.debug(LOG_PREFIX, 'setMessageToStorage non-critical:', e?.message);
  }
}

async function invalidateGroupHistoryCache(groupPeerId: number): Promise<void> {
  try {
    await rootScope.managers.appMessagesManager.invalidateHistoryCache(groupPeerId);
  } catch(e: any) {
    console.debug(LOG_PREFIX, 'invalidateHistoryCache non-critical:', e?.message);
  }
}

function dispatchGroupHistoryAppend(groupPeerId: number, msg: any): void {
  try {
    rootScope.dispatchEvent('history_append' as any, {
      storageKey: `${groupPeerId}_history`,
      message: msg,
      peerId: groupPeerId
    });
  } catch(e: any) {
    console.debug(LOG_PREFIX, 'history_append dispatch non-critical:', e?.message);
  }
}

function dispatchGroupDialogUpdate(groupPeerId: number, dialog: any): void {
  const toPeerId = (Number.prototype as any).toPeerId;
  const asPeerId = toPeerId ? (groupPeerId as any).toPeerId(true) : groupPeerId;
  const dispatchOnce = () => {
    try {
      rootScope.dispatchEvent('dialogs_multiupdate' as any, new Map([[asPeerId, dialog]]));
    } catch(e: any) {
      console.debug(LOG_PREFIX, 'dialogs_multiupdate dispatch non-critical:', e?.message);
    }
  };
  // Two-dispatch rule (see CLAUDE.md): first dispatch adds via sortedList.add,
  // second hits the existing-dialog branch and renders the preview text.
  dispatchOnce();
  setTimeout(dispatchOnce, 500);
}

export function initGroupsSync(ownPubkey: string, dispatch: DispatchFn): void {
  const mapper = new NostraPeerMapper();
  const store = getMessageStore();
  const api = typeof window !== 'undefined' ? (window as any).__nostraGroupAPI : null;
  if(!api) {
    console.warn(LOG_PREFIX, 'GroupAPI instance missing on window; bridge not wired');
    return;
  }

  // ─── Receive path ─────────────────────────────────────────────────
  api.onGroupMessage = async(groupId: string, rumor: any, senderPubkey: string) => {
    const parsed = parseGroupRumorContent(rumor.content);
    if(!parsed) {
      console.warn(LOG_PREFIX, 'rx: rumor content unparseable; dropping', {groupId, rumorId: rumor?.id});
      return;
    }
    const {content, type, messageId, timestamp: appTsMs} = parsed;
    const rumorId: string = rumor.id;
    const timestampSec = typeof rumor.created_at === 'number' ?
      rumor.created_at :
      Math.floor((appTsMs || Date.now()) / 1000);

    let groupPeerId: number;
    try {
      groupPeerId = await groupIdToPeerId(groupId);
    } catch(err) {
      console.warn(LOG_PREFIX, 'rx: groupIdToPeerId failed; dropping', {groupId, err});
      return;
    }

    const mid = await mapper.mapEventId(rumorId, timestampSec);
    const senderPeerId = await mapper.mapPubkey(senderPubkey);

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
        twebPeerId: groupPeerId,
        isOutgoing: false
      });
    } catch(err) {
      console.warn(LOG_PREFIX, 'rx: saveMessage failed; continuing', {err});
    }

    const msg = mapper.createTwebMessage({
      mid,
      peerId: groupPeerId,
      fromPeerId: senderPeerId,
      date: timestampSec,
      text: content,
      isOutgoing: false
    });

    await injectGroupMessageIntoMirrors(groupPeerId, msg);
    await invalidateGroupHistoryCache(groupPeerId);
    dispatchGroupHistoryAppend(groupPeerId, msg);

    const dialog = mapper.createTwebDialog({
      peerId: groupPeerId,
      topMessage: mid,
      topMessageDate: timestampSec,
      unreadCount: 1
    });
    (dialog as any).topMessage = msg;
    dispatchGroupDialogUpdate(groupPeerId, dialog);

    // Also emit nostra_new_message for any downstream listeners (mesh signaling etc).
    console.log(LOG_PREFIX, 'rx rendered', {groupPeerId, mid, groupId: groupId.slice(0, 8)});
    dispatch('nostra_new_message', {
      peerId: groupPeerId,
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

    let groupPeerId: number;
    try {
      groupPeerId = await groupIdToPeerId(groupId);
    } catch(err) {
      console.warn(LOG_PREFIX, 'tx: groupIdToPeerId failed; skipping', {groupId, err});
      return;
    }

    let mid: number;
    try {
      mid = await mapper.mapEventId(rumorId, timestampSec);
    } catch(err) {
      console.warn(LOG_PREFIX, 'tx: mapEventId failed; skipping', {err});
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
        twebPeerId: groupPeerId,
        isOutgoing: true
      });
    } catch(err) {
      console.warn(LOG_PREFIX, 'tx: saveMessage failed; continuing', {err});
    }

    const msg = mapper.createTwebMessage({
      mid,
      peerId: groupPeerId,
      // fromPeerId omitted for outgoing — pFlags.out = true is the signal.
      date: timestampSec,
      text: content,
      isOutgoing: true
    });

    await injectGroupMessageIntoMirrors(groupPeerId, msg);
    await invalidateGroupHistoryCache(groupPeerId);
    dispatchGroupHistoryAppend(groupPeerId, msg);

    const dialog = mapper.createTwebDialog({
      peerId: groupPeerId,
      topMessage: mid,
      topMessageDate: timestampSec,
      unreadCount: 0
    });
    (dialog as any).topMessage = msg;
    dispatchGroupDialogUpdate(groupPeerId, dialog);

    console.log(LOG_PREFIX, 'tx rendered', {groupPeerId, mid, groupId: groupId.slice(0, 8)});
    dispatch('nostra_new_message', {
      peerId: groupPeerId,
      mid,
      senderPubkey: ownPubkey,
      message: {id: messageId, content, type, from: ownPubkey, timestamp: timestampSec, groupId},
      timestamp: timestampSec
    });
  };

  console.log(LOG_PREFIX, 'initialized — GroupAPI.onGroupMessage + onOutgoingMessage wired');
}
