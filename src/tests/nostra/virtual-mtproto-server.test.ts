/**
 * Tests for NostraMTProtoServer
 *
 * Verifies that handleMethod routes to correct handlers and returns
 * properly-shaped MTProto responses built from mocked store data.
 */

import '../setup';
import {describe, it, expect, vi, beforeEach} from 'vitest';

// ─── Polyfills ────────────────────────────────────────────────────────

if(!(Number.prototype as any).toPeerId) {
  (Number.prototype as any).toPeerId = function(isChat?: boolean) {
    return isChat ? -Math.abs(this as number) : Math.abs(this as number);
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────

const PEER_PUBKEY = 'aabbcc0011223344aabbcc0011223344aabbcc0011223344aabbcc0011223344';
const OWN_PUBKEY = '1122334455667788112233445566778811223344556677881122334455667788';
const CONVERSATION_ID = [OWN_PUBKEY, PEER_PUBKEY].sort().join(':');
const PEER_ID = 1234567890123456;
const MID = 999000000001;

const mockMessage = {
  eventId: 'ev001',
  conversationId: CONVERSATION_ID,
  senderPubkey: PEER_PUBKEY,
  content: 'hello world',
  type: 'text' as const,
  timestamp: 1700000000,
  deliveryState: 'delivered' as const,
  mid: MID,
  twebPeerId: PEER_ID,
  isOutgoing: false
};

// Hoisted mock references for resetModules/doMock pattern
const mockStore = vi.hoisted(() => ({
  getAllConversationIds: vi.fn(),
  getMessages: vi.fn(),
  getConversationId: vi.fn((a: string, b: string) => [a, b].sort().join(':')),
  saveMessage: vi.fn(),
  deleteByMid: vi.fn(),
  getReadCursor: vi.fn(),
  setReadCursor: vi.fn(),
  countUnread: vi.fn()
}));

const mockGetPubkey = vi.hoisted(() => vi.fn());

vi.mock('@lib/nostra/message-store', () => ({
  getMessageStore: () => mockStore
}));

vi.mock('@lib/nostra/virtual-peers-db', () => ({
  getPubkey: mockGetPubkey,
  getMapping: vi.fn(),
  getDB: vi.fn(),
  storeMapping: vi.fn(),
  getAllMappings: vi.fn().mockResolvedValue([]),
  removeMapping: vi.fn(),
  updateMappingProfile: vi.fn()
}));

// peer-profile-cache mock — prevents real WebSocket connections in tests
vi.mock('@lib/nostra/peer-profile-cache', () => ({
  loadCachedPeerProfile: vi.fn().mockReturnValue(null),
  refreshPeerProfileFromRelays: vi.fn().mockResolvedValue(undefined),
  saveCachedPeerProfile: vi.fn(),
  clearPeerProfileCache: vi.fn()
}));

// group-store dynamic import mock
vi.mock('@lib/nostra/group-store', () => ({
  getGroupStore: () => ({
    getAll: vi.fn().mockResolvedValue([]),
    getByPeerId: vi.fn().mockResolvedValue(null)
  })
}));

// NostraBridge mock for mapper.mapPubkey / mapper.mapEventId
vi.mock('@lib/nostra/nostra-bridge', () => ({
  NostraBridge: {
    getInstance: () => ({
      mapPubkeyToPeerId: vi.fn().mockResolvedValue(1234567890123456),
      mapEventIdToMid: vi.fn().mockResolvedValue(999000000001)
    })
  }
}));

// ─── Dynamic module loading ──────────────────────────────────────────

let NostraMTProtoServer: any;
let getMessageStore: any;
let getPubkey: any;

beforeAll(async() => {
  // Re-register mocks via doMock to override any contamination from
  // other test files (e.g. message-requests.test.ts mocks virtual-peers-db
  // with only getDB, missing getPubkey/getMapping).
  vi.resetModules();

  vi.doMock('@lib/nostra/message-store', () => ({
    getMessageStore: () => mockStore
  }));
  vi.doMock('@lib/nostra/virtual-peers-db', () => ({
    getPubkey: mockGetPubkey,
    getMapping: vi.fn(),
    getDB: vi.fn(),
    storeMapping: vi.fn(),
    getAllMappings: vi.fn().mockResolvedValue([]),
    removeMapping: vi.fn(),
    updateMappingProfile: vi.fn()
  }));
  vi.doMock('@lib/nostra/peer-profile-cache', () => ({
    loadCachedPeerProfile: vi.fn().mockReturnValue(null),
    refreshPeerProfileFromRelays: vi.fn().mockResolvedValue(undefined),
    saveCachedPeerProfile: vi.fn(),
    clearPeerProfileCache: vi.fn()
  }));
  vi.doMock('@lib/nostra/group-store', () => ({
    getGroupStore: () => ({
      getAll: vi.fn().mockResolvedValue([]),
      getByPeerId: vi.fn().mockResolvedValue(null)
    })
  }));
  vi.doMock('@lib/nostra/nostra-bridge', () => ({
    NostraBridge: {
      getInstance: () => ({
        mapPubkeyToPeerId: vi.fn().mockResolvedValue(1234567890123456),
        mapEventIdToMid: vi.fn().mockResolvedValue(999000000001)
      })
    }
  }));

  const serverMod = await import('@lib/nostra/virtual-mtproto-server');
  NostraMTProtoServer = serverMod.NostraMTProtoServer;

  const storeMod = await import('@lib/nostra/message-store');
  getMessageStore = storeMod.getMessageStore;

  const peersMod = await import('@lib/nostra/virtual-peers-db');
  getPubkey = peersMod.getPubkey;
});

afterAll(() => {
  vi.unmock('@lib/nostra/peer-profile-cache');
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────

describe('NostraMTProtoServer', () => {
  let server: any;

  beforeEach(() => {
    server = new NostraMTProtoServer();
    server.setOwnPubkey(OWN_PUBKEY);
    vi.clearAllMocks();

    mockStore.getAllConversationIds.mockResolvedValue([CONVERSATION_ID]);
    mockStore.getMessages.mockResolvedValue([mockMessage]);
    mockStore.getReadCursor.mockResolvedValue(0);
    mockStore.countUnread.mockResolvedValue(0);
    mockStore.setReadCursor.mockResolvedValue(undefined);

    mockGetPubkey.mockResolvedValue(PEER_PUBKEY);
  });

  // ─── getDialogs ───────────────────────────────────────────────────

  describe('messages.getDialogs', () => {
    it('returns proper shape with dialogs/messages/users/chats/count', async () => {
      const result = await server.handleMethod('messages.getDialogs', {});

      expect(result._).toBe('messages.dialogs');
      expect(Array.isArray(result.dialogs)).toBe(true);
      expect(Array.isArray(result.messages)).toBe(true);
      expect(Array.isArray(result.users)).toBe(true);
      expect(Array.isArray(result.chats)).toBe(true);
      expect(typeof result.count).toBe('number');
    });

    it('includes one dialog per conversation', async () => {
      const result = await server.handleMethod('messages.getDialogs', {});

      expect(result.dialogs.length).toBe(1);
      expect(result.messages.length).toBe(1);
      expect(result.users.length).toBe(1);
    });

    it('dialog has correct shape', async () => {
      const result = await server.handleMethod('messages.getDialogs', {});
      const dialog = result.dialogs[0];

      expect(dialog._).toBe('dialog');
      expect(dialog.top_message).toBe(MID);
      expect(typeof dialog.unread_count).toBe('number');
    });

    it('routes messages.getPinnedDialogs to same handler', async () => {
      const result = await server.handleMethod('messages.getPinnedDialogs', {});

      expect(result._).toBe('messages.dialogs');
      expect(Array.isArray(result.dialogs)).toBe(true);
    });

    it('returns empty arrays when no conversations', async () => {
      mockStore.getAllConversationIds.mockResolvedValue([]);
      const result = await server.handleMethod('messages.getDialogs', {});

      expect(result.dialogs).toEqual([]);
      expect(result.messages).toEqual([]);
      expect(result.users).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('propagates unread_count from store.countUnread', async () => {
      mockStore.countUnread.mockResolvedValueOnce(3);
      const result = await server.handleMethod('messages.getDialogs', {});

      expect(mockStore.countUnread).toHaveBeenCalledWith(CONVERSATION_ID, OWN_PUBKEY);
      expect(result.dialogs[0].unread_count).toBe(3);
    });

    it('propagates the read cursor into read_inbox/outbox_max_id', async () => {
      mockStore.getReadCursor.mockResolvedValueOnce(7);
      const result = await server.handleMethod('messages.getDialogs', {});

      expect(mockStore.getReadCursor).toHaveBeenCalledWith(CONVERSATION_ID);
      expect(result.dialogs[0].read_inbox_max_id).toBe(7);
      expect(result.dialogs[0].read_outbox_max_id).toBe(7);
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────

  describe('messages.getHistory', () => {
    it('returns messages for user_id peer', async () => {
      const result = await server.handleMethod('messages.getHistory', {
        peer: {_: 'inputPeerUser', user_id: PEER_ID}
      });

      expect(result._).toBe('messages.messages');
      expect(Array.isArray(result.messages)).toBe(true);
      expect(Array.isArray(result.users)).toBe(true);
      expect(Array.isArray(result.chats)).toBe(true);
    });

    it('includes message content from store', async () => {
      const result = await server.handleMethod('messages.getHistory', {
        peer: {user_id: PEER_ID}
      });

      expect(result.messages.length).toBeGreaterThan(0);
      const msg = result.messages[0];
      expect(msg._).toBe('message');
      expect(msg.message).toBe('hello world');
      expect(msg.date).toBe(1700000000);
    });

    it('returns empty when no pubkey for peerId', async () => {
      mockGetPubkey.mockResolvedValueOnce(null);

      const result = await server.handleMethod('messages.getHistory', {
        peer: {user_id: 999999}
      });

      expect(result._).toBe('messages.messages');
      expect(result.messages).toEqual([]);
    });

    it('returns empty when peer is missing', async () => {
      const result = await server.handleMethod('messages.getHistory', {});

      expect(result._).toBe('messages.messages');
      expect(result.messages).toEqual([]);
    });

    it('handles chat_id peer (negative peerId)', async () => {
      const result = await server.handleMethod('messages.getHistory', {
        peer: {_: 'inputPeerChat', chat_id: 100}
      });

      expect(result._).toBe('messages.messages');
      // Result shape should be correct regardless of found messages
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  // ─── searchMessages ───────────────────────────────────────────────

  describe('messages.search', () => {
    it('returns matching messages for query', async () => {
      const result = await server.handleMethod('messages.search', {q: 'hello'});

      expect(result._).toBe('messages.messages');
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].message).toContain('hello');
    });

    it('is case-insensitive', async () => {
      const result = await server.handleMethod('messages.search', {q: 'HELLO'});

      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('returns no matches for unrelated query', async () => {
      const result = await server.handleMethod('messages.search', {q: 'zzznomatch'});

      expect(result._).toBe('messages.messages');
      expect(result.messages).toEqual([]);
    });

    it('returns proper shape with users array', async () => {
      const result = await server.handleMethod('messages.search', {q: 'hello'});

      expect(Array.isArray(result.users)).toBe(true);
      expect(result.users.length).toBeGreaterThan(0);
    });
  });

  // ─── contacts.getContacts ─────────────────────────────────────────

  describe('contacts.getContacts', () => {
    it('returns contacts shape with users', async () => {
      const result = await server.handleMethod('contacts.getContacts', {});

      expect(result._).toBe('contacts.contacts');
      expect(Array.isArray(result.contacts)).toBe(true);
      expect(Array.isArray(result.users)).toBe(true);
      expect(typeof result.saved_count).toBe('number');
    });

    it('has one contact per conversation', async () => {
      const result = await server.handleMethod('contacts.getContacts', {});

      expect(result.contacts.length).toBe(1);
      expect(result.contacts[0]._).toBe('contact');
      expect(result.contacts[0].user_id).toBe(PEER_ID);
    });
  });

  // ─── users.getFullUser ────────────────────────────────────────────

  describe('users.getFullUser', () => {
    it('returns userFull shape', async () => {
      const result = await server.handleMethod('users.getFullUser', {
        id: {user_id: PEER_ID}
      });

      expect(result._).toBe('users.userFull');
      expect(Array.isArray(result.users)).toBe(true);
      expect(result.full_user._).toBe('userFull');
    });
  });

  // ─── Write path ───────────────────────────────────────────────────

  describe('messages.sendMessage', () => {
    const mockChatAPI = {
      getActivePeer: vi.fn().mockReturnValue('differentPeer'),
      connect: vi.fn().mockResolvedValue(undefined),
      sendText: vi.fn().mockResolvedValue('eventId123')
    };

    beforeEach(() => {
      server.setChatAPI(mockChatAPI);
      mockChatAPI.getActivePeer.mockReturnValue('differentPeer');
      mockChatAPI.connect.mockResolvedValue(undefined);
      mockChatAPI.sendText.mockResolvedValue('eventId123');

      mockStore.saveMessage = vi.fn().mockResolvedValue(undefined);
      mockStore.getConversationId = vi.fn((a: string, b: string) => [a, b].sort().join(':'));
    });

    it('calls chatAPI.sendText and returns updates shape', async () => {
      const result = await server.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'hello there',
        random_id: BigInt(42)
      });

      expect(result._).toBe('updates');
      // VMT passes twebPeerId so the initial ChatAPI IDB row already carries
      // it — closes FIND-e49755c1 (mirror/IDB drift).
      expect(mockChatAPI.sendText).toHaveBeenCalledWith('hello there', expect.objectContaining({twebPeerId: expect.any(Number)}));
      // Source returns emptyUpdates — Worker's P2P shortcut in
      // appMessagesManager handles the pending-to-sent transition
      // instead of relying on updateNewMessage from the server.
      expect(Array.isArray(result.updates)).toBe(true);
    });

    // Persistence is now ChatAPI's responsibility — VMT delegates the row
    // save entirely (production: chat-api.ts:621-635 keys by `eventId =
    // publishedRumorId`). The previous "VMT writes a second row with
    // eventId = chat-XXX-N" path was the source of FIND-4e18d35d's recurrent
    // strfry rejection; removing it is the fix. This test now just asserts
    // the delegation contract: `chatAPI.sendText` receives the same content
    // and a `twebPeerId` so its save can land the full identity triple.
    it('delegates persistence to chatAPI.sendText (no direct store write from VMT)', async () => {
      await server.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'persist me',
        random_id: BigInt(1)
      });

      expect(mockChatAPI.sendText).toHaveBeenCalledWith(
        'persist me',
        expect.objectContaining({twebPeerId: expect.any(Number), timestampSec: expect.any(Number)})
      );
      expect(mockStore.saveMessage).not.toHaveBeenCalled();
    });

    it('connects to peer if not already active', async () => {
      mockChatAPI.getActivePeer.mockReturnValue('someOtherPeer');
      await server.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'test'
      });

      expect(mockChatAPI.connect).toHaveBeenCalledWith(PEER_PUBKEY);
    });

    it('skips connect if peer already active', async () => {
      mockChatAPI.getActivePeer.mockReturnValue(PEER_PUBKEY);
      await server.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'test'
      });

      expect(mockChatAPI.connect).not.toHaveBeenCalled();
    });

    it('returns empty updates when chatAPI is not set', async () => {
      const bareServer = new NostraMTProtoServer();
      bareServer.setOwnPubkey(OWN_PUBKEY);
      // no setChatAPI call

      const result = await bareServer.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'test'
      });

      expect(result._).toBe('updates');
      expect(result.updates).toEqual([]);
    });

    it('returns empty updates when ownPubkey is not set', async () => {
      const bareServer = new NostraMTProtoServer();
      bareServer.setChatAPI(mockChatAPI);
      // no setOwnPubkey call

      const result = await bareServer.handleMethod('messages.sendMessage', {
        peer: {user_id: PEER_ID},
        message: 'test'
      });

      expect(result._).toBe('updates');
      expect(result.updates).toEqual([]);
    });
  });

  describe('messages.sendMedia', () => {
    it('returns updates shape (delegates to sendMessage with caption)', async () => {
      const mockChatAPI = {
        getActivePeer: vi.fn().mockReturnValue('differentPeer'),
        connect: vi.fn().mockResolvedValue(undefined),
        sendText: vi.fn().mockResolvedValue('mediaEventId')
      };
      server.setChatAPI(mockChatAPI);

      mockStore.saveMessage = vi.fn().mockResolvedValue(undefined);
      mockStore.getConversationId = vi.fn((a: string, b: string) => [a, b].sort().join(':'));

      const result = await server.handleMethod('messages.sendMedia', {
        peer: {user_id: PEER_ID},
        message: 'a caption'
      });

      expect(result._).toBe('updates');
      expect(Array.isArray(result.updates)).toBe(true);
    });
  });

  describe('messages.deleteMessages', () => {
    it('returns affectedMessages with correct pts_count', async () => {
      const result = await server.handleMethod('messages.deleteMessages', {
        id: [101, 102, 103]
      });

      expect(result._).toBe('messages.affectedMessages');
      expect(result.pts).toBe(1);
      expect(result.pts_count).toBe(3);
    });

    it('returns pts_count 0 when id is missing', async () => {
      const result = await server.handleMethod('messages.deleteMessages', {});

      expect(result._).toBe('messages.affectedMessages');
      expect(result.pts_count).toBe(0);
    });
  });

  describe('messages.readHistory', () => {
    it('returns affectedMessages with pts_count 0', async () => {
      const result = await server.handleMethod('messages.readHistory', {
        peer: {user_id: PEER_ID},
        max_id: 9999
      });

      expect(result._).toBe('messages.affectedMessages');
      expect(result.pts).toBe(1);
      expect(result.pts_count).toBe(0);
    });

    it('advances the read cursor via setReadCursor', async () => {
      await server.handleMethod('messages.readHistory', {
        peer: {user_id: PEER_ID},
        max_id: 42
      });

      expect(mockStore.setReadCursor).toHaveBeenCalledWith(CONVERSATION_ID, 42);
    });

    it('is a no-op when max_id is 0', async () => {
      await server.handleMethod('messages.readHistory', {
        peer: {user_id: PEER_ID},
        max_id: 0
      });

      expect(mockStore.setReadCursor).not.toHaveBeenCalled();
    });

    it('is a no-op when peer cannot be resolved', async () => {
      mockGetPubkey.mockResolvedValueOnce(null);
      await server.handleMethod('messages.readHistory', {
        peer: {user_id: 999999},
        max_id: 42
      });

      expect(mockStore.setReadCursor).not.toHaveBeenCalled();
    });

    it('round-trip: getDialogs reports unread=3, then readHistory clears, getDialogs reports 1', async () => {
      mockStore.countUnread.mockResolvedValueOnce(3);
      const before = await server.handleMethod('messages.getDialogs', {});
      expect(before.dialogs[0].unread_count).toBe(3);

      await server.handleMethod('messages.readHistory', {
        peer: {user_id: PEER_ID},
        max_id: MID - 1
      });
      expect(mockStore.setReadCursor).toHaveBeenCalledWith(CONVERSATION_ID, MID - 1);

      mockStore.countUnread.mockResolvedValueOnce(1);
      const after = await server.handleMethod('messages.getDialogs', {});
      expect(after.dialogs[0].unread_count).toBe(1);
    });
  });

  // ─── Fallback ─────────────────────────────────────────────────────

  describe('fallback', () => {
    it('unknown method returns {pFlags: {}}', async () => {
      const result = await server.handleMethod('unknown.method', {});

      expect(result).toEqual({pFlags: {}});
    });

    it('action methods return true — contains .set', async () => {
      const result = await server.handleMethod('account.setPrivacy', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .save', async () => {
      const result = await server.handleMethod('account.saveWallPaper', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .delete', async () => {
      const result = await server.handleMethod('contacts.deleteContacts', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .mark', async () => {
      const result = await server.handleMethod('messages.markDialogUnread', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .toggle', async () => {
      const result = await server.handleMethod('channels.toggleForum', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .block', async () => {
      const result = await server.handleMethod('contacts.block', {});

      expect(result).toBe(true);
    });

    it('action methods return true — contains .join', async () => {
      const result = await server.handleMethod('channels.joinChannel', {});

      expect(result).toBe(true);
    });

    it('updates.getState returns state shape', async () => {
      const result = await server.handleMethod('updates.getState', {});

      expect(result._).toBe('updates.state');
      expect(typeof result.pts).toBe('number');
    });

    it('updates.getDifference returns differenceEmpty', async () => {
      const result = await server.handleMethod('updates.getDifference', {});

      expect(result._).toBe('updates.differenceEmpty');
    });

    it('help.getConfig returns config shape', async () => {
      const result = await server.handleMethod('help.getConfig', {});

      expect(result._).toBe('config');
      expect(Array.isArray(result.dc_options)).toBe(true);
    });

    it('account.getNotifySettings returns peerNotifySettings', async () => {
      const result = await server.handleMethod('account.getNotifySettings', {});

      expect(result._).toBe('peerNotifySettings');
    });

    it('langpack.getDifference returns langPackDifference', async () => {
      const result = await server.handleMethod('langpack.getDifference', {});

      expect(result._).toBe('langPackDifference');
      expect(Array.isArray(result.strings)).toBe(true);
    });
  });
});
