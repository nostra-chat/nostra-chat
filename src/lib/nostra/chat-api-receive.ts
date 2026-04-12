/**
 * chat-api-receive.ts
 *
 * Handles incoming relay messages: delete notifications, group routing,
 * self-echo handling (multi-device), unknown sender auto-add, message
 * parsing, dedup, store persistence, and delivery receipts.
 *
 * Extracted from ChatAPI.handleRelayMessage for testability.
 * Each step is a pure function that can be unit tested.
 */

import {DecryptedMessage} from './nostr-relay';
import {getMessageStore, StoredMessage} from './message-store';
import {getMessageRequestStore} from './message-requests';
import {isControlEvent, getGroupIdFromRumor} from './group-control-messages';
import type {ChatMessage, ChatMessageType} from './chat-api';
import rootScope from '@lib/rootScope';

/** Context injected by ChatAPI for receive handler */
export interface ReceiveContext {
  ownId: string;
  history: ChatMessage[];
  activePeer: string | null;
  deliveryTracker: {
    sendDeliveryReceipt(eventId: string, sender: string): Promise<void>;
  } | null;
  offlineQueue: {acknowledge(id: string): void} | null;
  onMessage: ((msg: ChatMessage) => void) | null;
  log: {
    (...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
  };
}

/** Result of processing a relay message */
export type ReceiveResult =
  | {action: 'skipped'; reason: string}
  | {action: 'deleted'; conversationId: string}
  | {action: 'routed_group'; groupId: string}
  | {action: 'routed_control'}
  | {action: 'echo_skipped'; id: string}
  | {action: 'echo_saved'; id: string}
  | {action: 'duplicate'; id: string}
  | {action: 'received'; message: ChatMessage};

// ─── Step functions (testable individually) ────────────────────

/** Check if the message is a delete notification */
export function isDeleteNotification(content: string): {eventIds: string[]} | null {
  try {
    const parsed = JSON.parse(content);
    if(parsed.type === 'delete-notification' && Array.isArray(parsed.eventIds)) {
      return {eventIds: parsed.eventIds};
    }
  } catch{
    // Not JSON
  }
  return null;
}

/** Parse message content — handles JSON and plaintext */
export function parseMessageContent(content: string): {id?: string; content: string; type?: string} {
  try {
    const parsed = JSON.parse(content);
    return {
      id: parsed.id,
      content: parsed.content || content,
      type: parsed.type
    };
  } catch{
    return {content, type: 'text'};
  }
}

/** Extract file metadata from kind 15 rumor */
export function extractFileMetadata(
  parsed: any,
  rumorKind?: number
): ChatMessage['fileMetadata'] | undefined {
  if(rumorKind !== 15) return undefined;
  try {
    const fileParsed = typeof parsed.content === 'string' ? JSON.parse(parsed.content) : parsed;
    if(fileParsed.url && fileParsed.sha256) {
      return {
        url: fileParsed.url,
        sha256: fileParsed.sha256,
        mimeType: fileParsed.mimeType || 'application/octet-stream',
        size: fileParsed.size || 0,
        width: fileParsed.width,
        height: fileParsed.height,
        keyHex: fileParsed.key || fileParsed.keyHex || '',
        ivHex: fileParsed.iv || fileParsed.ivHex || ''
      };
    }
  } catch{
    // Failed to parse file metadata
  }
  return undefined;
}

/** Check if message is a duplicate in history */
export function isDuplicate(history: ChatMessage[], msg: DecryptedMessage, chatId: string): boolean {
  return history.some(m => m.relayEventId === msg.id) ||
    history.some(m => m.id === chatId);
}

// ─── Main handler ──────────────────────────────────────────────

/**
 * Process an incoming relay message.
 * Returns a result describing what happened (for logging/testing).
 */
export async function handleRelayMessage(
  msg: DecryptedMessage,
  ctx: ReceiveContext
): Promise<ReceiveResult> {
  // 1. Check for delete notification
  const deleteNotif = isDeleteNotification(msg.content);
  if(deleteNotif) {
    const store = getMessageStore();
    const conversationId = store.getConversationId(ctx.ownId, msg.from);
    await store.deleteMessages(conversationId, deleteNotif.eventIds);
    return {action: 'deleted', conversationId};
  }

  // 2. Check if sender is blocked
  const requestStore = getMessageRequestStore();
  const isBlocked = await requestStore.isBlocked(msg.from).catch(() => false);
  if(isBlocked) {
    return {action: 'skipped', reason: 'blocked'};
  }

  // 3. Group message routing
  try {
    const rumorLike = {
      id: msg.id,
      kind: msg.rumorKind || 14,
      content: msg.content,
      pubkey: msg.from,
      created_at: msg.timestamp,
      tags: msg.tags || []
    };

    if(isControlEvent(rumorLike)) {
      try {
        const {getGroupAPI} = await import('./group-api');
        getGroupAPI().handleControlMessage(rumorLike, msg.from);
      } catch{
        // GroupAPI not initialized
      }
      return {action: 'routed_control'};
    }

    const groupId = getGroupIdFromRumor(rumorLike);
    if(groupId) {
      try {
        const {getGroupAPI} = await import('./group-api');
        getGroupAPI().handleIncomingGroupMessage(groupId, rumorLike, msg.from);
      } catch{
        // GroupAPI not initialized
      }
      return {action: 'routed_group', groupId};
    }
  } catch{
    // Routing check failed — continue with 1:1 handling
  }

  // 4. Self-echo handling (multi-device)
  if(msg.from === ctx.ownId) {
    return handleSelfEcho(msg, ctx);
  }

  // 5. Auto-add unknown senders
  const isKnown = await requestStore.isKnownContact(msg.from).catch(() => true);
  if(!isKnown && msg.from !== ctx.ownId) {
    ctx.log('[ChatAPI] auto-adding unknown sender:', msg.from.slice(0, 8) + '...');
    try {
      const {NostraBridge} = await import('./nostra-bridge');
      const bridge = NostraBridge.getInstance();
      const peerId = await bridge.mapPubkeyToPeerId(msg.from);
      await bridge.storePeerMapping(msg.from, peerId);
    } catch(err) {
      ctx.log.warn('[ChatAPI] failed to auto-add unknown sender:', err);
    }

    let firstMsg = msg.content;
    try {
      const p = JSON.parse(msg.content);
      firstMsg = p.content || msg.content;
    } catch{
      // plaintext
    }
    requestStore.addRequest(msg.from, firstMsg, msg.timestamp).catch((e) => console.debug('[ChatAPI] addRequest failed:', e?.message));
    rootScope.dispatchEvent('nostra_message_request', {pubkey: msg.from, firstMessage: firstMsg});
  }

  // 6. Parse content
  const parsed = parseMessageContent(msg.content);
  let msgType: ChatMessageType = (parsed.type || 'text') as ChatMessageType;
  const fileMetadata = extractFileMetadata(parsed, msg.rumorKind);
  if(fileMetadata) msgType = 'file';

  const chatMessage: ChatMessage = {
    id: parsed.id || msg.id,
    from: msg.from,
    to: ctx.ownId,
    type: msgType,
    content: parsed.content,
    timestamp: msg.timestamp,
    status: 'delivered',
    relayEventId: msg.id,
    fileMetadata
  };

  // 7. Dedup check
  if(isDuplicate(ctx.history, msg, chatMessage.id)) {
    if(ctx.offlineQueue) ctx.offlineQueue.acknowledge(chatMessage.id);
    return {action: 'duplicate', id: chatMessage.id};
  }

  // 8. Acknowledge, add to history, persist
  if(ctx.offlineQueue) ctx.offlineQueue.acknowledge(chatMessage.id);
  ctx.history.push(chatMessage);

  try {
    const store = getMessageStore();
    const conversationId = store.getConversationId(ctx.ownId, msg.from);
    store.saveMessage({
      eventId: msg.id,
      appMessageId: chatMessage.id,
      conversationId,
      senderPubkey: msg.from,
      content: chatMessage.content,
      type: msgType === 'text' ? 'text' : 'file',
      timestamp: msg.timestamp,
      deliveryState: 'delivered',
      fileMetadata: fileMetadata ? {
        url: fileMetadata.url,
        sha256: fileMetadata.sha256,
        mimeType: fileMetadata.mimeType,
        size: fileMetadata.size,
        width: fileMetadata.width,
        height: fileMetadata.height,
        keyHex: fileMetadata.keyHex,
        ivHex: fileMetadata.ivHex
      } : undefined
    }).catch((err) => {
      ctx.log.warn('[ChatAPI] failed to save incoming message:', err);
    });
  } catch(err) {
    ctx.log.warn('[ChatAPI] message store error:', err);
  }

  // 9. Send delivery receipt
  if(ctx.deliveryTracker && msg.from !== ctx.ownId) {
    ctx.deliveryTracker.sendDeliveryReceipt(chatMessage.id, msg.from).catch((err) => {
      ctx.log.warn('[ChatAPI] delivery receipt failed:', err);
    });
  }

  // 10. Notify callback
  if(ctx.onMessage) {
    ctx.onMessage(chatMessage);
  }

  return {action: 'received', message: chatMessage};
}

/** Handle self-echo (own message returning from relay) */
async function handleSelfEcho(
  msg: DecryptedMessage,
  ctx: ReceiveContext
): Promise<ReceiveResult> {
  let echoId = msg.id;
  try {
    const parsed = JSON.parse(msg.content);
    if(parsed.id) echoId = parsed.id;
  } catch{ /* not JSON */ }

  const store = getMessageStore();
  const existing = await store.getByEventId(echoId);
  if(existing) {
    return {action: 'echo_skipped', id: echoId};
  }

  // Cross-device: not in our store — save as outgoing
  const pTag = msg.tags?.find((t) => t[0] === 'p');
  const peerPubkey = pTag?.[1] || '';
  if(!peerPubkey) {
    return {action: 'skipped', reason: 'own echo no recipient'};
  }

  const conversationId = store.getConversationId(ctx.ownId, peerPubkey);
  const parsed = parseMessageContent(msg.content);

  await store.saveMessage({
    eventId: echoId,
    conversationId,
    senderPubkey: ctx.ownId,
    content: parsed.content,
    type: 'text',
    timestamp: msg.timestamp,
    deliveryState: 'sent',
    isOutgoing: true
  });

  if(ctx.onMessage) {
    ctx.onMessage({
      id: echoId,
      from: ctx.ownId,
      to: peerPubkey,
      type: 'text',
      content: parsed.content,
      timestamp: msg.timestamp,
      status: 'sent',
      relayEventId: msg.id,
      isOutgoing: true
    } as any);
  }

  return {action: 'echo_saved', id: echoId};
}
