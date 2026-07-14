import {describe, it, expect, beforeAll, beforeEach, vi} from 'vitest';
import 'fake-indexeddb/auto';
import * as ed from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {bytesToBase64} from '@lib/update/signing/verify';
import {handleUpdateApproved} from '@lib/serviceWorker/signed-update-sw';
import {activeShellCacheName, setActiveVersion, getActiveVersion} from '@lib/serviceWorker/shell-cache';
import {manifestAssetUrl, SIGNED_UPDATE_CONCURRENCY} from '@lib/serviceWorker/update-asset-utils';

beforeAll(() => {
  ed.hashes.sha512 = sha512;
});

const store = new Map<string, Map<string, Response>>();
const cacheKey = (r: any) => new URL(typeof r === 'string' ? r : r.url, globalThis.location?.href || 'https://localhost/').href;
beforeEach(() => {
  store.clear();
  (globalThis as any).caches = {
    async open(name: string) {
      if(!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        async put(r: any, res: Response) { m.set(cacheKey(r), res.clone()); },
        async match(r: any) { return m.get(cacheKey(r)); },
        async delete(r: any) { return m.delete(cacheKey(r)); },
        async keys() { return Array.from(m.keys()).map((u) => new Request(u.startsWith('http') ? u : 'https://localhost' + u)); }
      } as any;
    },
    async has(name: string) { return store.has(name); },
    async delete(name: string) { return store.delete(name); },
    async keys() { return Array.from(store.keys()); }
  };
});

async function sha256b64(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as any);
  let hex = '';
  for(const b of new Uint8Array(d)) hex += b.toString(16).padStart(2, '0');
  return 'sha256-' + hex;
}

describe('handleUpdateApproved', () => {
  it('rejects a correctly signed downgrade before downloading assets', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const manifest: any = {
      schemaVersion: 2,
      version: '0.11.0',
      gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      published: new Date().toISOString(),
      swUrl: './sw.js',
      signingKeyFingerprint: 'ed25519:x',
      securityRelease: false,
      securityRollback: false,
      bundleHashes: {'./sw.js': `sha256-${'0'.repeat(64)}`},
      changelog: '',
      alternateSources: {},
      rotation: null
    };
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sig = bytesToBase64(await ed.signAsync(bytes, priv));
    global.fetch = vi.fn() as any;
    await setActiveVersion('0.12.0', 'ed25519:x');

    const res = await handleUpdateApproved(manifest, sig, bytesToBase64(pub));

    expect(res.outcome).toBe('downgrade-rejected');
    expect(global.fetch).not.toHaveBeenCalled();
    expect((await getActiveVersion())?.version).toBe('0.12.0');
  });

  it('downloads, verifies, and swaps atomically on all-match', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const indexHtml = new TextEncoder().encode('<html></html>');
    const swJs = new TextEncoder().encode('/* sw */');
    const manifest: any = {
      schemaVersion: 2, version: '0.13.0', gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', published: new Date().toISOString(),
      swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x',
      securityRelease: false, securityRollback: false,
      bundleHashes: {
        './index.html': await sha256b64(indexHtml),
        './sw.js': await sha256b64(swJs)
      },
      changelog: '', alternateSources: {}, rotation: null
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sig = bytesToBase64(await ed.signAsync(manifestBytes, priv));
    global.fetch = vi.fn(async(url: string) => {
      if(url.endsWith('index.html')) return new Response(indexHtml);
      if(url.endsWith('sw.js')) return new Response(swJs);
      throw new Error('unexpected url ' + url);
    }) as any;
    await setActiveVersion('0.12.0', 'ed25519:x');
    const res = await handleUpdateApproved(manifest, sig, bytesToBase64(pub));
    expect(res.outcome).toBe('applied');
    const active = await getActiveVersion();
    expect(active?.version).toBe('0.13.0');
  });

  it('aborts on chunk hash mismatch', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const indexHtml = new TextEncoder().encode('<html></html>');
    const manifest: any = {schemaVersion: 2, version: '0.13.0', gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', published: new Date().toISOString(), swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x', securityRelease: false, securityRollback: false, bundleHashes: {'./index.html': `sha256-${'0'.repeat(64)}`, './sw.js': `sha256-${'1'.repeat(64)}`}, changelog: '', alternateSources: {}, rotation: null};
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sig = bytesToBase64(await ed.signAsync(manifestBytes, priv));
    global.fetch = vi.fn(async() => new Response(indexHtml)) as any;
    await setActiveVersion('0.12.0', 'ed25519:x');
    const res = await handleUpdateApproved(manifest, sig, bytesToBase64(pub));
    expect(res.outcome).toBe('chunk-mismatch');
    const active = await getActiveVersion();
    expect(active?.version).toBe('0.12.0');
  });

  it('preserves Content-Type from origin so cached ES modules pass strict-MIME on next load', async() => {
    // Regression for 0.23.0 white-screen: the SW used to cache via
    // `new Response(ab)` with no init, dropping all headers. Browsers then
    // reject ES module scripts served from that cache because the response
    // has no Content-Type ("Failed to load module script: Expected a
    // JavaScript-or-Wasm module script but the server responded with a MIME
    // type of """). The fix reconstructs the Response preserving res.headers.
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const indexJs = new TextEncoder().encode('export const x = 1;');
    const swJs = new TextEncoder().encode('/* sw */');
    const manifest: any = {
      schemaVersion: 2, version: '0.13.0', gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', published: new Date().toISOString(),
      swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x',
      securityRelease: false, securityRollback: false,
      bundleHashes: {
        './index-D4FOSvD8.js': await sha256b64(indexJs),
        './sw.js': await sha256b64(swJs)
      },
      changelog: '', alternateSources: {}, rotation: null
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sig = bytesToBase64(await ed.signAsync(manifestBytes, priv));
    global.fetch = vi.fn(async(url: string) => {
      if(url.endsWith('index-D4FOSvD8.js')) {
        return new Response(indexJs, {headers: {'content-type': 'application/javascript'}});
      }
      if(url.endsWith('sw.js')) {
        return new Response(swJs, {headers: {'content-type': 'application/javascript'}});
      }
      throw new Error('unexpected url ' + url);
    }) as any;
    await setActiveVersion('0.12.0', 'ed25519:x');
    const res = await handleUpdateApproved(manifest, sig, bytesToBase64(pub));
    expect(res.outcome).toBe('applied');
    const active = await getActiveVersion();
    const activeCache = await (globalThis as any).caches.open(activeShellCacheName(active!));
    const cached = await activeCache.match(manifestAssetUrl('./index-D4FOSvD8.js', self.location.href));
    expect(cached).toBeDefined();
    expect(cached!.headers.get('content-type')).toBe('application/javascript');
  });

  it('rehashes the active cache and downloads only missing or divergent chunks', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const correctA = new TextEncoder().encode('stable-a');
    const correctB = new TextEncoder().encode('fresh-b');
    const correctC = new TextEncoder().encode('fresh-c');
    const swJs = new TextEncoder().encode('worker');
    const manifest: any = {
      schemaVersion: 2, version: '0.14.0', gitSha: 'b'.repeat(40), published: new Date().toISOString(),
      swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x', securityRelease: false, securityRollback: false,
      bundleHashes: {
        './a.js': await sha256b64(correctA),
        './b.js': await sha256b64(correctB),
        './c.js': await sha256b64(correctC),
        './sw.js': await sha256b64(swJs)
      },
      changelog: '', alternateSources: {}, rotation: null
    };
    const text = JSON.stringify(manifest);
    const sig = bytesToBase64(await ed.signAsync(new TextEncoder().encode(text), priv));
    await setActiveVersion('0.13.0', 'ed25519:x');
    const oldCache = await (globalThis as any).caches.open('shell-v0.13.0');
    await oldCache.put(manifestAssetUrl('./a.js', self.location.href), new Response(correctA));
    await oldCache.put(manifestAssetUrl('./b.js', self.location.href), new Response('corrupt'));
    const fetched: string[] = [];
    global.fetch = vi.fn(async(url: string) => {
      fetched.push(url);
      if(url.endsWith('/b.js')) return new Response(correctB);
      if(url.endsWith('/c.js')) return new Response(correctC);
      if(url.endsWith('/sw.js')) return new Response(swJs);
      throw new Error(`stable cached asset was fetched: ${url}`);
    }) as any;

    const result = await handleUpdateApproved(manifest, sig, bytesToBase64(pub), undefined, text);

    expect(result.outcome).toBe('applied');
    expect(fetched.some((url) => url.endsWith('/a.js'))).toBe(false);
    expect(fetched.filter((url) => /\/(b|c|sw)\.js$/.test(url))).toHaveLength(3);
  });

  it('downloads signed chunks concurrently without exceeding the configured limit', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const bytes = new TextEncoder().encode('same-content');
    const hash = await sha256b64(bytes);
    const bundleHashes: Record<string, string> = {'./sw.js': hash};
    for(let i = 0; i < 23; i++) bundleHashes[`./chunk-${i}.js`] = hash;
    const manifest: any = {
      schemaVersion: 2, version: '0.15.0', gitSha: 'c'.repeat(40), published: new Date().toISOString(),
      swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x', securityRelease: false, securityRollback: false,
      bundleHashes, changelog: '', alternateSources: {}, rotation: null
    };
    const text = JSON.stringify(manifest);
    const sig = bytesToBase64(await ed.signAsync(new TextEncoder().encode(text), priv));
    await setActiveVersion('0.14.0', 'ed25519:x');
    let inFlight = 0;
    let maxInFlight = 0;
    global.fetch = vi.fn(async() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response(bytes);
    }) as any;

    const result = await handleUpdateApproved(manifest, sig, bytesToBase64(pub), undefined, text);

    expect(result.outcome).toBe('applied');
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(SIGNED_UPDATE_CONCURRENCY);
  });

  it('drains in-flight work before deleting a failed target cache', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const good = new TextEncoder().encode('good');
    const expected = await sha256b64(good);
    const bundleHashes: Record<string, string> = {'./bad.js': expected, './sw.js': expected};
    for(let i = 0; i < 10; i++) bundleHashes[`./slow-${i}.js`] = expected;
    const manifest: any = {
      schemaVersion: 2, version: '0.16.0', gitSha: 'd'.repeat(40), published: new Date().toISOString(),
      swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x', securityRelease: false, securityRollback: false,
      bundleHashes, changelog: '', alternateSources: {}, rotation: null
    };
    const text = JSON.stringify(manifest);
    const sig = bytesToBase64(await ed.signAsync(new TextEncoder().encode(text), priv));
    await setActiveVersion('0.15.0', 'ed25519:x');
    global.fetch = vi.fn(async(url: string, init?: RequestInit) => {
      if(url.endsWith('/bad.js')) return new Response('wrong');
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(good)), 100);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, {once: true});
      });
    }) as any;

    const result = await handleUpdateApproved(manifest, sig, bytesToBase64(pub), undefined, text);

    expect(result.outcome).toBe('chunk-mismatch');
    expect((await getActiveVersion())?.version).toBe('0.15.0');
    expect([...store.keys()].some((name) => name.startsWith('shell-v0.16.0--'))).toBe(false);
    expect(store.has('shell-v0.15.0')).toBe(true);
  });

  it('rejects if signature is bad (defense in depth)', async() => {
    const priv = ed.utils.randomSecretKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const wrongPriv = ed.utils.randomSecretKey();
    const manifest: any = {schemaVersion: 2, version: '0.13.0', gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', published: '2026-01-01', swUrl: './sw.js', signingKeyFingerprint: 'ed25519:x', securityRelease: false, securityRollback: false, bundleHashes: {'./sw.js': `sha256-${'0'.repeat(64)}`}, changelog: '', alternateSources: {}, rotation: null};
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const sig = bytesToBase64(await ed.signAsync(manifestBytes, wrongPriv));
    await setActiveVersion('0.12.0', 'ed25519:x');
    const res = await handleUpdateApproved(manifest, sig, bytesToBase64(pub));
    expect(res.outcome).toBe('invalid-signature');
  });
});
