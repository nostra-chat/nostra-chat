/**
 * NostraGroupsSync
 *
 * Render pipeline for multi-party group messages, mirroring the DM
 * pipeline in `nostra-sync.ts`. Exports two pure functions consumed
 * directly by `GroupAPI`:
 *
 *   - `handleGroupIncoming(ownPubkey, groupId, rumor, senderPubkey, dispatch)`
 *     — persist + render bubbles for group messages received from other
 *     members. Called from `GroupAPI.handleIncomingGroupMessage`.
 *
 *   - `handleGroupOutgoing(ownPubkey, info, dispatch)` — persist + render
 *     the sender-side optimistic bubble. Called from `GroupAPI.sendMessage`
 *     immediately after wrapping. The self-wrap relay echo is dropped by
 *     `GroupAPI.sentMessageIds` dedup, so this is the sole sender-side
 *     render path.
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
 * Prior design used post-hoc callback assignment on the GroupAPI
 * singleton via a separate `initGroupsSync` + `window.__nostraGroupAPI`
 * lookup. That design was brittle under Vite dev module graph
 * duplication — the callback was set on one module instance but read
 * from another — and the callback body never executed. Direct function
 * imports avoid the indirection entirely.
 */

import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';
import {groupIdToPeerId} from './group-types';
import {getGroupStore} from './group-store';
import {ensureSenderUserInjected} from './ensure-sender-user-injected';
import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '@lib/rootScope';

const LOG_PREFIX = '[NostraGroupsSync]';

export type GroupDispatchFn = (event: string, data: any) => void;

export interface GroupOutgoingInfo {
  groupId: string;
  messageId: string;
  rumorId: string;
  content: string;
  timestamp: number;
  type: string;
}

interface ParsedGroupRumor {
  content: string;
  type: string;
  messageId: string;
  timestamp: number;
}

// Shared mapper — IndexedDB-backed (nostra-virtual-peers), so a single
// instance across calls is safe and avoids redundant reads.
let _mapper: NostraPeerMapper | null = null;
function getMapper(): NostraPeerMapper {
  if(!_mapper) _mapper = new NostraPeerMapper();
  return _mapper;
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

/**
 * Ensure the group is materialised as a tweb Chat in the main-thread
 * `mirrors.chats` map and in the Worker-side `appChatsManager.chats[]`.
 * tweb's `setPeer({peerId: -chatId})` reads both to resolve the chat title
 * + avatar; without the entries the bubble container never mounts even
 * though the message is in `mirrors.messages[]`.
 *
 * Idempotent — safe to call on every send/receive.
 */
export async function ensureGroupChatInjected(
  groupId: string,
  groupPeerId: number
): Promise<void> {
  const chatId = Math.abs(groupPeerId);
  const proxy = MOUNT_CLASS_TO.apiManagerProxy as any;
  const alreadyMirrored = !!proxy?.mirrors?.chats?.[chatId];

  // Pull canonical group state so the chat title + member count match the
  // store. If the store read fails (HMR race, etc.), fall back to a minimal
  // entry — still enough for setPeer to mount.
  let groupName = 'Group';
  let memberCount = 1;
  let createdAt = Math.floor(Date.now() / 1000);
  try {
    const rec = await getGroupStore().get(groupId);
    if(rec) {
      groupName = rec.name || groupName;
      memberCount = Array.isArray(rec.members) ? rec.members.length : memberCount;
      createdAt = Math.floor((rec.createdAt || Date.now()) / 1000);
    }
  } catch(e: any) {
    console.debug(LOG_PREFIX, 'ensureGroupChatInjected: group store read failed:', e?.message);
  }

  const mapper = getMapper();
  const chat = mapper.createTwebChat({
    chatId,
    title: groupName,
    membersCount: memberCount,
    date: createdAt
  });

  if(proxy?.mirrors) {
    if(!proxy.mirrors.chats) proxy.mirrors.chats = {};
    proxy.mirrors.chats[chatId] = chat;
  }

  try {
    // saveApiChat seeds Worker-side appChatsManager.chats[] so peer lookups
    // + avatar derivation succeed on the Worker side too.
    await rootScope.managers.appChatsManager.saveApiChat(chat as any);
  } catch(e: any) {
    console.debug(LOG_PREFIX, 'ensureGroupChatInjected: saveApiChat non-critical:', e?.message);
  }

  if(!alreadyMirrored) {
    // Notify stores so <ChatList> and <TopBar> observe the new chat title.
    try {
      const {reconcilePeer} = await import('@stores/peers');
      const asPeerId = (chat as any).id ? (-chatId) as unknown as any : groupPeerId;
      reconcilePeer(asPeerId, chat as any);
    } catch(e: any) {
      console.debug(LOG_PREFIX, 'ensureGroupChatInjected: reconcilePeer non-critical:', e?.message);
    }
  }
}

/**
 * Render-side counterpart to `writeGroupCreateServiceMessage`: materialise
 * the group in main-thread mirrors (so `getPeer(-chatId)` resolves) and
 * dispatch `dialogs_multiupdate` TWICE so the chat list gains a row with
 * a valid `top_message` pointing at the service "group created" row.
 *
 * Called at group-creation time on BOTH sides (creator in `createGroup`,
 * receivers in `handleGroupCreate`). Without this, the group appears in
 * the chat list only after the first real message is sent or received.
 *
 * Idempotent — `ensureGroupChatInjected` + `dialogs_multiupdate` are both
 * upsert-shaped.
 */
export async function injectGroupCreateDialog(
  groupId: string,
  serviceMid: number,
  timestampSec: number
): Promise<void> {
  let groupPeerId: number;
  try {
    groupPeerId = await groupIdToPeerId(groupId);
  } catch(err) {
    console.warn(LOG_PREFIX, 'create-dialog: groupIdToPeerId failed; skipping', {groupId, err});
    return;
  }

  await ensureGroupChatInjected(groupId, groupPeerId);

  const mapper = getMapper();
  const dialog = mapper.createTwebDialog({
    peerId: groupPeerId,
    topMessage: serviceMid,
    topMessageDate: timestampSec,
    unreadCount: 0
  });
  dispatchGroupDialogUpdate(groupPeerId, dialog);
}

/**
 * Symmetric cleanup for `ensureGroupChatInjected` — invoked when this user
 * leaves or is removed from a group. Without this, `GroupAPI.leaveGroup` /
 * `handleRemoveMember` delete the group record from `group-store` but leave
 * the Chat entry behind in `apiManagerProxy.mirrors.peers` and
 * `mirrors.chats`. That orphan is what INV-group-no-orphan-mirror-peer
 * detects: a group peerId present in `mirrors.peers` with no backing
 * `group-store` record.
 *
 * Keeping the orphan around also causes UX drift: the chat list resolver
 * still sees a valid Chat object for the peer and the "left" group can
 * briefly re-render on chat-list refresh until the user reloads. Symmetric
 * cleanup makes leave idempotent with create.
 *
 * Idempotent — safe to call even when no injection was ever performed.
 */
export async function cleanupGroupChatInjection(groupPeerId: number): Promise<void> {
  const chatId = Math.abs(groupPeerId);
  const proxy = MOUNT_CLASS_TO.apiManagerProxy as any;
  if(proxy?.mirrors?.peers) delete proxy.mirrors.peers[groupPeerId];
  if(proxy?.mirrors?.chats) delete proxy.mirrors.chats[chatId];
}

/**
 * Render + persist an incoming group message. Called by
 * `GroupAPI.handleIncomingGroupMessage` after dedup.
 */
export async function handleGroupIncoming(
  ownPubkey: string,
  groupId: string,
  rumor: any,
  senderPubkey: string,
  dispatch: GroupDispatchFn
): Promise<void> {
  const mapper = getMapper();
  const store = getMessageStore();

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

  // Ensure the Chat entry exists before any bubble/dialog dispatch — without
  // this, tweb's peer resolution returns undefined and the chat never mounts.
  await ensureGroupChatInjected(groupId, groupPeerId);

  const mid = await mapper.mapEventId(rumorId, timestampSec);
  const senderPeerId = await mapper.mapPubkey(senderPubkey);

  // Own-pubkey echoes from the relay subscription must keep
  // `isOutgoing: true` — otherwise the upsert merge in message-store
  // overwrites the prior write from `handleGroupOutgoing` and the bubble
  // flips to the left after reload (the in-memory `sentMessageIds` dedup
  // resets on each boot, so post-reload re-subscriptions re-deliver own
  // events). Mirrors the DM design: same-device echo is a no-op merge,
  // cross-device own message persists as outgoing.
  const isOutgoing = senderPubkey === ownPubkey;

  // Without a User entry for the sender, getPeer(senderPeerId) returns
  // undefined and the bubble title falls back to "Deleted Account"
  // (getPeerTitle.ts + lang.ts 'HiddenName'). Idempotent — re-run is cheap.
  try {
    await ensureSenderUserInjected({
      senderPubkey,
      peerId: senderPeerId,
      logPrefix: LOG_PREFIX + ' rx'
    });
  } catch(err) {
    console.warn(LOG_PREFIX, 'rx: ensureSenderUserInjected failed; continuing', {err});
  }

  try {
    await store.saveMessage({
      eventId: rumorId,
      appMessageId: messageId,
      conversationId: `group:${groupId}`,
      senderPubkey,
      content,
      type: type === 'text' ? 'text' : 'file',
      timestamp: timestampSec,
      deliveryState: isOutgoing ? 'sent' : 'delivered',
      mid,
      twebPeerId: groupPeerId,
      isOutgoing
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
    isOutgoing
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

  console.log(LOG_PREFIX, 'rx rendered', {groupPeerId, mid, groupId: groupId.slice(0, 8)});
  dispatch('nostra_new_message', {
    peerId: groupPeerId,
    mid,
    senderPubkey,
    message: {id: messageId, content, type, from: senderPubkey, timestamp: timestampSec, groupId},
    timestamp: timestampSec
  });

  // Reference ownPubkey to silence unused-param warning — kept in signature
  // for future delivery-tracker wiring (mark sender-self-echoes read, etc).
  void ownPubkey;
}

/**
 * Render + persist the sender-side optimistic bubble for an outgoing
 * group message. Called by `GroupAPI.sendMessage` immediately after
 * wrapping, before the relay publish completes.
 */
export async function handleGroupOutgoing(
  ownPubkey: string,
  info: GroupOutgoingInfo,
  dispatch: GroupDispatchFn
): Promise<void> {
  const mapper = getMapper();
  const store = getMessageStore();

  const {groupId, messageId, rumorId, content, timestamp, type} = info;
  const timestampSec = Math.floor((timestamp || Date.now()) / 1000);

  let groupPeerId: number;
  try {
    groupPeerId = await groupIdToPeerId(groupId);
  } catch(err) {
    console.warn(LOG_PREFIX, 'tx: groupIdToPeerId failed; skipping', {groupId, err});
    return;
  }

  // Ensure the Chat entry exists before any bubble/dialog dispatch — without
  // this, tweb's peer resolution returns undefined and the chat never mounts.
  await ensureGroupChatInjected(groupId, groupPeerId);

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

  // Resolve own peerId so the bubble + dialog preview attribute the
  // message to the user instead of falling back to the group peer
  // (which would render "<group name>: text" in the chat list).
  let ownPeerId: number | undefined;
  try {
    ownPeerId = await mapper.mapPubkey(ownPubkey);
    await ensureSenderUserInjected({
      senderPubkey: ownPubkey,
      peerId: ownPeerId,
      logPrefix: LOG_PREFIX + ' tx-self'
    });
  } catch(err) {
    console.warn(LOG_PREFIX, 'tx: ensureSenderUserInjected (self) failed; continuing', {err});
  }

  const msg = mapper.createTwebMessage({
    mid,
    peerId: groupPeerId,
    fromPeerId: ownPeerId,
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
}
