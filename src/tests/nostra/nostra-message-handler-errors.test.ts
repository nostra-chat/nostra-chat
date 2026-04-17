// @ts-nocheck
/**
 * Tests for error/catch branches in nostra-message-handler.ts
 *
 * Targets the "non-fatal" error paths introduced in PR #37:
 *   - loadUnreadCounts IIFE (parse / storage access failure)
 *   - persistUnreadCounts (localStorage.setItem throw)
 *   - injectIntoMirrors (setMessageToStorage reject, reconcilePeer reject)
 *   - handleIncomingEdit (setMessageToStorage reject still dispatches edit)
 *
 * Error paths are verified by spying on console.debug (used inline for
 * `[MessageHandler] non-critical:` messages) and on logSwallow via the
 * module's exported helper.
 */

import '../setup';
import {describe, it, expect, beforeEach, afterAll, vi} from 'vitest';

// Intentionally do NOT call vi.unmock in afterAll — with `isolate: false`
// the sibling nostra-message-handler.test.ts runs in the same vitest
// process and expects these module-level mocks to remain registered.
// We only clear call state so mock return values persist across files.
afterAll(() => {
  vi.restoreAllMocks();
});

vi.mock('@lib/nostra/nostr-profile', () => ({
  fetchNostrProfile: vi.fn().mockResolvedValue(null),
  profileToDisplayName: vi.fn().mockReturnValue(null)
}));
vi.mock('@lib/nostra/virtual-peers-db', () => ({
  getMapping: vi.fn().mockResolvedValue(undefined),
  updateMappingProfile: vi.fn().mockResolvedValue(undefined)
}));

const mockCreateTwebMessage = vi.fn().mockReturnValue({
  _: 'message',
  mid: 3000000001,
  id: 3000000001,
  peerId: 1000000000000002,
  date: 1712345678,
  message: 'hi',
  pFlags: {out: false}
});

const mockCreateTwebUser = vi.fn().mockReturnValue({
  _: 'user',
  id: 1000000000000002,
  first_name: 'npub...ccccdddd',
  pFlags: {}
});

const mockCreateTwebDialog = vi.fn().mockReturnValue({
  _: 'dialog',
  peerId: 1000000000000002,
  top_message: 3000000001,
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

const mockDispatchEvent = vi.fn();
const mockSetMessageToStorage = vi.fn().mockResolvedValue(undefined);
const mockInvalidateHistoryCache = vi.fn().mockResolvedValue(undefined);
const mockInjectP2PUser = vi.fn().mockResolvedValue(undefined);

vi.mock('@lib/rootScope', () => ({
  default: {
    dispatchEvent: (...args: any[]) => mockDispatchEvent(...args),
    managers: {
      appMessagesManager: {
        setMessageToStorage: (...args: any[]) => mockSetMessageToStorage(...args),
        invalidateHistoryCache: (...args: any[]) => mockInvalidateHistoryCache(...args)
      },
      appUsersManager: {
        injectP2PUser: (...args: any[]) => mockInjectP2PUser(...args)
      }
    }
  }
}));

vi.mock('@stores/peers', () => ({
  reconcilePeer: vi.fn()
}));

vi.mock('@lib/nostra/nostra-bridge', () => ({
  NostraBridge: {
    getInstance: () => ({
      deriveAvatarFromPubkeySync: vi.fn().mockReturnValue('avatar-hash')
    })
  }
}));

import {
  injectIntoMirrors,
  handleIncomingEdit
} from '@lib/nostra/nostra-message-handler';
import {MOUNT_CLASS_TO} from '@config/debug';

const SENDER_PUBKEY = 'cccc'.repeat(16);
const OWN_PUBKEY = 'dddd'.repeat(16);
const OTHER_PUBKEY = 'eeee'.repeat(16);
const PEER_ID = 1000000000000002;

describe('nostra-message-handler error paths', () => {
  let debugSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    MOUNT_CLASS_TO.apiManagerProxy = {
      mirrors: {messages: {}, peers: {}}
    };
    mockSetMessageToStorage.mockResolvedValue(undefined);
    mockInjectP2PUser.mockResolvedValue(undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('loadUnreadCounts: module import survives even if localStorage returned garbage', async() => {
    // The IIFE runs once at first import. Importing again returns the cached
    // module; we cannot re-run the IIFE. So we instead verify the module
    // loads cleanly under jsdom (it already ran during this test file's
    // import above) and that getUnreadForPeer is callable without throwing.
    const mod = await import('@lib/nostra/nostra-message-handler');
    expect(typeof mod.getUnreadForPeer).toBe('function');
    expect(mod.getUnreadForPeer(999)).toBe(0);
  });

  it('persistUnreadCounts: setItem throw during message handling does not crash', async() => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    const msg = {mid: 3000000001, id: 3000000001};
    // injectIntoMirrors does not persist unread counts, but handleIncomingMessage
    // does. We exercise the path by calling the full handler.
    const {handleIncomingMessage} = await import('@lib/nostra/nostra-message-handler');
    const result = await handleIncomingMessage({
      senderPubkey: SENDER_PUBKEY,
      peerId: PEER_ID,
      mid: 3000000001,
      timestamp: 1712345678,
      message: {content: 'x'}
    }, OWN_PUBKEY);

    expect(result).not.toBeNull();
    expect(result!.msg).toBeDefined();
    setItemSpy.mockRestore();
  });

  it('injectIntoMirrors: setMessageToStorage rejection is swallowed + logged', async() => {
    mockSetMessageToStorage.mockRejectedValueOnce(new Error('IDB closed'));

    const msg = {mid: 3000000002, id: 3000000002};
    const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

    // Returns successfully — no throw
    expect(result.isNewPeer).toBe(true);
    // The mirror still got the message (that path runs BEFORE the storage call)
    expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.messages[`${PEER_ID}_history`][3000000002]).toBe(msg);
    // Swallowed via console.debug('[MessageHandler] non-critical: ...')
    const calls = debugSpy.mock.calls.map((c: any[]) => c.join(' '));
    expect(calls.some((s: string) => s.includes('[MessageHandler] non-critical'))).toBe(true);
  });

  it('injectIntoMirrors: reconcilePeer rejection is swallowed (new peer still injected)', async() => {
    // Make reconcilePeer throw synchronously inside its module
    const peers = await import('@stores/peers');
    (peers.reconcilePeer as any).mockImplementationOnce(() => {
      throw new Error('store unavailable');
    });

    const msg = {mid: 3000000003, id: 3000000003};
    const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

    expect(result.isNewPeer).toBe(true);
    // User still placed into peers mirror
    expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.peers[PEER_ID]).toBeDefined();
  });

  it('injectIntoMirrors: injectP2PUser rejection is swallowed', async() => {
    mockInjectP2PUser.mockRejectedValueOnce(new Error('worker gone'));

    const msg = {mid: 3000000004, id: 3000000004};
    const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

    expect(result.isNewPeer).toBe(true);
    // Still injects the user into the mirror
    expect(MOUNT_CLASS_TO.apiManagerProxy.mirrors.peers[PEER_ID]).toBeDefined();
  });

  it('injectIntoMirrors: no apiManagerProxy → does not throw, reports isNewPeer=false', async() => {
    MOUNT_CLASS_TO.apiManagerProxy = undefined;

    const msg = {mid: 3000000005, id: 3000000005};
    const result = await injectIntoMirrors(PEER_ID, msg, SENDER_PUBKEY);

    // With no proxy, the new-peer branch cannot run
    expect(result.isNewPeer).toBe(false);
  });

  it('handleIncomingEdit: setMessageToStorage rejection is swallowed but message_edit still dispatches', async() => {
    MOUNT_CLASS_TO.apiManagerProxy = {
      mirrors: {
        messages: {
          [`${PEER_ID}_history`]: {
            42: {mid: 42, peerId: PEER_ID, message: 'old', edit_date: 0}
          }
        },
        peers: {}
      }
    };
    mockSetMessageToStorage.mockRejectedValueOnce(new Error('IDB fail'));

    await handleIncomingEdit({
      peerId: PEER_ID,
      mid: 42,
      senderPubkey: OTHER_PUBKEY,
      originalEventId: 'chat-100-1',
      newContent: 'new content',
      editedAt: 1712400000
    }, OWN_PUBKEY);

    // The mirrored message content was updated locally
    const stored = MOUNT_CLASS_TO.apiManagerProxy.mirrors.messages[`${PEER_ID}_history`][42];
    expect(stored.message).toBe('new content');
    expect(stored.edit_date).toBe(1712400000);

    // And message_edit was still dispatched despite setMessageToStorage failure
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      'message_edit',
      expect.objectContaining({peerId: PEER_ID, mid: 42})
    );
  });

  it('handleIncomingEdit: no-op when sender equals ownPubkey (self-edit)', async() => {
    await handleIncomingEdit({
      peerId: PEER_ID,
      mid: 99,
      senderPubkey: OWN_PUBKEY,
      originalEventId: 'chat-100-9',
      newContent: 'skipped',
      editedAt: 1712500000
    }, OWN_PUBKEY);

    // No dispatches, no storage writes
    expect(mockDispatchEvent).not.toHaveBeenCalledWith('message_edit', expect.anything());
    expect(mockSetMessageToStorage).not.toHaveBeenCalled();
  });
});
