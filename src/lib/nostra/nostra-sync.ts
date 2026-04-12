/**
 * NostraSync
 *
 * Listens to incoming messages from ChatAPI and persists them to the
 * message store, then dispatches events for real-time rendering.
 */

import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';
import type {ChatMessage} from './chat-api';

const LOG_PREFIX = '[NostraSync]';

type DispatchFn = (event: string, data: any) => void;

export class NostraSync {
  private ownPubkey: string;
  private dispatch: DispatchFn;
  private mapper: NostraPeerMapper;

  constructor(ownPubkey: string, dispatch: DispatchFn) {
    this.ownPubkey = ownPubkey;
    this.dispatch = dispatch;
    this.mapper = new NostraPeerMapper();
  }

  /**
   * Called when ChatAPI receives an incoming message.
   * Persists to message store and dispatches nostra_new_message event.
   *
   * IMPORTANT: We use `msg.relayEventId` (rumor hex id) as the canonical
   * storage key, NOT `msg.id` (which is `chat-XXX-N` parsed from the content
   * JSON). chat-api-receive already stored the message with `eventId = rumor id`,
   * so we must use the same eventId to hit the upsert path instead of creating
   * a duplicate row that would produce two bubbles with different mids.
   */
  async onIncomingMessage(msg: ChatMessage, senderPubkey: string): Promise<void> {
    const peerId = await this.mapper.mapPubkey(senderPubkey);
    const storageEventId = msg.relayEventId || msg.id;
    const mid = await this.mapper.mapEventId(storageEventId, Math.floor(msg.timestamp));
    // msg.timestamp is already in UNIX seconds (from rumor.created_at)
    const timestamp = Math.floor(msg.timestamp);
    const store = getMessageStore();
    const conversationId = store.getConversationId(this.ownPubkey, senderPubkey);

    await store.saveMessage({
      eventId: storageEventId,
      conversationId,
      senderPubkey,
      content: msg.content,
      type: msg.type === 'text' ? 'text' : 'file',
      timestamp,
      deliveryState: 'delivered',
      mid,
      twebPeerId: peerId,
      isOutgoing: false,
      ...(msg.fileMetadata ? {fileMetadata: msg.fileMetadata} : {})
    });

    console.log(LOG_PREFIX, 'dispatching nostra_new_message', {peerId, mid});
    this.dispatch('nostra_new_message', {peerId, mid, senderPubkey, message: msg, timestamp});
  }

  /**
   * Called when a kind 0 profile is fetched or updated.
   * Dispatches nostra_profile_update event.
   */
  async onProfileUpdate(pubkey: string, profile: {name?: string, display_name?: string, about?: string, picture?: string}): Promise<void> {
    const peerId = await this.mapper.mapPubkey(pubkey);
    const displayName = profile.display_name || profile.name;

    console.log(LOG_PREFIX, 'dispatching nostra_profile_update', {peerId, pubkey});
    this.dispatch('nostra_profile_update', {peerId, pubkey, displayName, about: profile.about, picture: profile.picture});
  }

  /**
   * Called when a kind 30315 presence heartbeat is received.
   * Dispatches nostra_presence_update event.
   */
  async onPresenceUpdate(pubkey: string, status: 'online' | 'offline' | 'recently'): Promise<void> {
    const peerId = await this.mapper.mapPubkey(pubkey);

    console.log(LOG_PREFIX, 'dispatching nostra_presence_update', {peerId, pubkey, status});
    this.dispatch('nostra_presence_update', {peerId, pubkey, status});
  }
}
