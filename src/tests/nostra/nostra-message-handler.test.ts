/**
 * Tests for nostra-message-handler.ts
 *
 * Verifies: message building, mirror injection, peer auto-add,
 * dialog creation, and the full handleIncomingMessage orchestration.
 */

import '../setup';
import {describe, it, expect, beforeEach, afterAll, vi} from 'vitest';

// With isolate: false, vi.mock factories persist across files.
// Explicitly unmock rootScope so later test files get the real module.
afterAll(() => {
  vi.unmock('@lib/rootScope');
  vi.unmock('@lib/nostra/nostra-peer-mapper');
  vi.unmock('@stores/peers');
  vi.unmock('@lib/nostra/nostra-bridge');
  vi.restoreAllMocks();
});

// Mock NostraPeerMapper
const mockCreateTwebMessage = vi.fn().mockReturnValue({
  _: 'message',
  mid: 2000000001,
  id: 2000000001,
  date: 1712345678,
  message: 'Hello from peer',
  pFlags: {out: false}
});

const mockCreateTwebUser = vi.fn().mockReturnValue({
  _: 'user',
  id: 1000000000000001,
  first_name: 'npub...aabbccdd',
  pFlags: {}
});

const mockCreateTwebDialog = vi.fn().mockReturnValue({
  _: 'dialog',
  peerId: 1000000000000001,
  top_message: 2000000001,
  unread_count: 1,
  pFlags: {}
});

vi.mock('@lib/nostra/nostra-peer-mapper', () => ({
  NostraPeerMapper: vi.fn().mockImplementation(() => ({
    createTwebMessage: mockCreateTwebMessage,
    createTwebUser: mockCreateTwebUser,
    createTwebDialog: mockCreateTwebDialog
  }))
}));

// Mock rootScope
const mockDispatchEvent = vi.fn();
const mockSetMessageToStorage = vi.fn().mockResolvedValue(undefined);
const mockInvalidateHistoryCache = vi.fn().mockResolvedValue(undefined);

vi.mock('@lib/rootScope', () => ({
  default: {
    dispatchEvent: (...args: any[]) => mockDispatchEvent(...args),
    managers: {
      appMessagesManager: {
        setMessageToStorage: (...args: any[]) => mockSetMessageToStorage(...args),
        invalidateHistoryCache: (...args: any[]) => mockInvalidateHistoryCache(...args)
      },
      appUsersManager: {
        injectP2PUser: vi.fn().mockResolvedValue(undefined)
      }
    }
  }
}));

// MOUNT_CLASS_TO is a mutable singleton — set mirrors directly in beforeEach

// Mock stores/peers
vi.mock('@stores/peers', () => ({
  reconcilePeer: vi.fn()
}));

// Mock nostra-bridge
vi.mock('@lib/nostra/nostra-bridge', () => ({
  NostraBridge: {
    getInstance: () => ({
      deriveAvatarFromPubkeySync: vi.fn().mockReturnValue('avatar-hash')
    })
  }
}));

import {
  buildTwebMessage,
  buildTwebDialog,
  injectIntoMirrors,
  dispatchDialogUpdate,
  handleIncomingMessage
} from '@lib/nostra/nostra-message-handler';
import {MOUNT_CLASS_TO} from '@config/debug';

const OWN_PUBKEY = 'aaaa'.repeat(16);
const SENDER_PUBKEY = 'bbbb'.repeat(16);
const PEER_ID = 1000000000000001;

const makeData = () => ({
  senderPubkey: SENDER_PUBKEY,
  peerId: PEER_ID,
  mid: 2000000001,
  timestamp: 1712345678,
  message: {content: 'Hello from peer'}
});

describe('nostra-message-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up MOUNT_CLASS_TO mirrors directly on the mutable singleton
    MOUNT_CLASS_TO.apiManagerProxy = {
      mirrors: {messages: {}, peers: {}}
    };
  });

  describe('buildTwebMessage', () => {
    it('creates a tweb message from incoming data', () => {
      const result = buildTwebMessage(makeData());
      expect(mockCreateTwebMessage).toHaveBeenCalledWith({
        mid: 2000000001,
        peerId: PEER_ID,
        fromPeerId: PEER_ID,
        date: 1712345678,
        text: 'Hello from peer',
        isOutgoing: false
      });
      expect(result).toBeDefined();
      expect(result.mid).toBe(2000000001);
    });
  });

  describe('buildTwebDialog', () => {
    it('creates dialog with topMessage as msg object', () => {
      const msg = {mid: 2000000001, id: 2000000001, date: 1712345678};
      const dialog = buildTwebDialog(PEER_ID, msg, 1712345678);
      expect(mockCreateTwebDialog).toHaveBeenCalled();
      // topMessage should be the msg object, not just the ID
      expect(dialog.topMessage).toBe(msg);
    });
  });

  describe('injectIntoMirrors', () => {
    it('injects message into messages mirror', async() => {
      const msg = {mid: 2000000001, id: 2000000001};
      await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

      const storageKey = `${PEER_ID}_history`;
      expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.messages[storageKey]).toBeDefined();
      expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.messages[storageKey][2000000001]).toBe(msg);
    });

    it('pushes to Worker storage via setMessageToStorage', async() => {
      const msg = {mid: 2000000001, id: 2000000001};
      await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

      expect(mockSetMessageToStorage).toHaveBeenCalledWith(
        `${PEER_ID}_history`,
        msg
      );
    });

    it('auto-adds unknown sender as peer', async() => {
      const msg = {mid: 2000000001, id: 2000000001};
      const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

      expect(result.isNewPeer).toBe(true);
      expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.peers[PEER_ID]).toBeDefined();
      expect(mockCreateTwebUser).toHaveBeenCalled();
    });

    it('skips peer creation if peer already exists', async() => {
      MOUNT_CLASS_TO.apiManagerProxy.mirrors.peers[PEER_ID] = {_: 'user', id: PEER_ID};
      const msg = {mid: 2000000001, id: 2000000001};
      const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

      expect(result.isNewPeer).toBe(false);
      expect(mockCreateTwebUser).not.toHaveBeenCalled();
    });
  });

  describe('dispatchDialogUpdate', () => {
    it('dispatches dialogs_multiupdate immediately', () => {
      const dialog = {_: 'dialog'};
      dispatchDialogUpdate(PEER_ID, dialog);

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        'dialogs_multiupdate',
        expect.any(Map)
      );
    });
  });

  describe('handleIncomingMessage', () => {
    it('returns null for own echo', async() => {
      const data = makeData();
      data.senderPubkey = OWN_PUBKEY;
      const result = await handleIncomingMessage(data, OWN_PUBKEY);
      expect(result).toBeNull();
    });

    it('builds message, injects mirrors, dispatches events', async() => {
      const result = await handleIncomingMessage(makeData(), OWN_PUBKEY);

      expect(result).not.toBeNull();
      expect(result!.peerId).toBe(PEER_ID);
      expect(result!.msg).toBeDefined();
      expect(result!.dialog).toBeDefined();

      // Should have dispatched history_append
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        'history_append',
        expect.objectContaining({peerId: PEER_ID})
      );

      // Should have dispatched dialogs_multiupdate
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        'dialogs_multiupdate',
        expect.any(Map)
      );

      // Should have invalidated history cache
      expect(mockInvalidateHistoryCache).toHaveBeenCalledWith(PEER_ID);
    });
  });
});
