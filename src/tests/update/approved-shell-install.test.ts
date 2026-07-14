import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import 'fake-indexeddb/auto';
import * as ed from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {bytesToBase64} from '@lib/update/signing/verify';
import {reuseApprovedShellForInstall} from '@lib/serviceWorker/approved-shell-install';
import {preparedCacheName, setActiveVersion} from '@lib/serviceWorker/shell-cache';
import {manifestAssetUrl, sha256Hex} from '@lib/serviceWorker/update-asset-utils';

beforeAll(() => {
  ed.hashes.sha512 = sha512;
});

const store = new Map<string, Map<string, Response>>();
const cacheKey = (request: any) => new URL(typeof request === 'string' ? request : request.url, 'https://localhost/').href;

beforeEach(() => {
  store.clear();
  (globalThis as any).caches = {
    async open(name: string) {
      if(!store.has(name)) store.set(name, new Map());
      const entries = store.get(name)!;
      return {
        async put(request: any, response: Response) { entries.set(cacheKey(request), response.clone()); },
        async match(request: any) { return entries.get(cacheKey(request)); },
        async keys() { return [...entries.keys()].map((url) => new Request(url)); }
      } as unknown as Cache;
    },
    async has(name: string) { return store.has(name); },
    async delete(name: string) { return store.delete(name); },
    async keys() { return [...store.keys()]; }
  };
});

async function prepareApprovedShell(tamper = false) {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const swBytes = new TextEncoder().encode('approved-worker');
  const appBytes = new TextEncoder().encode('approved-app');
  const manifest: any = {
    schemaVersion: 2,
    version: '0.27.0',
    gitSha: 'e'.repeat(40),
    published: new Date().toISOString(),
    swUrl: './sw.js',
    signingKeyFingerprint: 'ed25519:test',
    securityRelease: false,
    securityRollback: false,
    bundleHashes: {
      './sw.js': await sha256Hex(swBytes),
      './app.js': await sha256Hex(appBytes)
    },
    changelog: '',
    alternateSources: {},
    rotation: null
  };
  const manifestText = JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(manifestText);
  const manifestDigest = await sha256Hex(manifestBytes);
  const signature = bytesToBase64(await ed.signAsync(manifestBytes, privateKey));
  const approvedByPubkey = bytesToBase64(publicKey);
  const cacheName = preparedCacheName(manifest.version, manifestDigest);
  const cache = await caches.open(cacheName);
  const scriptUrl = 'https://localhost/sw.js';
  await cache.put(manifestAssetUrl('./sw.js', scriptUrl), new Response(tamper ? 'tampered' : swBytes));
  await cache.put(manifestAssetUrl('./app.js', scriptUrl), new Response(appBytes));
  await setActiveVersion(manifest.version, manifest.signingKeyFingerprint, approvedByPubkey, cacheName, {
    manifestText, signature, approvedByPubkey, manifestDigest
  });
  return {scriptUrl};
}

describe('reuseApprovedShellForInstall', () => {
  it('reverifies a prepared signed shell without network downloads', async() => {
    const {scriptUrl} = await prepareApprovedShell();
    global.fetch = vi.fn() as any;

    await expect(reuseApprovedShellForInstall(scriptUrl)).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when a prepared cache byte differs from the signed hash', async() => {
    const {scriptUrl} = await prepareApprovedShell(true);

    await expect(reuseApprovedShellForInstall(scriptUrl)).rejects.toThrow('approved shell chunk mismatch');
  });
});
