/**
 * nostra-message-handler.ts
 *
 * Pure handler for incoming Nostr messages (nostra_new_message events).
 * Builds tweb-native Message/Dialog objects and injects them into mirrors.
 * Extracted from nostra-onboarding-integration.ts for testability.
 */

import {NostraPeerMapper} from '@lib/nostra/nostra-peer-mapper';
import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '@lib/rootScope';

export interface IncomingMessageData {
  senderPubkey: string;
  peerId: number;
  mid: number;
  timestamp: number;
  message: {content: string};
}

export interface HandleMessageResult {
  msg: any;
  peerId: number;
  dialog: any;
  isNewPeer: boolean;
}

/**
 * Build a tweb Message from incoming Nostr event data.
 * Pure function — no side effects.
 */
export function buildTwebMessage(data: IncomingMessageData): any {
  const mapper = new NostraPeerMapper();
  return mapper.createTwebMessage({
    mid: data.mid,
    peerId: data.peerId,
    fromPeerId: data.peerId,
    date: data.timestamp,
    text: data.message.content,
    isOutgoing: false
  });
}

/**
 * Build a tweb Dialog for the incoming message.
 * Attaches msg object as topMessage so setLastMessage can use it directly
 * without getMessageByPeer lookup (which fails when hasReachedTheEnd is false).
 */
export function buildTwebDialog(peerId: number, msg: any, timestamp: number): any {
  const mapper = new NostraPeerMapper();
  const dialog = mapper.createTwebDialog({
    peerId,
    topMessage: msg.mid || msg.id,
    topMessageDate: msg.date || timestamp,
    unreadCount: 1
  });
  (dialog as any).topMessage = msg;
  return dialog;
}

/**
 * Inject message into main-thread mirrors (messages + peers).
 * Does NOT call Worker's saveMessages/getHistory — that pollutes the history cache.
 */
export async function injectIntoMirrors(
  peerId: number,
  msg: any,
  senderPubkey: string
): Promise<{isNewPeer: boolean}> {
  let isNewPeer = false;
  const proxy = MOUNT_CLASS_TO.apiManagerProxy;

  if(proxy?.mirrors?.messages) {
    const storageKey = `${peerId}_history`;
    if(!proxy.mirrors.messages[storageKey]) proxy.mirrors.messages[storageKey] = {};
    proxy.mirrors.messages[storageKey][msg.mid || msg.id] = msg;
  }

  // Push into Worker's history storage for subsequent getHistory calls
  try {
    const storageKey = `${peerId}_history` as any;
    await rootScope.managers.appMessagesManager.setMessageToStorage(storageKey, msg);
  } catch(e: any) { console.debug('[MessageHandler] non-critical:', e?.message); }

  // Auto-add unknown sender as a peer in mirrors
  if(proxy?.mirrors?.peers && !proxy.mirrors.peers[peerId]) {
    isNewPeer = true;
    const mapper = new NostraPeerMapper();
    const displayName = 'npub...' + senderPubkey.slice(0, 8);
    const user = mapper.createTwebUser({peerId, firstName: displayName, pubkey: senderPubkey});
    proxy.mirrors.peers[peerId] = user;

    try {
      const {reconcilePeer} = await import('@stores/peers');
      reconcilePeer(peerId, user);
    } catch(e: any) { console.debug('[MessageHandler] non-critical:', e?.message); }

    try {
      const {NostraBridge} = await import('@lib/nostra/nostra-bridge');
      const bridge = NostraBridge.getInstance();
      const avatar = bridge.deriveAvatarFromPubkeySync(senderPubkey);
      await rootScope.managers.appUsersManager.injectP2PUser(senderPubkey, peerId, displayName, avatar);
    } catch(e: any) { console.debug('[MessageHandler] non-critical:', e?.message); }
  }

  return {isNewPeer};
}

/**
 * Dispatch dialog update to chat list. Fires twice:
 * - First dispatch adds the dialog via sortedList.add (returns early, skips setLastMessageN)
 * - Second dispatch (after 500ms) hits the existing-dialog branch for preview text
 */
export function dispatchDialogUpdate(peerId: number, dialog: any): void {
  const dispatchFn = () => {
    rootScope.dispatchEvent('dialogs_multiupdate' as any, new Map([[
      peerId.toPeerId ? (peerId as any).toPeerId(false) : peerId,
      {dialog}
    ]]));
  };
  dispatchFn();
  setTimeout(dispatchFn, 500);
}

/**
 * Invalidate Worker's history cache for a peer.
 * Without this, reopened chats return stale SliceEnd.Both data.
 */
export async function invalidateHistoryCache(peerId: number): Promise<void> {
  try {
    await rootScope.managers.appMessagesManager.invalidateHistoryCache(peerId);
  } catch(e: any) { console.debug('[MessageHandler] invalidateHistoryCache:', e?.message); }
}

export interface IncomingEditData {
  peerId: number;
  mid: number;
  senderPubkey: string;
  originalEventId: string;
  newContent: string;
  editedAt: number;
}

/**
 * Apply an incoming edit to a tweb message in the main-thread mirrors and
 * notify bubbles.ts via the existing tweb `message_edit` event so the bubble
 * re-renders with the new text + "edited" marker.
 *
 * No-op for self edits — the local edit path already updated the bubble.
 */
export async function handleIncomingEdit(data: IncomingEditData, ownPubkey: string): Promise<void> {
  if(data.senderPubkey === ownPubkey) return;

  const proxy = MOUNT_CLASS_TO.apiManagerProxy;
  const storageKey = `${data.peerId}_history`;

  const existing = proxy?.mirrors?.messages?.[storageKey]?.[data.mid];
  if(existing) {
    existing.message = data.newContent;
    existing.edit_date = data.editedAt;
  }

  // Tell the Worker to update its own storage so subsequent getHistory calls
  // return the edited content.
  try {
    await rootScope.managers.appMessagesManager.setMessageToStorage(storageKey as any, {
      ...(existing || {}),
      mid: data.mid,
      peerId: data.peerId,
      message: data.newContent,
      edit_date: data.editedAt
    });
  } catch(e: any) { console.debug('[MessageHandler] edit setMessageToStorage:', e?.message); }

  rootScope.dispatchEvent('message_edit' as any, {
    storageKey,
    peerId: data.peerId,
    mid: data.mid,
    message: existing || {mid: data.mid, peerId: data.peerId, message: data.newContent, edit_date: data.editedAt}
  });
}

/**
 * Full incoming message handler — orchestrates build, inject, dispatch.
 * Returns result for pending-message tracking.
 */
export async function handleIncomingMessage(
  data: IncomingMessageData,
  ownPubkey: string
): Promise<HandleMessageResult | null> {
  // Skip own echoes — already handled by Worker's sendText flow
  if(data.senderPubkey === ownPubkey) return null;

  const msg = buildTwebMessage(data);
  const peerId = data.peerId;

  const {isNewPeer} = await injectIntoMirrors(peerId, msg, data.senderPubkey);
  await invalidateHistoryCache(peerId);

  // Dispatch history_append for real-time bubble rendering (when chat is open).
  // bubbles.ts deduplicates by fullMid — if getHistory already loaded this
  // message, the duplicate append is silently skipped.
  rootScope.dispatchEvent('history_append' as any, {
    storageKey: `${peerId}_history`,
    message: msg,
    peerId
  });

  const dialog = buildTwebDialog(peerId, msg, data.timestamp);
  dispatchDialogUpdate(peerId, dialog);

  return {msg, peerId, dialog, isNewPeer};
}
