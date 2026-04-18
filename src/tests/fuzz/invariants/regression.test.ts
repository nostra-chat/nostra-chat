import {describe, it, expect, vi} from 'vitest';
import {noNip04, idbSeedEncrypted} from './regression';
import type {FuzzContext} from '../types';

function ctx(opts: {relayEvents?: any[]; idbDump?: string} = {}): FuzzContext {
  return {
    users: {
      userA: {id: 'userA', context: null as any, page: {evaluate: vi.fn(async() => opts.idbDump || '')} as any, displayName: 'A', npub: '', remotePeerId: 0, consoleLog: [], reloadTimes: []},
      userB: {id: 'userB', context: null as any, page: {evaluate: vi.fn(async() => opts.idbDump || '')} as any, displayName: 'B', npub: '', remotePeerId: 0, consoleLog: [], reloadTimes: []}
    } as any,
    relay: {getAllEvents: vi.fn(async() => opts.relayEvents || [])} as any,
    snapshots: new Map(),
    actionIndex: 0
  };
}

describe('INV-no-nip04', () => {
  it('passes when relay has no kind 4 events', async() => {
    const r = await noNip04.check(ctx({relayEvents: [{kind: 1059, id: 'x'}, {kind: 0, id: 'y'}]}));
    expect(r.ok).toBe(true);
  });

  it('fails when relay has a kind 4 event', async() => {
    const r = await noNip04.check(ctx({relayEvents: [{kind: 1059, id: 'x'}, {kind: 4, id: 'bad'}]}));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/kind 4/i);
  });
});

describe('INV-idb-seed-encrypted', () => {
  it('passes when idb dump contains no plaintext seed/nsec', async() => {
    const r = await idbSeedEncrypted.check(ctx({idbDump: '{"pubkey":"abc","ciphertext":"ENCRYPTED"}'}));
    expect(r.ok).toBe(true);
  });

  it('fails when idb dump contains nsec1 plaintext', async() => {
    const r = await idbSeedEncrypted.check(ctx({idbDump: '{"nsec":"nsec1abcdefghijklmnopqrstuvwxyz"}'}));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/plaintext/i);
  });
});
