/**
 * GroupAPI - Group lifecycle operations: create, send, receive, manage members
 *
 * Connects the group data layer (Plan 01) to the messaging and display pipeline.
 * Handles group creation, message send/receive, member management (add/remove/leave),
 * and self-send dedup (Pitfall 7).
 *
 * All outbound messages use wrapGroupMessage (N+1 gift-wraps) and broadcastGroupControl
 * for lifecycle events.
 */

import {Logger, logger} from '@lib/logger';
import {getGroupStore} from './group-store';
import {groupIdToPeerId} from './group-types';
import {wrapGroupMessage} from './nostr-crypto';
import {broadcastGroupControl} from './group-control-messages';
import {writeGroupCreateServiceMessage} from './group-service-messages';
import {GroupDeliveryTracker} from './group-delivery-tracker';
import {handleGroupIncoming, handleGroupOutgoing, cleanupGroupChatInjection, injectGroupCreateDialog, type GroupDispatchFn} from './nostra-groups-sync';
import type {GroupStore} from './group-store';
import type {GroupRecord, GroupControlPayload} from './group-types';
import type {NTNostrEvent} from './nostr-crypto';

// ─── Types ────────────────────────────────────────────────────────

export type GroupMessageCallback = (groupId: string, rumor: any, senderPubkey: string) => void;

/** Result of a successful group send — exposes the pieces VMT needs to
 *  produce a deterministic tweb mid for the Worker's post-send bookkeeping. */
export interface GroupSendResult {
  messageId: string;
  rumorId: string;
  timestampMs: number;
}

// ─── GroupAPI ─────────────────────────────────────────────────────

export class GroupAPI {
  private store: GroupStore;
  private ownPubkey: string;
  private ownSk: Uint8Array;
  private publishFn: (events: NTNostrEvent[]) => Promise<void>;
  private dispatch: GroupDispatchFn;
  private groupDelivery: GroupDeliveryTracker;
  private sentMessageIds: Set<string> = new Set();
  private log: Logger;

  /** Optional test hook for incoming group messages. Production render is
   *  wired via direct import of `handleGroupIncoming`; this callback is only
   *  consulted by unit tests that need to observe dispatch without spinning
   *  up the full IndexedDB + rootScope pipeline. */
  onGroupMessage: GroupMessageCallback | null = null;

  constructor(
    ownPubkey: string,
    ownSk: Uint8Array,
    publishFn: (events: NTNostrEvent[]) => Promise<void>,
    dispatch?: GroupDispatchFn
  ) {
    this.ownPubkey = ownPubkey;
    this.ownSk = ownSk;
    this.publishFn = publishFn;
    // Default dispatch is a no-op for unit tests that don't wire rootScope.
    this.dispatch = dispatch ?? (() => {});
    this.store = getGroupStore();
    this.groupDelivery = new GroupDeliveryTracker();
    this.log = logger('GroupAPI');
  }

  // ─── Group lifecycle ──────────────────────────────────────────

  /**
   * Create a new group.
   *
   * 1. Generate groupId via crypto.randomUUID
   * 2. Compute peerId via groupIdToPeerId
   * 3. Store GroupRecord with adminPubkey = ownPubkey
   * 4. Broadcast group_create control to all members + self
   * 5. Return groupId
   */
  async createGroup(name: string, memberPubkeys: string[], description?: string): Promise<string> {
    const groupId = crypto.randomUUID().split('-').join('');
    const peerId = await groupIdToPeerId(groupId);

    const record: GroupRecord = {
      groupId,
      name,
      description,
      adminPubkey: this.ownPubkey,
      members: [...memberPubkeys, this.ownPubkey],
      peerId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await this.store.save(record);

    // Seed a synthetic service row so tweb's dialog validation sees a real
    // top_message for the group. The row is local-only (never transmitted).
    const createdAtSec = Math.floor(record.createdAt / 1000);
    let serviceMid: number | null = null;
    try {
      const service = await writeGroupCreateServiceMessage({
        groupId,
        peerId,
        timestamp: createdAtSec,
        adminPubkey: this.ownPubkey,
        title: name,
        isOutgoing: true
      });
      serviceMid = service.mid;
    } catch(err) {
      this.log.warn('[GroupAPI] failed to seed chatCreate service row (creator):', err);
    }

    // Materialise the group in main-thread mirrors + chat list immediately,
    // before any real message is sent. Without this the group is invisible
    // until the first send hits `handleGroupOutgoing`.
    if(serviceMid !== null) {
      try {
        await injectGroupCreateDialog(groupId, serviceMid, createdAtSec);
      } catch(err) {
        this.log.warn('[GroupAPI] injectGroupCreateDialog (creator) failed:', err);
      }
    }

    // Broadcast group_create control message
    const payload: GroupControlPayload = {
      type: 'group_create',
      groupId,
      groupName: name,
      groupDescription: description,
      memberPubkeys: record.members,
      adminPubkey: this.ownPubkey
    };

    const controlWraps = broadcastGroupControl(this.ownSk, memberPubkeys, payload);
    await this.publishFn(controlWraps);

    this.log('[GroupAPI] group created:', groupId, name);
    return groupId;
  }

  // ─── Messaging ────────────────────────────────────────────────

  /**
   * Send a message to all members of a group.
   *
   * 1. Get group from store
   * 2. Call wrapGroupMessage(sk, members, content, groupId)
   * 3. Publish all wraps in parallel (Pitfall 1)
   * 4. Track message ID in sentMessageIds for dedup
   * 5. Init group delivery tracking for all members
   * 6. Return {messageId, rumorId, timestampMs} so VMT's sendMessage
   *    branch can derive the real mid deterministically.
   */
  async sendMessage(groupId: string, content: string, type?: string): Promise<GroupSendResult> {
    const group = await this.store.get(groupId);
    if(!group) throw new Error(`Group not found: ${groupId}`);

    // Pin a single timestamp for the whole send so the payload, handler and
    // any downstream mid derivation all agree. Anchoring via `Date.now()`
    // twice (once in the JSON, once in a local var) risks drifting by 1 ms
    // across the JSON.stringify boundary in heavy-GC environments.
    const timestampMs = Date.now();
    const messageId = `grp-${timestampMs}-${Math.random().toString(36).slice(2, 8)}`;

    // Build message payload
    const messagePayload = JSON.stringify({
      content,
      type: type || 'text',
      id: messageId,
      timestamp: timestampMs
    });

    // Get members excluding self for wrapping (wrapGroupMessage adds self-send)
    const otherMembers = group.members.filter(m => m !== this.ownPubkey);

    const {wraps, rumorId} = wrapGroupMessage(this.ownSk, otherMembers, messagePayload, groupId);

    const msgType = type || 'text';

    // Track for self-send dedup (Pitfall 7)
    this.sentMessageIds.add(messageId);

    // Init delivery tracking for other members
    this.groupDelivery.initMessage(messageId, groupId, otherMembers);

    // Optimistic sender-side render: persist the outgoing row + dispatch
    // history_append + dialogs_multiupdate so the bubble appears immediately,
    // mirroring appMessagesManager.sendText's flow for DMs. Runs BEFORE
    // publish so the bubble is visible even if the relay is slow/unreachable.
    try {
      await handleGroupOutgoing(
        this.ownPubkey,
        {groupId, messageId, rumorId, content, timestamp: timestampMs, type: msgType},
        this.dispatch
      );
    } catch(err) {
      this.log.warn('[GroupAPI] handleGroupOutgoing threw:', err);
    }

    // Publish all wraps
    await this.publishFn(wraps);

    this.log('[GroupAPI] message sent to group:', groupId, 'id:', messageId, 'rumorId:', rumorId.slice(0, 8));
    return {messageId, rumorId, timestampMs};
  }

  // ─── Member management ────────────────────────────────────────

  /**
   * Add a member to the group.
   * Only admin can add members.
   */
  async addMember(groupId: string, newMemberPubkey: string): Promise<void> {
    const group = await this.store.get(groupId);
    if(!group) throw new Error(`Group not found: ${groupId}`);
    if(group.adminPubkey !== this.ownPubkey) throw new Error('Only admin can add members');

    const updatedMembers = [...group.members, newMemberPubkey];
    await this.store.updateMembers(groupId, updatedMembers);

    const payload: GroupControlPayload = {
      type: 'group_add_member',
      groupId,
      targetPubkey: newMemberPubkey,
      memberPubkeys: updatedMembers,
      groupName: group.name
    };

    // Broadcast to ALL current members + new member
    const controlWraps = broadcastGroupControl(this.ownSk, updatedMembers, payload);
    await this.publishFn(controlWraps);

    this.log('[GroupAPI] member added to group:', groupId, newMemberPubkey.slice(0, 8));
  }

  /**
   * Remove a member from the group.
   * Only admin can remove members.
   */
  async removeMember(groupId: string, memberPubkey: string): Promise<void> {
    const group = await this.store.get(groupId);
    if(!group) throw new Error(`Group not found: ${groupId}`);
    if(group.adminPubkey !== this.ownPubkey) throw new Error('Only admin can remove members');

    const remaining = group.members.filter(m => m !== memberPubkey);
    await this.store.updateMembers(groupId, remaining);

    const payload: GroupControlPayload = {
      type: 'group_remove_member',
      groupId,
      targetPubkey: memberPubkey
    };

    // Broadcast to REMAINING members only
    const controlWraps = broadcastGroupControl(this.ownSk, remaining, payload);
    await this.publishFn(controlWraps);

    this.log('[GroupAPI] member removed from group:', groupId, memberPubkey.slice(0, 8));
  }

  /**
   * Leave the group.
   * Broadcasts group_leave to remaining members, deletes local group.
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = await this.store.get(groupId);
    if(!group) throw new Error(`Group not found: ${groupId}`);

    const remaining = group.members.filter(m => m !== this.ownPubkey);

    const payload: GroupControlPayload = {
      type: 'group_leave',
      groupId
    };

    // Broadcast to remaining members
    const controlWraps = broadcastGroupControl(this.ownSk, remaining, payload);
    await this.publishFn(controlWraps);

    // Delete group locally + clean up main-thread mirror state symmetric to
    // `ensureGroupChatInjected` (nostra-groups-sync.ts). Without the mirror
    // cleanup the Chat entry survives store deletion, violating
    // INV-group-no-orphan-mirror-peer and briefly re-rendering the "left"
    // group in chat list until the next reload.
    const peerId = await groupIdToPeerId(groupId);
    await this.store.delete(groupId);
    await cleanupGroupChatInjection(peerId);

    this.log('[GroupAPI] left group:', groupId);
  }

  // ─── Incoming message handling ────────────────────────────────

  /**
   * Handle an incoming group message.
   *
   * 1. Check sentMessageIds for dedup (Pitfall 7)
   * 2. Invoke the test hook if present
   * 3. Call the production render pipeline
   */
  handleIncomingGroupMessage(groupId: string, rumor: any, senderPubkey: string): void {
    // Parse message ID for dedup check
    let messageId: string | null = null;
    try {
      const parsed = JSON.parse(rumor.content);
      messageId = parsed.id || null;
    } catch{
      messageId = rumor.id;
    }

    // Pitfall 7: self-send dedup
    if(messageId && this.sentMessageIds.has(messageId)) {
      this.log('[GroupAPI] dedup: ignoring self-sent message:', messageId);
      return;
    }

    // Test-only override. Unit tests set this to observe delivery without
    // exercising the full IndexedDB + rootScope pipeline.
    if(this.onGroupMessage) {
      try {
        this.onGroupMessage(groupId, rumor, senderPubkey);
      } catch(err) {
        this.log.warn('[GroupAPI] onGroupMessage test hook threw:', err);
      }
      return;
    }

    // Production render path — persist + dispatch bubbles.
    handleGroupIncoming(this.ownPubkey, groupId, rumor, senderPubkey, this.dispatch)
    .catch((err) => this.log.warn('[GroupAPI] handleGroupIncoming threw:', err));
  }

  /**
   * Handle an incoming control message.
   * Routes to specific handler based on payload.type.
   */
  async handleControlMessage(rumor: any, senderPubkey: string): Promise<void> {
    let payload: GroupControlPayload;
    try {
      payload = JSON.parse(rumor.content);
    } catch{
      this.log.warn('[GroupAPI] failed to parse control message content');
      return;
    }

    switch(payload.type) {
      case 'group_create':
        await this.handleGroupCreate(payload, senderPubkey);
        break;
      case 'group_add_member':
        await this.handleAddMember(payload);
        break;
      case 'group_remove_member':
        await this.handleRemoveMember(payload);
        break;
      case 'group_leave':
        await this.handleMemberLeave(payload, senderPubkey);
        break;
      case 'group_info_update':
        await this.handleInfoUpdate(payload);
        break;
      case 'group_admin_transfer':
        await this.handleAdminTransfer(payload);
        break;
      default:
        this.log.warn('[GroupAPI] unknown control message type:', payload.type);
    }
  }

  // ─── Control message handlers ─────────────────────────────────

  private async handleGroupCreate(payload: GroupControlPayload, senderPubkey: string): Promise<void> {
    const peerId = await groupIdToPeerId(payload.groupId);
    const record: GroupRecord = {
      groupId: payload.groupId,
      name: payload.groupName || 'Group',
      description: payload.groupDescription,
      adminPubkey: payload.adminPubkey || senderPubkey,
      members: payload.memberPubkeys || [],
      peerId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.store.save(record);

    // Seed a local-only service row so receivers also get a valid top_message
    // in their group dialog before any real message lands.
    const createdAtSec = Math.floor(record.createdAt / 1000);
    let serviceMid: number | null = null;
    try {
      const service = await writeGroupCreateServiceMessage({
        groupId: record.groupId,
        peerId,
        timestamp: createdAtSec,
        adminPubkey: record.adminPubkey,
        title: record.name,
        isOutgoing: false
      });
      serviceMid = service.mid;
    } catch(err) {
      this.log.warn('[GroupAPI] failed to seed chatCreate service row (receiver):', err);
    }

    // Materialise the group in main-thread mirrors + chat list immediately,
    // before the first real message lands. Without this, invited members
    // never see the group until someone sends — and even then only after
    // a full `handleGroupIncoming` render round-trip.
    if(serviceMid !== null) {
      try {
        await injectGroupCreateDialog(record.groupId, serviceMid, createdAtSec);
      } catch(err) {
        this.log.warn('[GroupAPI] injectGroupCreateDialog (receiver) failed:', err);
      }
    }

    this.log('[GroupAPI] group_create received:', payload.groupId);
  }

  private async handleAddMember(payload: GroupControlPayload): Promise<void> {
    if(payload.memberPubkeys) {
      await this.store.updateMembers(payload.groupId, payload.memberPubkeys);
    }
    this.log('[GroupAPI] group_add_member:', payload.targetPubkey?.slice(0, 8));
  }

  private async handleRemoveMember(payload: GroupControlPayload): Promise<void> {
    if(payload.targetPubkey === this.ownPubkey) {
      // We were removed — delete group locally + clean up the injected Chat
      // from main-thread mirrors so INV-group-no-orphan-mirror-peer holds
      // and the chat list doesn't flash the removed group on refresh.
      const peerId = await groupIdToPeerId(payload.groupId);
      await this.store.delete(payload.groupId);
      await cleanupGroupChatInjection(peerId);
      this.log('[GroupAPI] removed from group:', payload.groupId);
    } else {
      const group = await this.store.get(payload.groupId);
      if(group) {
        const remaining = group.members.filter(m => m !== payload.targetPubkey);
        await this.store.updateMembers(payload.groupId, remaining);
      }
    }
  }

  private async handleMemberLeave(payload: GroupControlPayload, senderPubkey: string): Promise<void> {
    const group = await this.store.get(payload.groupId);
    if(group) {
      const remaining = group.members.filter(m => m !== senderPubkey);

      // Admin-orphan protection: if the departing member was the admin, the
      // remaining record would keep `adminPubkey` pointing at the gone admin
      // — violating INV-group-admin-is-member. Auto-transfer admin to the
      // lex-smallest remaining pubkey so every member derives the same new
      // admin deterministically without a separate control-message round.
      const wasAdminLeaving = group.adminPubkey === senderPubkey;
      const newAdmin = wasAdminLeaving && remaining.length > 0 ?
        [...remaining].sort()[0] :
        group.adminPubkey;

      if(wasAdminLeaving && newAdmin !== group.adminPubkey) {
        const updated = {
          ...group,
          members: remaining,
          adminPubkey: newAdmin,
          updatedAt: Date.now()
        };
        await this.store.save(updated);
        this.log('[GroupAPI] admin left; auto-promoted new admin:', newAdmin.slice(0, 8), 'in group', payload.groupId.slice(0, 8));
      } else {
        await this.store.updateMembers(payload.groupId, remaining);
      }
    }
    this.log('[GroupAPI] member left group:', senderPubkey.slice(0, 8));
  }

  private async handleInfoUpdate(payload: GroupControlPayload): Promise<void> {
    await this.store.updateInfo(payload.groupId, {
      name: payload.groupName,
      description: payload.groupDescription,
      avatar: payload.groupAvatar
    });
  }

  private async handleAdminTransfer(payload: GroupControlPayload): Promise<void> {
    const group = await this.store.get(payload.groupId);
    if(group && payload.adminPubkey) {
      group.adminPubkey = payload.adminPubkey;
      group.updatedAt = Date.now();
      await this.store.save(group);
    }
  }

  // ─── Accessors ────────────────────────────────────────────────

  getDeliveryTracker(): GroupDeliveryTracker {
    return this.groupDelivery;
  }
}

// ─── Singleton ──────────────────────────────────────────────────

let _instance: GroupAPI | null = null;

export function getGroupAPI(): GroupAPI {
  if(!_instance) throw new Error('GroupAPI not initialized. Call initGroupAPI() first.');
  return _instance;
}

export function initGroupAPI(
  ownPubkey: string,
  ownSk: Uint8Array,
  publishFn: (events: NTNostrEvent[]) => Promise<void>,
  dispatch?: GroupDispatchFn
): GroupAPI {
  _instance = new GroupAPI(ownPubkey, ownSk, publishFn, dispatch);
  // Expose on window so E2E/fuzz tests resolve via a single shared reference.
  // Vite dev can serve `@lib/nostra/group-api` and `/src/lib/nostra/group-api.ts`
  // as separate module instances (same class behind the multi-rootScope bug
  // noted in CLAUDE.md); the window ref bypasses that for non-production code.
  try {
    if(typeof window !== 'undefined') (window as any).__nostraGroupAPI = _instance;
  } catch{}
  return _instance;
}
