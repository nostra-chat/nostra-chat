/**
 * NostraMTProtoServer
 *
 * Pull-based server that intercepts MTProto method calls and returns
 * native tweb-shaped responses built from local Nostr data stores.
 *
 * Replaces push-based injection scattered across nostra-display-bridge
 * and nostra-bridge with a clean request/response pattern.
 */

import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';
import {loadCachedPeerProfile, refreshPeerProfileFromRelays} from './peer-profile-cache';
import {buildNostraMedia} from './nostra-media-shape';
import {getPubkey, getMapping} from './virtual-peers-db';
import {swallowHandler} from './log-swallow';

const LOG_PREFIX = '[VirtualMTProto]';

// ─── Action method patterns ──────────────────────────────────────────

const ACTION_PATTERNS = [
  '.set', '.save', '.delete', '.read', '.mark',
  '.toggle', '.send', '.block', '.unblock', '.join', '.leave'
];

// ─── Known method fallback shapes ───────────────────────────────────

export const NOSTRA_STATIC: Record<string, any> = {
  'updates.getState': {
    _: 'updates.state',
    pts: 1,
    qts: 0,
    date: Math.floor(Date.now() / 1000),
    seq: 1,
    unread_count: 0
  },
  'updates.getDifference': {
    _: 'updates.differenceEmpty',
    date: Math.floor(Date.now() / 1000),
    seq: 1
  },
  'help.getConfig': {
    _: 'config',
    date: Math.floor(Date.now() / 1000),
    expires: Math.floor(Date.now() / 1000) + 3600,
    test_mode: false,
    this_dc: 1,
    dc_options: [],
    dc_txt_domain_name: '',
    chat_size_max: 200,
    megagroup_size_max: 200000,
    forwarded_count_max: 100,
    online_update_period_ms: 210000,
    offline_blur_timeout_ms: 5000,
    offline_idle_timeout_ms: 30000,
    online_cloud_timeout_ms: 300000,
    notify_cloud_delay_ms: 30000,
    notify_default_delay_ms: 1500,
    push_chat_period_ms: 60000,
    push_chat_limit: 2,
    saved_gifs_limit: 200,
    edit_time_limit: 172800,
    revoke_time_limit: 172800,
    revoke_pm_time_limit: 2147483647,
    rating_e_decay: 2419200,
    stickers_recent_limit: 15,
    stickers_faved_limit: 5,
    channels_read_media_period: 604800,
    pinned_dialogs_count_max: 5,
    pinned_infolder_count_max: 100,
    call_receive_timeout_ms: 20000,
    call_ring_timeout_ms: 90000,
    call_connect_timeout_ms: 30000,
    call_packet_timeout_ms: 10000,
    me_url_prefix: 'https://t.me/',
    autoupdate_url_prefix: '',
    gif_search_username: 'gif',
    venue_search_username: 'foursquare',
    img_search_username: 'bing',
    static_maps_provider: '',
    caption_length_max: 1024,
    message_length_max: 4096,
    webfile_dc_id: 1,
    suggested_lang_code: 'en',
    lang_pack_version: 0,
    base_lang_pack_version: 0,
    pFlags: {}
  },
  'help.getAppConfig': {
    _: 'help.appConfig',
    hash: 0,
    config: {_: 'jsonObject', value: []}
  },
  'account.getNotifySettings': {
    _: 'peerNotifySettings',
    pFlags: {},
    flags: 0
  },
  'langpack.getDifference': {
    _: 'langPackDifference',
    lang_code: 'en',
    from_version: 0,
    version: 1,
    strings: []
  },
  'stories.getAllStories': {
    _: 'stories.allStories',
    pFlags: {},
    count: 0,
    state: '',
    peer_stories: [],
    chats: [],
    users: [],
    stealth_mode: {_: 'storiesStealthMode', pFlags: {}}
  },
  'stories.getPeerStories': {
    _: 'stories.peerStories',
    stories: {_: 'peerStories', pFlags: {}, peer: {_: 'peerUser', user_id: 0}, stories: []},
    chats: [],
    users: []
  },
  'messages.getDialogFilters': [],
  'messages.getSuggestedDialogFilters': [],
  'messages.updateDialogFilter': true,
  'messages.updateDialogFiltersOrder': true,
  'messages.getPinnedDialogs': {
    _: 'messages.peerDialogs',
    dialogs: [],
    messages: [],
    chats: [],
    users: [],
    state: {_: 'updates.state', pts: 1, qts: 0, date: 0, seq: 1, unread_count: 0}
  },
  'messages.getPinnedSavedDialogs': {
    _: 'messages.savedDialogs',
    dialogs: [],
    messages: [],
    chats: [],
    users: []
  },
  'messages.getSavedDialogs': {
    _: 'messages.savedDialogs',
    dialogs: [],
    messages: [],
    chats: [],
    users: []
  },
  'messages.getEmojiKeywordsDifference': {
    _: 'emojiKeywordsDifference',
    lang_code: 'en',
    from_version: 0,
    version: 1,
    keywords: []
  },
  'account.getPassword': {
    _: 'account.password',
    pFlags: {has_password: false},
    new_algo: {_: 'passwordKdfAlgoUnknown'},
    new_secure_algo: {_: 'securePasswordKdfAlgoUnknown'},
    secure_random: new Uint8Array(0)
  },
  'account.getPrivacy': {
    _: 'account.privacyRules',
    rules: [{_: 'privacyValueAllowAll'}],
    chats: [],
    users: []
  },
  'contacts.getTopPeers': {
    _: 'contacts.topPeersDisabled'
  },
  'messages.getStickers': {
    _: 'messages.stickers',
    hash: 0,
    stickers: []
  },
  'messages.getAllStickers': {
    _: 'messages.allStickers',
    hash: 0,
    sets: []
  },
  'messages.getSearchCounters': [],
  'photos.getUserPhotos': {
    _: 'photos.photos',
    photos: [],
    users: []
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract a numeric peerId from various MTProto peer input formats.
 */
function extractPeerId(peer: any): number | null {
  if(!peer) return null;
  // inputPeerUser / plain user_id
  if(peer.user_id !== undefined) return Number(peer.user_id);
  // inputPeerChat / plain chat_id
  if(peer.chat_id !== undefined) return -Math.abs(Number(peer.chat_id));
  // inputPeerChannel / channel_id
  if(peer.channel_id !== undefined) return -Math.abs(Number(peer.channel_id));
  return null;
}

// ─── Server ──────────────────────────────────────────────────────────

export interface NostraMTProtoServerDeps {
  /**
   * Resolve a target message's relay event id + sender pubkey from a
   * peerId + mid pair. Used by `messages.sendReaction` to build the
   * `e`/`p` tags on a kind-7 reaction. Optional DI seam for tests; the
   * default implementation reads from the message-store.
   */
  getMessageByPeerMid?: (peerId: number, mid: number) => Promise<{relayEventId: string; senderPubkey: string} | null> | {relayEventId: string; senderPubkey: string} | null;
}

export class NostraMTProtoServer {
  private mapper: NostraPeerMapper;
  private ownPubkey: string | null;
  private chatAPI: any | null;
  private deps: NostraMTProtoServerDeps;

  constructor(deps: NostraMTProtoServerDeps = {}) {
    this.mapper = new NostraPeerMapper();
    this.ownPubkey = null;
    this.chatAPI = null;
    this.deps = deps;
  }

  private async getMessageByPeerMid(peerId: number, mid: number): Promise<{relayEventId: string; senderPubkey: string} | null> {
    if(this.deps.getMessageByPeerMid) {
      const r = await this.deps.getMessageByPeerMid(peerId, mid);
      return r || null;
    }
    try {
      const row = await getMessageStore().getByMid(mid);
      if(!row) return null;
      return {relayEventId: row.eventId, senderPubkey: row.senderPubkey};
    } catch(e) {
      console.warn(LOG_PREFIX, 'getMessageByPeerMid: store lookup failed', e);
      return null;
    }
  }

  setOwnPubkey(pubkey: string): void {
    this.ownPubkey = pubkey;
  }

  setChatAPI(chatAPI: any): void {
    this.chatAPI = chatAPI;
    this.wireRetryListener();
  }

  private retryListenerWired = false;
  private wireRetryListener(): void {
    if(this.retryListenerWired) return;
    this.retryListenerWired = true;
    // Lazy-import rootScope to avoid pulling it into non-browser test paths.
    import('@lib/rootScope').then(({default: rs}) => {
      if(typeof (rs as any).addEventListener !== 'function') return;
      (rs as any).addEventListener('nostra_retry_file_send', async(e: {peerId: number; mid: number}) => {
        const {getPendingFileSend} = await import('./nostra-send-file');
        const pending = getPendingFileSend(e.mid);
        if(!pending) {
          console.warn(LOG_PREFIX, 'retry: no pending entry for mid', e.mid);
          return;
        }
        await this.nostraSendFile({
          peerId: pending.peerId,
          blob: pending.blob,
          type: pending.type,
          caption: pending.caption,
          tempMid: pending.tempMid,
          width: pending.width,
          height: pending.height,
          duration: pending.duration,
          waveform: pending.waveform
        });
      });
    }).catch(swallowHandler('VirtualMTProto.pendingFlush'));
  }

  async handleMethod(method: string, params: any): Promise<any> {
    switch(method) {
      case 'messages.getDialogs':
      case 'messages.getPinnedDialogs':
        return this.getDialogs(params);

      case 'messages.getHistory':
        return this.getHistory(params);

      case 'messages.search':
        return this.searchMessages(params);

      case 'contacts.getContacts':
        return this.getContacts();

      case 'users.getFullUser':
        return this.getFullUser(params);

      case 'users.getUsers':
        return this.getUsers(params);

      case 'messages.sendMessage':
        return this.sendMessage(params);

      case 'messages.editMessage':
        return this.editMessage(params);

      case 'messages.sendReaction':
        return this.sendReaction(params);

      case 'messages.sendMedia':
        return this.sendMedia(params);

      case 'nostraSendFile':
        return this.nostraSendFile(params);

      case 'messages.deleteMessages':
        return this.deleteMessages(params);

      case 'messages.readHistory':
        return this.readHistory(params);

      case 'messages.createChat':
        return this.createChat(params);

      case 'channels.createChannel':
        return this.createChannel(params);

      case 'channels.inviteToChannel':
        return this.inviteToChannel(params);

      default:
        return this.fallback(method, params);
    }
  }

  // ─── Private implementations ──────────────────────────────────────

  private async getDialogs(_params: any): Promise<any> {
    const store = getMessageStore();
    const dialogs: any[] = [];
    const messages: any[] = [];
    const users: any[] = [];
    const chats: any[] = [];

    try {
      const conversationIds = await store.getAllConversationIds();

      for(const convId of conversationIds) {
        try {
          const [msgA, msgB] = convId.split(':');
          if(!msgA || !msgB) continue;

          // Determine which pubkey is the peer (not us)
          const peerPubkey = this.ownPubkey && msgA === this.ownPubkey ? msgB :
            this.ownPubkey && msgB === this.ownPubkey ? msgA :
            msgB;

          const latestMsgs = await store.getMessages(convId, 1);
          if(latestMsgs.length === 0) continue;

          const latest = latestMsgs[0];
          const peerId = await this.mapper.mapPubkey(peerPubkey);

          // Identity-triple contract: `latest.mid` is set at creation and
          // never recomputed. If it's missing, an upstream write path is
          // broken — surface loudly rather than silently spawn a ghost mid.
          if(latest.mid == null) {
            console.error(LOG_PREFIX, 'getDialogs: stored message missing mid — upstream write path is broken', {eventId: latest.eventId, timestamp: latest.timestamp});
            throw new Error('StoredMessage.mid is required (getDialogs 1:1 branch)');
          }
          const mid = latest.mid;

          // Read display name from peer mapping (nickname saved at add-contact time)
          const mapping = await getMapping(peerPubkey);
          const user = this.mapper.createTwebUser({
            peerId,
            firstName: mapping?.displayName,
            pubkey: peerPubkey
          });

          const isOutgoing = latest.isOutgoing ?? (latest.senderPubkey === this.ownPubkey);

          const msg = this.mapper.createTwebMessage({
            mid,
            peerId,
            fromPeerId: isOutgoing ? undefined : peerId,
            date: latest.timestamp,
            text: latest.content,
            isOutgoing
          });

          const readCursor = await store.getReadCursor(convId);
          const unreadCount = this.ownPubkey ?
            await store.countUnread(convId, this.ownPubkey) :
            0;

          const dialog = this.mapper.createTwebDialog({
            peerId,
            topMessage: mid,
            topMessageDate: latest.timestamp,
            unreadCount,
            readInboxMaxId: readCursor,
            readOutboxMaxId: readCursor
          });

          dialogs.push(dialog);
          messages.push(msg);
          users.push(user);
        } catch(err) {
          console.warn(LOG_PREFIX, 'getDialogs: failed for conversation', convId, err);
        }
      }
    } catch(err) {
      console.warn(LOG_PREFIX, 'getDialogs: failed to get conversation IDs', err);
    }

    // Load groups from group-store (may not exist in all environments)
    try {
      const {getGroupStore} = await import('./group-store');
      const groupStore = getGroupStore();
      const groups = await groupStore.getAll();

      for(const group of groups) {
        try {
          const convId = group.groupId;
          const latestMsgs = await store.getMessages(convId, 1);
          const latest = latestMsgs[0];
          const peerId = group.peerId;

          const chat = this.mapper.createTwebChat({
            chatId: Math.abs(peerId),
            title: group.name,
            membersCount: group.members.length,
            date: group.createdAt
          });

          let mid = 0;
          let topDate = group.createdAt;

          if(latest) {
            if(latest.mid == null) {
              console.error(LOG_PREFIX, 'getDialogs: stored group message missing mid — upstream write path is broken', {eventId: latest.eventId, timestamp: latest.timestamp});
              throw new Error('StoredMessage.mid is required (getDialogs group branch)');
            }
            mid = latest.mid;
            topDate = latest.timestamp;

            const isOutgoing = latest.isOutgoing ?? (latest.senderPubkey === this.ownPubkey);
            const fromUserId = isOutgoing ? 0 :
              await this.mapper.mapPubkey(latest.senderPubkey);

            if(latest.serviceType === 'chatCreate') {
              // Emit a tweb service message so the dialog preview reads "Group
              // created" instead of an empty bubble. See group-service-messages.ts.
              const serviceMsg = {
                _: 'messageService',
                pFlags: isOutgoing ? {out: true} : {},
                id: mid,
                peer_id: {_: 'peerChat', chat_id: Math.abs(peerId)},
                from_id: {_: 'peerUser', user_id: fromUserId},
                date: latest.timestamp,
                action: {
                  _: 'messageActionChatCreate',
                  title: latest.servicePayload?.title ?? group.name,
                  users: latest.servicePayload?.memberPeerIds ?? []
                }
              };
              messages.push(serviceMsg);
            } else {
              const fromPeerId = isOutgoing ? undefined : fromUserId;
              const msg = this.mapper.createTwebMessage({
                mid,
                peerId,
                fromPeerId,
                date: latest.timestamp,
                text: latest.content,
                isOutgoing
              });
              messages.push(msg);
            }
          }

          const dialog = this.mapper.createTwebDialog({
            peerId,
            topMessage: mid,
            topMessageDate: topDate,
            isGroup: true
          });

          dialogs.push(dialog);
          chats.push(chat);
        } catch(err) {
          console.warn(LOG_PREFIX, 'getDialogs: failed for group', group.groupId, err);
        }
      }
    } catch(_err) {
      // group-store may not exist in test environment — silently ignore
    }

    return {
      _: 'messages.dialogs',
      dialogs,
      messages,
      users,
      chats,
      count: dialogs.length
    };
  }

  private async getHistory(params: any): Promise<any> {
    // If called with a pinned filter, return empty (P2P doesn't support pinning)
    const filterType = params?.filter?._ || '';
    if(filterType === 'inputMessagesFilterPinned') {
      return {_: 'messages.messages', messages: [], users: [], chats: [], count: 0};
    }

    const peerId = extractPeerId(params?.peer);
    if(peerId === null) {
      console.warn(LOG_PREFIX, 'getHistory: could not extract peerId from', params?.peer);
      return {_: 'messages.messages', messages: [], users: [], chats: [], count: 0};
    }

    // Group branch: negative peerId → group chat. Read from message-store by
    // conversationId='group:<groupId>' and skip the user-pubkey path.
    if(peerId < 0) {
      return this.getGroupHistory(peerId, params);
    }

    const absPeerId = Math.abs(peerId);
    const pubkey = await getPubkey(absPeerId);

    if(!pubkey) {
      console.warn(LOG_PREFIX, 'getHistory: no pubkey for peerId', absPeerId);
      return {_: 'messages.messages', messages: [], users: [], chats: [], count: 0};
    }

    const store = getMessageStore();
    const convId = this.ownPubkey ?
      store.getConversationId(this.ownPubkey, pubkey) :
      pubkey;

    const limit = params?.limit ?? 50;
    const offsetDate = params?.offset_date || undefined;
    const storedMsgs = await store.getMessages(convId, limit, offsetDate);

    const messages: any[] = [];
    const users: any[] = [];

    const mapping = await getMapping(pubkey);
    const user = this.mapper.createTwebUser({peerId: absPeerId, firstName: mapping?.displayName, pubkey});
    users.push(user);

    for(const stored of storedMsgs) {
      try {
        // Skip synthetic contact-init entries (empty content, used only for dialog creation)
        if(stored.eventId.startsWith('contact-init-') && !stored.content) continue;

        if(stored.mid == null) {
          console.error(LOG_PREFIX, 'getHistory: stored message missing mid — upstream write path is broken', {eventId: stored.eventId, timestamp: stored.timestamp});
          throw new Error('StoredMessage.mid is required (getHistory)');
        }
        const mid = stored.mid;
        const isOutgoing = stored.isOutgoing ?? (stored.senderPubkey === this.ownPubkey);
        const fromPeerId = isOutgoing ? undefined : absPeerId;

        const media = stored.fileMetadata ? buildNostraMedia(mid, stored.fileMetadata) : undefined;

        const msg = this.mapper.createTwebMessage({
          mid,
          peerId: absPeerId,
          fromPeerId,
          date: stored.timestamp,
          text: stored.content,
          isOutgoing,
          media
        });
        messages.push(msg);
      } catch(err) {
        console.warn(LOG_PREFIX, 'getHistory: failed to map message', stored.eventId, err);
      }
    }

    return {
      _: 'messages.messages',
      messages,
      users,
      chats: [],
      count: messages.length
    };
  }

  /**
   * Group-peer variant of getHistory. Reads from message-store keyed by
   * `conversationId = 'group:<groupId>'` and builds tweb messages with
   * `peer_id: peerChat`. Also emits one user entry per distinct sender so
   * the bubble `from_id` resolves to a known peer (required for avatar +
   * "Alice" prefix in the bubble header).
   */
  private async getGroupHistory(peerId: number, params: any): Promise<any> {
    const {getGroupStore} = await import('./group-store');
    const groupStore = getGroupStore();
    const group = await groupStore.getByPeerId(peerId);
    if(!group) {
      console.warn(LOG_PREFIX, 'getGroupHistory: no group found for peerId', peerId);
      return {_: 'messages.messages', messages: [], users: [], chats: [], count: 0};
    }

    const store = getMessageStore();
    const convId = `group:${group.groupId}`;
    const limit = params?.limit ?? 50;
    const offsetDate = params?.offset_date || undefined;
    const storedMsgs = await store.getMessages(convId, limit, offsetDate);

    const messages: any[] = [];
    const users: any[] = [];
    const usersById = new Map<number, any>();

    // Emit a Chat for this group so the response carries everything tweb
    // needs to resolve the peer without a follow-up roundtrip.
    const absPeerId = Math.abs(peerId);
    const chat = this.mapper.createTwebChat({
      chatId: absPeerId,
      title: group.name || 'Group',
      membersCount: group.members?.length ?? 1,
      date: Math.floor((group.createdAt || Date.now()) / 1000)
    });

    for(const stored of storedMsgs) {
      try {
        if(stored.mid == null) {
          console.error(LOG_PREFIX, 'getGroupHistory: stored message missing mid — upstream write path is broken', {eventId: stored.eventId, timestamp: stored.timestamp});
          throw new Error('StoredMessage.mid is required (getGroupHistory)');
        }
        const mid = stored.mid;
        const isOutgoing = stored.isOutgoing ?? (stored.senderPubkey === this.ownPubkey);

        // Map sender pubkey → fromPeerId for incoming bubbles (outgoing uses
        // pFlags.out instead).
        let fromPeerId: number | undefined;
        if(!isOutgoing && stored.senderPubkey) {
          fromPeerId = await this.mapper.mapPubkey(stored.senderPubkey);
          if(!usersById.has(fromPeerId)) {
            const mapping = await getMapping(stored.senderPubkey);
            const user = this.mapper.createTwebUser({peerId: fromPeerId, firstName: mapping?.displayName, pubkey: stored.senderPubkey});
            usersById.set(fromPeerId, user);
            users.push(user);
          }
        }

        const media = stored.fileMetadata ? buildNostraMedia(mid, stored.fileMetadata) : undefined;

        const msg = this.mapper.createTwebMessage({
          mid,
          peerId, // negative — peer_id becomes peerChat
          fromPeerId,
          date: stored.timestamp,
          text: stored.content,
          isOutgoing,
          media
        });
        messages.push(msg);
      } catch(err) {
        console.warn(LOG_PREFIX, 'getGroupHistory: failed to map message', stored.eventId, err);
      }
    }

    return {
      _: 'messages.messages',
      messages,
      users,
      chats: [chat],
      count: messages.length
    };
  }

  private async searchMessages(params: any): Promise<any> {
    const filterType = params?.filter?._ || '';

    // P2P messages don't support pinning — return empty for pinned filter
    if(filterType === 'inputMessagesFilterPinned') {
      return {
        _: 'messages.messages',
        messages: [],
        users: [],
        chats: [],
        count: 0
      };
    }

    const query = (params?.q ?? '').toLowerCase();
    const store = getMessageStore();
    const messages: any[] = [];
    const users: any[] = [];
    const usersById = new Map<number, any>();

    try {
      const conversationIds = await store.getAllConversationIds();

      for(const convId of conversationIds) {
        try {
          const allMsgs = await store.getMessages(convId, 200);

          for(const stored of allMsgs) {
            if(!stored.content.toLowerCase().includes(query)) continue;

            const [pubkeyA, pubkeyB] = convId.split(':');
            const peerPubkey = this.ownPubkey && pubkeyA === this.ownPubkey ? pubkeyB :
              this.ownPubkey && pubkeyB === this.ownPubkey ? pubkeyA :
              pubkeyB;

            const peerId = await this.mapper.mapPubkey(peerPubkey);
            if(stored.mid == null) {
              console.error(LOG_PREFIX, 'searchMessages: stored message missing mid — upstream write path is broken', {eventId: stored.eventId, timestamp: stored.timestamp});
              throw new Error('StoredMessage.mid is required (searchMessages)');
            }
            const mid = stored.mid;
            const isOutgoing = stored.isOutgoing ?? (stored.senderPubkey === this.ownPubkey);
            const fromPeerId = isOutgoing ? undefined : peerId;

            const msg = this.mapper.createTwebMessage({
              mid,
              peerId,
              fromPeerId,
              date: stored.timestamp,
              text: stored.content,
              isOutgoing
            });
            messages.push(msg);

            if(!usersById.has(peerId)) {
              const searchMapping = await getMapping(peerPubkey);
              const user = this.mapper.createTwebUser({peerId, firstName: searchMapping?.displayName, pubkey: peerPubkey});
              usersById.set(peerId, user);
              users.push(user);
            }
          }
        } catch(err) {
          console.warn(LOG_PREFIX, 'searchMessages: failed for conversation', convId, err);
        }
      }
    } catch(err) {
      console.warn(LOG_PREFIX, 'searchMessages: failed to get conversation IDs', err);
    }

    return {
      _: 'messages.messages',
      messages,
      users,
      chats: [],
      count: messages.length
    };
  }

  private async getContacts(): Promise<any> {
    const store = getMessageStore();
    const contacts: any[] = [];
    const users: any[] = [];

    try {
      const conversationIds = await store.getAllConversationIds();

      for(const convId of conversationIds) {
        try {
          const [pubkeyA, pubkeyB] = convId.split(':');
          const peerPubkey = this.ownPubkey && pubkeyA === this.ownPubkey ? pubkeyB :
            this.ownPubkey && pubkeyB === this.ownPubkey ? pubkeyA :
            pubkeyB;

          const peerId = await this.mapper.mapPubkey(peerPubkey);
          const peerMapping = await getMapping(peerPubkey);
          const user = this.mapper.createTwebUser({peerId, firstName: peerMapping?.displayName, pubkey: peerPubkey});

          contacts.push({
            _: 'contact',
            user_id: peerId,
            mutual: false
          });
          users.push(user);
        } catch(err) {
          console.warn(LOG_PREFIX, 'getContacts: failed for conversation', convId, err);
        }
      }
    } catch(err) {
      console.warn(LOG_PREFIX, 'getContacts: failed to get conversation IDs', err);
    }

    return {
      _: 'contacts.contacts',
      contacts,
      saved_count: 0,
      users
    };
  }

  private async getFullUser(params: any): Promise<any> {
    const peerId = extractPeerId(params?.id) ?? extractPeerId(params);
    if(peerId === null) {
      return {_: 'users.userFull', users: [], full_user: {_: 'userFull', pFlags: {}}};
    }

    const absPeerId = Math.abs(peerId);
    const pubkey = await getPubkey(absPeerId) ?? '';
    const mapping = await getMapping(pubkey);
    const user = this.mapper.createTwebUser({peerId: absPeerId, firstName: mapping?.displayName, pubkey});

    // Hydrate `about` from cache and fire background refresh. The refresh
    // lands via nostra_peer_profile_updated and is consumed by the
    // peerNostraProfile store, which drives the User Info rows directly.
    let about = '';
    if(pubkey) {
      const cached = loadCachedPeerProfile(pubkey);
      if(cached?.profile.about) about = cached.profile.about;
      // Fire-and-forget — do NOT await; UI updates via rootScope event.
      refreshPeerProfileFromRelays(pubkey, absPeerId as unknown as PeerId).catch(swallowHandler('VirtualMTProto.refreshPeerProfile'));
    }

    return {
      _: 'users.userFull',
      users: [user],
      full_user: {
        _: 'userFull',
        id: absPeerId,
        pFlags: {},
        settings: {_: 'peerSettings', pFlags: {}},
        profile_photo: {_: 'photoEmpty', id: 0},
        notify_settings: {_: 'peerNotifySettings', pFlags: {}},
        common_chats_count: 0,
        about
      }
    };
  }

  private async getUsers(params: any): Promise<any[]> {
    const ids: any[] = params?.id || [];
    const users: any[] = [];
    for(const inputUser of ids) {
      const userId = inputUser?.user_id ?? inputUser;
      if(!userId) continue;
      const pubkey = await getPubkey(userId);
      if(!pubkey) continue;
      const userMapping = await getMapping(pubkey);
      const user = this.mapper.createTwebUser({peerId: userId, firstName: userMapping?.displayName, pubkey});
      users.push(user);
    }
    return users;
  }

  private async sendMessage(params: any): Promise<any> {
    const emptyUpdates = {
      _: 'updates',
      updates: [] as any[],
      users: [] as any[],
      chats: [] as any[],
      date: Math.floor(Date.now() / 1000),
      seq: 0
    };

    if(!this.chatAPI || !this.ownPubkey) return emptyUpdates;

    const peerId = extractPeerId(params?.peer);
    if(peerId === null) return emptyUpdates;

    const peerPubkey = await getPubkey(Math.abs(peerId));
    if(!peerPubkey) return emptyUpdates;

    try {
      if(this.chatAPI.getActivePeer() !== peerPubkey) {
        await this.chatAPI.connect(peerPubkey);
      }

      // Pass `twebPeerId` + `timestampSec` via the sendText opts so ChatAPI's
      // internal partial save carries twebPeerId + isOutgoing:true AND pins
      // its row timestamp to the SAME second VMT will use below. The second
      // save adds `mid`. Pinning the timestamp is critical: if a downstream
      // consumer (getDialogs / getHistory / refreshDialogPreview) observes
      // the partial row BEFORE the mid-carrying save merges, the
      // `latest.mid ?? await mapEventId(latest.eventId, latest.timestamp)`
      // fallback must compute the IDENTICAL mid VMT writes here. Otherwise
      // the mirror gains a ghost mid with no IDB counterpart (FIND-e49755c1
      // residual).
      const text = params?.message ?? '';
      const twebPeerId = Math.abs(peerId);
      const now = Math.floor(Date.now() / 1000);

      const eventId: string = await this.chatAPI.sendText(text, {twebPeerId, timestampSec: now});
      const mid = await this.mapper.mapEventId(eventId, now);

      const store = getMessageStore();
      const conversationId = store.getConversationId(this.ownPubkey, peerPubkey);

      // Authoritative save with mid. Merges with ChatAPI's earlier partial
      // row via message-store.ts:132-143.
      await store.saveMessage({
        eventId,
        conversationId,
        senderPubkey: this.ownPubkey,
        content: text,
        type: 'text',
        timestamp: now,
        deliveryState: 'sent',
        mid,
        twebPeerId,
        isOutgoing: true
      });

      // Inject the outgoing bubble directly into the main-thread bubble
      // pipeline. This is the ONLY history_append dispatch path for P2P
      // sends — beforeMessageSending on the Worker side is skipped for
      // P2P peers to avoid duplicate renders.
      await this.injectOutgoingBubble({
        peerId: Math.abs(peerId),
        mid,
        date: now,
        text,
        senderPubkey: this.ownPubkey
      });

      // Return the mid and date so the Worker's P2P shortcut can
      // re-assign the message's id from the temp value (0.0001) to the
      // real timestamp-based mid.
      return {
        _: 'updates',
        updates: [],
        users: [],
        chats: [],
        date: now,
        seq: 0,
        nostraMid: mid,
        nostraEventId: eventId
      };
    } catch(err) {
      console.warn(LOG_PREFIX, 'sendMessage: failed', err);
      return emptyUpdates;
    }
  }

  private async editMessage(params: any): Promise<any> {
    const emptyUpdates = {
      _: 'updates',
      updates: [] as any[],
      users: [] as any[],
      chats: [] as any[],
      date: Math.floor(Date.now() / 1000),
      seq: 0
    };

    if(!this.chatAPI || !this.ownPubkey) return emptyUpdates;

    const peerId = extractPeerId(params?.peer);
    if(peerId === null) return emptyUpdates;

    const peerPubkey = await getPubkey(Math.abs(peerId));
    if(!peerPubkey) return emptyUpdates;

    const mid: number = params?.id;
    const newText: string = params?.message ?? '';
    if(typeof mid !== 'number') return emptyUpdates;

    try {
      const store = getMessageStore();
      const original = await store.getByMid(mid);
      if(!original) {
        console.warn(LOG_PREFIX, 'editMessage: original mid not in store', mid);
        return emptyUpdates;
      }
      if(original.senderPubkey !== this.ownPubkey) {
        console.warn(LOG_PREFIX, 'editMessage: refusing to edit non-own message');
        return emptyUpdates;
      }

      // For sender rows the eventId column carries the app-level message id
      // (chat-XXX-N). For receiver rows that would not be true, but we already
      // verified senderPubkey == ownPubkey, so this is always sender-side here.
      const originalAppMessageId = original.appMessageId || original.eventId;

      // Make sure the active peer is correct so the relay subscription is wired
      if(this.chatAPI.getActivePeer() !== peerPubkey) {
        await this.chatAPI.connect(peerPubkey);
      }

      const ok = await this.chatAPI.editMessage(originalAppMessageId, newText);
      if(!ok) {
        console.warn(LOG_PREFIX, 'editMessage: chatAPI.editMessage returned false');
        // Fall through anyway: local store + UI were updated by ChatAPI
      }

      // Patch the main-thread mirror so the bubble re-renders immediately,
      // then dispatch tweb's message_edit event for bubbles.ts to pick up.
      try {
        const apiProxy: any = (await import('@config/debug')).MOUNT_CLASS_TO.apiManagerProxy;
        const storageKey = `${Math.abs(peerId)}_history`;
        const existing = apiProxy?.mirrors?.messages?.[storageKey]?.[mid];
        if(existing) {
          existing.message = newText;
          existing.edit_date = Math.floor(Date.now() / 1000);
        }

        const rs: any = (await import('@lib/rootScope')).default;
        if(typeof rs.dispatchEventSingle === 'function') {
          rs.dispatchEventSingle('message_edit', {
            storageKey,
            peerId: Math.abs(peerId),
            mid,
            message: existing || {mid, peerId: Math.abs(peerId), message: newText, edit_date: Math.floor(Date.now() / 1000)}
          });
        }
      } catch(e: any) { console.debug(LOG_PREFIX, 'editMessage local dispatch failed:', e?.message); }

      return {
        _: 'updates',
        updates: [],
        users: [],
        chats: [],
        date: Math.floor(Date.now() / 1000),
        seq: 0,
        nostraMid: mid,
        nostraEventId: originalAppMessageId,
        nostraEdit: true
      };
    } catch(err) {
      console.warn(LOG_PREFIX, 'editMessage: failed', err);
      return emptyUpdates;
    }
  }

  /**
   * messages.sendReaction — route to kind-7 via nostraReactionsPublish.
   *
   * Extracts `peerId`, `mid`, and `emoji` from the tweb-shaped params,
   * resolves the target message's relay event id + sender pubkey via
   * `getMessageByPeerMid`, then invokes `nostraReactionsPublish.publish`.
   * Always returns an empty tweb `updates` envelope — the UI reads the
   * reactions store, not the MTProto response.
   */
  private async sendReaction(params: any): Promise<any> {
    const emptyUpdates: any = {
      _: 'updates',
      updates: [],
      users: [],
      chats: [],
      date: Math.floor(Date.now() / 1000),
      seq: 0
    };

    const peerId = Number(params?.message?.peerId);
    const mid = Number(params?.message?.mid);
    const emoji = params?.reaction?.emoticon || '';

    if(!Number.isFinite(peerId) || !Number.isFinite(mid)) return emptyUpdates;

    const resolved = await this.getMessageByPeerMid(peerId, mid);
    if(!resolved?.relayEventId) {
      console.warn(LOG_PREFIX, 'sendReaction: target message not found', {peerId, mid});
      return emptyUpdates;
    }

    try {
      const {nostraReactionsPublish} = await import('./nostra-reactions-publish');
      await nostraReactionsPublish.publish({
        targetEventId: resolved.relayEventId,
        targetMid: mid,
        targetPeerId: peerId,
        targetAuthor: resolved.senderPubkey,
        emoji
      });
    } catch(e) {
      console.warn(LOG_PREFIX, 'sendReaction: publish failed', e);
    }

    return emptyUpdates;
  }

  /**
   * Inject an outgoing message bubble into the main-thread bubble pipeline.
   * Used by sendMessage to render the bubble on the sender side with the
   * real timestamp-based mid. beforeMessageSending on the Worker skips
   * its history_append dispatch for P2P peers, so this is the sole render
   * path for P2P outgoing messages.
   */
  private async injectOutgoingBubble(params: {
    peerId: number;
    mid: number;
    date: number;
    text: string;
    senderPubkey: string;
    media?: {
      type: 'image' | 'video' | 'file' | 'voice';
      objectURL: string;
      mimeType: string;
      size: number;
      width?: number;
      height?: number;
      duration?: number;
      waveform?: string;
      uploading: boolean;
    };
  }): Promise<void> {
    try {
      const {peerId, mid, date, text, media} = params;

      const msg = this.mapper.createTwebMessage({
        mid,
        peerId,
        fromPeerId: undefined,
        date,
        text,
        isOutgoing: true
      });
      (msg as any).pFlags ??= {};
      (msg as any).pFlags.out = true;
      delete (msg as any).pFlags.is_outgoing;
      delete (msg as any).pending;

      if(media) {
        const attributes: any[] = [];
        if(media.type === 'voice' && typeof media.duration === 'number') {
          attributes.push({
            _: 'documentAttributeAudio',
            pFlags: {voice: true},
            duration: media.duration,
            waveform: media.waveform
          });
        }
        if(media.type === 'image' && media.width && media.height) {
          (msg as any).media = {
            _: 'messageMediaPhoto',
            pFlags: {},
            photo: {
              _: 'photo',
              id: `p2p_${mid}`,
              sizes: [{
                _: 'photoSize',
                type: 'x',
                w: media.width,
                h: media.height,
                size: media.size,
                url: media.objectURL
              }],
              url: media.objectURL,
              pFlags: {}
            }
          };
        } else {
          (msg as any).media = {
            _: 'messageMediaDocument',
            pFlags: {},
            document: {
              _: 'document',
              id: `p2p_${mid}`,
              mime_type: media.mimeType,
              size: media.size,
              url: media.objectURL,
              attributes,
              pFlags: {}
            }
          };
        }
        (msg as any).nostraUploading = media.uploading;
      }

      // Inject into main-thread mirrors so lookups find it.
      const apiProxy: any = (await import('@config/debug')).MOUNT_CLASS_TO.apiManagerProxy;
      if(apiProxy?.mirrors?.messages) {
        const storageKey = `${peerId}_history`;
        if(!apiProxy.mirrors.messages[storageKey]) apiProxy.mirrors.messages[storageKey] = {};
        apiProxy.mirrors.messages[storageKey][mid] = msg;
      }

      // Push to the Worker's history storage so bubbles.ts lookups by mid
      // succeed and subsequent getHistory calls include the message.
      try {
        const rs: any = (await import('@lib/rootScope')).default;
        await rs.managers.appMessagesManager.setMessageToStorage(
          `${peerId}_history` as any,
          msg
        );
      } catch(e: any) { console.debug(LOG_PREFIX, 'setMessageToStorage failed:', e?.message); }

      // Dispatch history_append on the main-thread rootScope. We use
      // dispatchEventSingle to fire the event LOCALLY without the
      // MessagePort forwarding (which fails in test environments where
      // the port is not initialized). bubbles.ts dedups by fullMid so
      // repeated dispatches are idempotent.
      try {
        const rs: any = (await import('@lib/rootScope')).default;
        if(typeof rs.dispatchEventSingle === 'function') {
          rs.dispatchEventSingle('history_append', {
            storageKey: `${peerId}_history`,
            message: msg,
            peerId
          });
        }
      } catch(e: any) { console.debug(LOG_PREFIX, 'history_append dispatch failed:', e?.message); }

      // Bump (or create) the sidebar dialog for the outgoing message.
      // Without this dispatch the chat list never reflects a live send —
      // a fresh conversation never appears until reload, an existing one
      // does not move to the top and its preview does not refresh.
      // Two dispatches per bridge-invariants Rule 8: the first triggers
      // sortedList.add (which returns early and skips setLastMessageN),
      // the second hits the existing-dialog branch to render the preview.
      try {
        const dialog: any = this.mapper.createTwebDialog({
          peerId,
          topMessage: mid,
          topMessageDate: date,
          unreadCount: 0
        });
        dialog.topMessage = msg;

        if(apiProxy?.mirrors?.dialogs) {
          apiProxy.mirrors.dialogs[peerId] = dialog;
        }

        const rs: any = (await import('@lib/rootScope')).default;
        const payload = new Map<any, any>([[
          (peerId as any).toPeerId ? (peerId as any).toPeerId(false) : peerId,
          {dialog}
        ]]);
        const dispatch = () => {
          if(typeof rs.dispatchEventSingle === 'function') {
            rs.dispatchEventSingle('dialogs_multiupdate', payload);
          }
        };
        dispatch();
        setTimeout(dispatch, 500);
      } catch(e: any) { console.debug(LOG_PREFIX, 'dialogs_multiupdate dispatch failed:', e?.message); }
    } catch(err) {
      console.warn(LOG_PREFIX, 'injectOutgoingBubble failed:', err);
    }
  }

  private async sendMedia(params: any): Promise<any> {
    // For the legacy MTProto path (non-P2P shortcut), extract the caption
    // and forward as a text-only send. P2P media flows through the dedicated
    // nostraSendFile bridge method instead.
    const captionParams = {
      ...params,
      message: params?.message ?? ''
    };
    return this.sendMessage(captionParams);
  }

  private async nostraSendFile(params: any): Promise<any> {
    const emptyUpdates = {
      _: 'updates',
      updates: [] as any[],
      users: [] as any[],
      chats: [] as any[],
      date: Math.floor(Date.now() / 1000),
      seq: 0
    };

    if(!this.chatAPI || !this.ownPubkey) return emptyUpdates;

    const peerId: number = Number(params?.peerId);
    if(!peerId) return emptyUpdates;

    const blob: Blob = params?.blob;
    if(!(blob instanceof Blob) || blob.size === 0) {
      console.warn(LOG_PREFIX, 'nostraSendFile: invalid blob');
      return emptyUpdates;
    }

    const peerPubkey = await getPubkey(Math.abs(peerId));
    if(!peerPubkey) return emptyUpdates;

    // Private key is held by the relay pool inside ChatAPI as raw bytes;
    // the orchestrator + blossom-upload-progress expect hex.
    const privkeyBytes: Uint8Array | null = (this.chatAPI as any)?.relayPool?.getPrivateKey?.() ?? null;
    if(!privkeyBytes || !(privkeyBytes instanceof Uint8Array) || privkeyBytes.length !== 32) {
      console.warn(LOG_PREFIX, 'nostraSendFile: no 32-byte private key on chatAPI.relayPool');
      return emptyUpdates;
    }
    const {bytesToHex} = await import('./file-crypto');
    const privkeyHex = bytesToHex(privkeyBytes);

    const type: 'image' | 'video' | 'file' | 'voice' = params?.type || 'file';
    const caption: string = params?.caption || '';
    const tempMid: number = Number(params?.tempMid);
    const width: number | undefined = params?.width;
    const height: number | undefined = params?.height;
    const duration: number | undefined = params?.duration;
    const waveform: string | undefined = params?.waveform;

    const {sendFileViaNostra} = await import('./nostra-send-file');
    const rs: any = (await import('@lib/rootScope')).default;
    const {getMessageStore} = await import('./message-store');
    const store = getMessageStore();
    const conversationId = store.getConversationId(this.ownPubkey, peerPubkey);

    const result = await sendFileViaNostra(
      {
        ownPubkey: this.ownPubkey,
        privkeyHex,
        peerPubkey,
        chatAPI: this.chatAPI as any,
        dispatch: (name: string, payload: any) => {
          if(typeof rs.dispatchEventSingle === 'function') rs.dispatchEventSingle(name, payload);
        },
        injectBubble: async(p) => {
          const objectURL = URL.createObjectURL(p.blob);
          await this.injectOutgoingBubble({
            peerId: Math.abs(p.peerId),
            mid: p.tempMid,
            date: Math.floor(Date.now() / 1000),
            text: p.caption || '',
            senderPubkey: this.ownPubkey!,
            media: {
              type: p.type,
              objectURL,
              mimeType: p.blob.type,
              size: p.blob.size,
              width: p.width,
              height: p.height,
              duration: p.duration,
              waveform: p.waveform,
              uploading: true
            }
          });
        },
        saveMessage: async(p) => {
          await store.saveMessage({
            eventId: p.eventId,
            conversationId,
            senderPubkey: this.ownPubkey!,
            content: p.content,
            type: 'file',
            timestamp: Math.floor(Date.now() / 1000),
            deliveryState: 'sent',
            mid: p.mid,
            twebPeerId: Math.abs(p.peerId),
            isOutgoing: true,
            fileMetadata: {
              url: p.url,
              sha256: p.sha256,
              mimeType: p.mimeType,
              size: p.size,
              width: p.width,
              height: p.height,
              keyHex: p.keyHex,
              ivHex: p.ivHex,
              duration: p.duration,
              waveform: p.waveform
            }
          });
        },
        log: Object.assign(
          (...a: any[]) => console.log(LOG_PREFIX, ...a),
          {
            warn: (...a: any[]) => console.warn(LOG_PREFIX, ...a),
            error: (...a: any[]) => console.error(LOG_PREFIX, ...a)
          }
        )
      },
      {
        peerId: Math.abs(peerId),
        blob, type, caption, tempMid,
        width, height, duration, waveform
      }
    );

    if(!result.ok) {
      return emptyUpdates;
    }
    return {
      _: 'updates',
      updates: [],
      users: [],
      chats: [],
      date: Math.floor(Date.now() / 1000),
      seq: 0,
      nostraMid: result.mid,
      nostraEventId: result.eventId
    };
  }

  private async deleteMessages(params: any): Promise<any> {
    const mids: number[] = params?.id || [];
    // Delete from message-store
    if(mids.length) {
      try {
        const store = getMessageStore();
        for(const mid of mids) {
          await store.deleteByMid(mid).catch((e) => console.debug('[VirtualMTProto] deleteByMid failed:', e?.message));
        }
        console.log(LOG_PREFIX, 'deleteMessages: deleted', mids.length, 'from store');
      } catch(err) {
        console.warn(LOG_PREFIX, 'deleteMessages error:', err);
      }
    }
    return {
      _: 'messages.affectedMessages',
      pts: 1,
      pts_count: mids.length
    };
  }

  private async readHistory(params: any): Promise<any> {
    const peerId = extractPeerId(params?.peer);
    const maxId = Number(params?.max_id ?? 0);

    if(peerId !== null && maxId > 0 && this.ownPubkey) {
      try {
        const absPeerId = Math.abs(peerId);
        const pubkey = await getPubkey(absPeerId);
        if(pubkey) {
          const store = getMessageStore();
          const convId = store.getConversationId(this.ownPubkey, pubkey);
          await store.setReadCursor(convId, maxId);
        }
      } catch(err) {
        console.warn(LOG_PREFIX, 'readHistory: failed to advance cursor', err);
      }
    }

    return {
      _: 'messages.affectedMessages',
      pts: 1,
      pts_count: 0
    };
  }

  private async createChat(params: any): Promise<any> {
    const emptyUpdates = {_: 'updates', updates: [] as any[], users: [] as any[], chats: [] as any[], date: Math.floor(Date.now() / 1000), seq: 0};
    const title = params?.title ?? 'Group';
    const userIds: number[] = (params?.users || []).map((u: any) => u?.user_id ?? u).filter(Boolean);

    try {
      const {getGroupStore} = await import('./group-store');
      const groupStore = getGroupStore();
      const memberPubkeys: string[] = [];
      for(const uid of userIds) {
        const pk = await getPubkey(uid);
        if(pk) memberPubkeys.push(pk);
      }
      if(this.ownPubkey) memberPubkeys.unshift(this.ownPubkey);

      const now = Math.floor(Date.now() / 1000);
      const groupId = 'group-' + Date.now();
      const peerId = -(Math.floor(Math.random() * 1e15) + 1);
      const group = {groupId, name: title, adminPubkey: this.ownPubkey || '', members: memberPubkeys, peerId, createdAt: now, updatedAt: now};
      await groupStore.save(group);

      const chatId = Math.abs(peerId);
      const chat = this.mapper.createTwebChat({chatId, title, membersCount: memberPubkeys.length, date: now});

      emptyUpdates.chats.push(chat);
      emptyUpdates.updates.push({_: 'updateNewMessage', message: {_: 'messageService', pFlags: {out: true}, id: 1, peer_id: {_: 'peerChat', chat_id: chatId}, from_id: {_: 'peerUser', user_id: 0}, date: now, action: {_: 'messageActionChatCreate', title, users: userIds}}, pts: 1, pts_count: 1});
      console.log(LOG_PREFIX, 'createChat:', title, 'members:', memberPubkeys.length);
    } catch(err) {
      console.warn(LOG_PREFIX, 'createChat failed:', err);
    }
    return emptyUpdates;
  }

  private async createChannel(params: any): Promise<any> {
    // Nostra treats channels as groups
    return this.createChat({title: params?.title ?? 'Channel', users: []});
  }

  private async inviteToChannel(params: any): Promise<any> {
    const emptyUpdates = {_: 'updates', updates: [] as any[], users: [] as any[], chats: [] as any[], date: Math.floor(Date.now() / 1000), seq: 0};
    const channelId = params?.channel?.channel_id;
    const userIds: number[] = (params?.users || []).map((u: any) => u?.user_id ?? u).filter(Boolean);

    if(!channelId || !userIds.length) return emptyUpdates;

    try {
      const {getGroupStore} = await import('./group-store');
      const groupStore = getGroupStore();
      const groups = await groupStore.getAll();
      const group = groups.find((g: any) => Math.abs(g.peerId) === channelId);
      if(!group) {
        console.warn(LOG_PREFIX, 'inviteToChannel: group not found for channelId', channelId);
        return emptyUpdates;
      }
      for(const uid of userIds) {
        const pk = await getPubkey(uid);
        if(pk && !group.members.includes(pk)) {
          group.members.push(pk);
        }
      }
      await groupStore.save(group);
      console.log(LOG_PREFIX, 'inviteToChannel:', channelId, 'added', userIds.length, 'users');
    } catch(err) {
      console.warn(LOG_PREFIX, 'inviteToChannel failed:', err);
    }
    return emptyUpdates;
  }

  private fallback(method: string, _params: any): any {
    // Action methods → return true
    for(const pattern of ACTION_PATTERNS) {
      if(method.includes(pattern)) {
        return true;
      }
    }

    // Known method shapes
    if(NOSTRA_STATIC[method]) {
      return NOSTRA_STATIC[method];
    }

    // Default
    return {pFlags: {}};
  }
}
