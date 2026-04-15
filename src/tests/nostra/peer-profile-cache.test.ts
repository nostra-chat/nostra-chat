import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import 'fake-indexeddb/auto';

// Mock rootScope BEFORE importing the module under test so the module
// sees the mock when it calls dispatchEventSingle.
const dispatchEventSingle = vi.fn();
vi.mock('@lib/rootScope', () => ({
  default: {
    dispatchEventSingle,
    dispatchEvent: dispatchEventSingle,
    addEventListener: vi.fn()
  }
}));

// Mock queryRelayForProfileWithMeta so tests don't open sockets.
const queryRelayForProfileWithMeta = vi.fn();
vi.mock('@lib/nostra/nostr-profile', () => ({
  queryRelayForProfileWithMeta: (...args: any[]) => queryRelayForProfileWithMeta(...args)
}));

// Mock DEFAULT_RELAYS to a small deterministic list.
vi.mock('@lib/nostra/nostr-relay-pool', () => ({
  DEFAULT_RELAYS: [
    {url: 'wss://relay-a.test'},
    {url: 'wss://relay-b.test'}
  ]
}));

import {
  loadCachedPeerProfile,
  saveCachedPeerProfile,
  refreshPeerProfileFromRelays,
  clearPeerProfileCache,
  PEER_PROFILE_CACHE_PREFIX
} from '@lib/nostra/peer-profile-cache';

const PUBKEY = 'a'.repeat(64);
const PUBKEY_2 = 'b'.repeat(64);
const PEER_ID = 1000000000000001 as unknown as PeerId;

beforeEach(() => {
  localStorage.clear();
  dispatchEventSingle.mockClear();
  queryRelayForProfileWithMeta.mockReset();
});

afterEach(() => {
  localStorage.clear();
});

afterAll(() => {
  vi.unmock('@lib/rootScope');
  vi.unmock('@lib/nostra/nostr-profile');
  vi.unmock('@lib/nostra/nostr-relay-pool');
  vi.restoreAllMocks();
});

describe('loadCachedPeerProfile', () => {
  test('returns null when no entry exists', () => {
    expect(loadCachedPeerProfile(PUBKEY)).toBeNull();
  });

  test('returns parsed entry when present', () => {
    localStorage.setItem(
      PEER_PROFILE_CACHE_PREFIX + PUBKEY,
      JSON.stringify({profile: {name: 'alice', about: 'hi'}, created_at: 100})
    );
    const result = loadCachedPeerProfile(PUBKEY);
    expect(result?.profile.name).toBe('alice');
    expect(result?.profile.about).toBe('hi');
    expect(result?.created_at).toBe(100);
  });

  test('returns null on malformed JSON', () => {
    localStorage.setItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY, 'not-json');
    expect(loadCachedPeerProfile(PUBKEY)).toBeNull();
  });

  test('returns null when shape is invalid', () => {
    localStorage.setItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY, '{"profile":{}}');
    expect(loadCachedPeerProfile(PUBKEY)).toBeNull();
  });
});

describe('saveCachedPeerProfile', () => {
  test('round-trips', () => {
    saveCachedPeerProfile(PUBKEY, {profile: {website: 'https://ex.com'}, created_at: 200});
    expect(loadCachedPeerProfile(PUBKEY)?.profile.website).toBe('https://ex.com');
    expect(loadCachedPeerProfile(PUBKEY)?.created_at).toBe(200);
  });

  test('does not collide across pubkeys', () => {
    saveCachedPeerProfile(PUBKEY, {profile: {name: 'alice'}, created_at: 1});
    saveCachedPeerProfile(PUBKEY_2, {profile: {name: 'bob'}, created_at: 2});
    expect(loadCachedPeerProfile(PUBKEY)?.profile.name).toBe('alice');
    expect(loadCachedPeerProfile(PUBKEY_2)?.profile.name).toBe('bob');
  });
});

describe('refreshPeerProfileFromRelays', () => {
  test('picks highest created_at across relays and dispatches event', async() => {
    queryRelayForProfileWithMeta
      .mockResolvedValueOnce({profile: {name: 'old'}, created_at: 100, pubkey: PUBKEY})
      .mockResolvedValueOnce({profile: {name: 'new'}, created_at: 200, pubkey: PUBKEY});

    await refreshPeerProfileFromRelays(PUBKEY, PEER_ID);

    expect(loadCachedPeerProfile(PUBKEY)?.profile.name).toBe('new');
    expect(loadCachedPeerProfile(PUBKEY)?.created_at).toBe(200);

    expect(dispatchEventSingle).toHaveBeenCalledWith('nostra_peer_profile_updated', {
      peerId: PEER_ID,
      pubkey: PUBKEY,
      profile: {name: 'new'}
    });
  });

  test('does NOT write or dispatch when relay data is older than cache', async() => {
    saveCachedPeerProfile(PUBKEY, {profile: {name: 'cached'}, created_at: 500});
    queryRelayForProfileWithMeta.mockResolvedValue({profile: {name: 'old'}, created_at: 200, pubkey: PUBKEY});

    await refreshPeerProfileFromRelays(PUBKEY, PEER_ID);

    expect(loadCachedPeerProfile(PUBKEY)?.profile.name).toBe('cached');
    expect(dispatchEventSingle).not.toHaveBeenCalled();
  });

  test('does NOT write or dispatch when all relays return null', async() => {
    queryRelayForProfileWithMeta.mockResolvedValue(null);
    await refreshPeerProfileFromRelays(PUBKEY, PEER_ID);
    expect(loadCachedPeerProfile(PUBKEY)).toBeNull();
    expect(dispatchEventSingle).not.toHaveBeenCalled();
  });

  test('dispatches when cache is empty and any relay returns data', async() => {
    queryRelayForProfileWithMeta
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({profile: {name: 'fresh'}, created_at: 1, pubkey: PUBKEY});

    await refreshPeerProfileFromRelays(PUBKEY, PEER_ID);

    expect(loadCachedPeerProfile(PUBKEY)?.profile.name).toBe('fresh');
    expect(dispatchEventSingle).toHaveBeenCalledTimes(1);
  });

  test('tolerates relay rejections', async() => {
    queryRelayForProfileWithMeta
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({profile: {name: 'ok'}, created_at: 50, pubkey: PUBKEY});

    await refreshPeerProfileFromRelays(PUBKEY, PEER_ID);

    expect(loadCachedPeerProfile(PUBKEY)?.profile.name).toBe('ok');
  });
});

describe('clearPeerProfileCache', () => {
  test('removes only keys under the prefix', () => {
    localStorage.setItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY, '{"profile":{},"created_at":1}');
    localStorage.setItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY_2, '{"profile":{},"created_at":1}');
    localStorage.setItem('unrelated-key', 'keep-me');

    clearPeerProfileCache();

    expect(localStorage.getItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY)).toBeNull();
    expect(localStorage.getItem(PEER_PROFILE_CACHE_PREFIX + PUBKEY_2)).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
  });
});
