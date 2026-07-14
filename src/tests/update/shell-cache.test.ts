import {describe, it, expect, beforeEach} from 'vitest';
import 'fake-indexeddb/auto';
import {
  activeShellCacheName,
  commitPreparedShell,
  gcOrphans,
  getActiveVersion,
  pendingCacheName,
  preparedCacheName,
  setActiveVersion,
  shellCacheName
} from '@lib/serviceWorker/shell-cache';

const store = new Map<string, Map<string, Response>>();
let putCount = 0;
const cacheKey = (req: any) => new URL(typeof req === 'string' ? req : req.url, 'https://localhost/').href;
const cachesStub: CacheStorage = {
  async open(name: string) {
    if(!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      async put(req: any, res: Response) { putCount++; m.set(cacheKey(req), res.clone()); },
      async match(req: any) { return m.get(cacheKey(req)); },
      async delete(req: any) { return m.delete(cacheKey(req)); },
      async keys() { return Array.from(m.keys()).map((u) => new Request(u)); }
    } as any;
  },
  async has(name: string) { return store.has(name); },
  async delete(name: string) { return store.delete(name); },
  async keys() { return Array.from(store.keys()); },
  async match() { return undefined as any; }
};
(globalThis as any).caches = cachesStub;

beforeEach(() => {
  store.clear();
  putCount = 0;
});

describe('shell-cache', () => {
  it('shellCacheName produces stable format', () => {
    expect(shellCacheName('0.12.0')).toBe('shell-v0.12.0');
    expect(pendingCacheName('0.12.0')).toBe('shell-v0.12.0-pending');
    expect(preparedCacheName('0.13.0', `sha256-${'a'.repeat(64)}`)).toBe(`shell-v0.13.0--${'a'.repeat(64)}`);
  });

  it('setActiveVersion + getActiveVersion round-trip', async() => {
    await setActiveVersion('0.12.0', 'ed25519:abc');
    const v = await getActiveVersion();
    expect(v?.version).toBe('0.12.0');
    expect(v?.keyFingerprint).toBe('ed25519:abc');
  });

  it('commits an already prepared cache without copying its entries', async() => {
    const digest = `sha256-${'a'.repeat(64)}`;
    const preparedName = preparedCacheName('0.13.0', digest);
    const prepared = await cachesStub.open(preparedName);
    await prepared.put('https://localhost/foo.js', new Response('bar'));
    await setActiveVersion('0.12.0', 'ed25519:abc');
    const putsBeforeCommit = putCount;
    await commitPreparedShell('0.13.0', 'ed25519:abc', 'pubkey', preparedName, {
      manifestText: '{}', signature: 'sig', approvedByPubkey: 'pubkey', manifestDigest: digest
    });
    expect(putCount).toBe(putsBeforeCommit);
    expect(await cachesStub.has(preparedName)).toBe(true);
    expect(await cachesStub.has('shell-v0.12.0')).toBe(false);
    const v = await getActiveVersion();
    expect(v?.version).toBe('0.13.0');
    expect(activeShellCacheName(v!)).toBe(preparedName);
  });

  it('gcOrphans removes pending caches not matching active', async() => {
    await cachesStub.open('shell-v0.11.0');
    await cachesStub.open('shell-v0.12.0-pending');
    const activeName = 'shell-v0.13.0--abcdef';
    await cachesStub.open(activeName);
    await setActiveVersion('0.13.0', 'ed25519:abc', undefined, activeName);
    await gcOrphans();
    expect(await cachesStub.has('shell-v0.11.0')).toBe(false);
    expect(await cachesStub.has('shell-v0.12.0-pending')).toBe(false);
    expect(await cachesStub.has(activeName)).toBe(true);
  });
});
