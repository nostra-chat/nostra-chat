/**
 * NostraPeerMapper
 *
 * Factory for creating properly-shaped tweb-native objects (User, Chat, Message, Dialog)
 * from Nostr data. Centralises the synthetic object construction that was previously
 * scattered across nostra-display-bridge and nostra-bridge.
 */

import type {User, Chat, Dialog, Message, Peer, PeerNotifySettings} from '@layer';
import {NostraBridge} from './nostra-bridge';

export interface CreateUserOpts {
  peerId: number;
  firstName?: string;
  lastName?: string;
  pubkey: string;
}

export interface CreateChatOpts {
  chatId: number;
  title: string;
  membersCount: number;
  date: number;
}

export interface CreateMessageOpts {
  mid: number;
  peerId: number;
  fromPeerId?: number;
  date: number;
  text: string;
  isOutgoing: boolean;
  media?: any;
}

export interface CreateDialogOpts {
  peerId: number;
  topMessage: number;
  topMessageDate: number;
  unreadCount?: number;
  isGroup?: boolean;
  readInboxMaxId?: number;
  readOutboxMaxId?: number;
}

export class NostraPeerMapper {
  /**
   * Creates a User.user object from Nostr data.
   * Falls back to first 12 chars of pubkey if no firstName provided.
   */
  createTwebUser(opts: CreateUserOpts): User.user {
    let displayName = opts.firstName;
    if(!displayName) {
      // Use first 12 chars of pubkey as display name fallback.
      // (npubEncode is async-loaded; callers that need npub should pass firstName.)
      displayName = opts.pubkey.slice(0, 12);
    }

    const user: User.user = {
      _: 'user',
      id: opts.peerId,
      first_name: displayName,
      last_name: opts.lastName,
      pFlags: {},
      access_hash: '0',
      status: {_: 'userStatusRecently', pFlags: {by_me: true}}
    } as User.user;

    // Store pubkey for avatar derivation and relay lookups
    (user as any).p2pPubkey = opts.pubkey;

    return user;
  }

  /**
   * Creates a Chat.chat object for a group peer.
   */
  createTwebChat(opts: CreateChatOpts): Chat.chat {
    const chat: Chat.chat = {
      _: 'chat',
      id: opts.chatId,
      title: opts.title,
      participants_count: opts.membersCount,
      date: opts.date,
      pFlags: {}
    } as Chat.chat;

    return chat;
  }

  /**
   * Creates a Message.message object from P2P data.
   * For negative peerId → peerChat; positive → peerUser.
   */
  createTwebMessage(opts: CreateMessageOpts): Message.message {
    const pFlags: Message.message['pFlags'] = {};
    if(opts.isOutgoing) {
      pFlags.out = true;
      pFlags.unread = true; // Shows single check (is-sent) instead of double (is-read)
    } else {
      pFlags.unread = true;
    }

    const isGroup = opts.peerId < 0;
    const chatId = Math.abs(opts.peerId);

    const peer_id: Peer = isGroup ?
      {_: 'peerChat', chat_id: chatId} as Peer.peerChat :
      {_: 'peerUser', user_id: opts.peerId} as Peer.peerUser;

    let from_id: Peer | undefined;
    if(!opts.isOutgoing && opts.fromPeerId) {
      from_id = {_: 'peerUser', user_id: opts.fromPeerId} as Peer.peerUser;
    }

    const message: Message.message = {
      _: 'message',
      id: opts.mid,
      peer_id,
      ...(from_id ? {from_id} : {}),
      date: opts.date,
      message: opts.text,
      pFlags,
      ...(opts.media ? {media: opts.media} : {})
    } as Message.message;

    // Set mid and peerId explicitly — required for P2P synthetic messages
    // that bypass saveMessages()
    (message as any).mid = opts.mid;
    (message as any).peerId = isGroup ?
      opts.peerId.toPeerId(true) :
      opts.peerId.toPeerId(false);

    return message;
  }

  /**
   * Creates a Dialog.dialog object for a P2P peer.
   * No pFlags.pinned — the pinned flag was a legacy bug.
   */
  createTwebDialog(opts: CreateDialogOpts): Dialog.dialog {
    const now = Math.floor(Date.now() / 1000);
    const sortIndex = (opts.topMessageDate || now) * 0x10000;

    const isGroup = opts.isGroup ?? opts.peerId < 0;
    const chatId = Math.abs(opts.peerId);

    const peer: Peer = isGroup ?
      {_: 'peerChat', chat_id: chatId} as Peer.peerChat :
      {_: 'peerUser', user_id: opts.peerId} as Peer.peerUser;

    const peerId: PeerId = isGroup ?
      opts.peerId.toPeerId(true) :
      opts.peerId.toPeerId(false);

    const dialog = {
      _: 'dialog',
      pFlags: {},
      peer,
      peerId,
      top_message: opts.topMessage,
      read_inbox_max_id: opts.readInboxMaxId ?? 0,
      read_outbox_max_id: opts.readOutboxMaxId ?? 0,
      unread_count: opts.unreadCount ?? 0,
      unread_mentions_count: 0,
      unread_reactions_count: 0,
      folder_id: 0,
      notify_settings: {
        _: 'peerNotifySettings',
        pFlags: {},
        sound: 1,
        show_previews: true,
        silent: false,
        mute_until: 0
      } as PeerNotifySettings,
      pts: undefined
    } as Dialog.dialog;

    (dialog as any)['index_0'] = sortIndex;

    return dialog;
  }

  /**
   * Maps a Nostr pubkey to a tweb virtual peer ID.
   */
  async mapPubkey(pubkey: string): Promise<number> {
    return NostraBridge.getInstance().mapPubkeyToPeerId(pubkey);
  }

  /**
   * Maps a Nostr event ID to a tweb virtual message ID.
   * Timestamp is encoded in the high bits for chronological ordering.
   */
  async mapEventId(eventId: string, timestamp: number): Promise<number> {
    return NostraBridge.getInstance().mapEventIdToMid(eventId, timestamp);
  }
}
