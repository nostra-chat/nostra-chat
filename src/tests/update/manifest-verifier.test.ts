import {describe, it, expect, afterEach} from 'vitest';
import {verifyManifestsAcrossSources} from '@lib/update/manifest-verifier';
import {setUpdateTransport, resetUpdateTransport} from '@lib/update/update-transport';
import type {Manifest} from '@lib/update/types';

const validManifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  schemaVersion: 1,
  version: '0.8.0',
  gitSha: 'abc123',
  published: '2026-05-10T12:00:00Z',
  swUrl: './sw-xyz.js',
  bundleHashes: {'./sw-xyz.js': 'sha256-aaa', './index.html': 'sha256-bbb'},
  changelog: 'changes',
  ...overrides
});

function mockFetchMap(byUrl: Map<string, Manifest | Error>): void {
  setUpdateTransport(async (url: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for(const [pattern, result] of byUrl) {
      if(urlStr.includes(pattern)) {
        if(result instanceof Error) throw result;
        return new Response(JSON.stringify(result), {status: 200}) as any;
      }
    }
    throw new Error(`no mock for ${urlStr}`);
  });
}

describe('verifyManifestsAcrossSources', () => {
  afterEach(() => resetUpdateTransport());

  it('returns verified when all 3 sources agree', async() => {
    const m = validManifest();
    mockFetchMap(new Map([
      ['update-manifest.json', m],
      ['github.com/nostra-chat/nostra-chat/releases', m],
      ['ipfs.nostra.chat', m]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('verified');
    expect(result.manifest).toEqual(m);
    expect(result.sources.filter(s => s.status === 'ok')).toHaveLength(3);
  });

  it('returns verified-partial when 2 succeed and 1 offline, and the 2 agree', async() => {
    const m = validManifest();
    mockFetchMap(new Map<string, Manifest | Error>([
      ['update-manifest.json', m],
      ['github.com/nostra-chat/nostra-chat/releases', m],
      ['ipfs.nostra.chat', new Error('offline')]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('verified-partial');
    expect(result.manifest).toEqual(m);
  });

  it('returns conflict when sources disagree on version', async() => {
    const m1 = validManifest({version: '0.8.0'});
    const m2 = validManifest({version: '0.9.0'});
    mockFetchMap(new Map([
      ['update-manifest.json', m1],
      ['github.com/nostra-chat/nostra-chat/releases', m2],
      ['ipfs.nostra.chat', m1]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('conflict');
  });

  it('returns insufficient when only 1 source succeeds', async() => {
    const m = validManifest();
    mockFetchMap(new Map<string, Manifest | Error>([
      ['update-manifest.json', m],
      ['github.com/nostra-chat/nostra-chat/releases', new Error('nope')],
      ['ipfs.nostra.chat', new Error('nope')]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('insufficient');
  });

  it('returns offline when all sources fail', async() => {
    mockFetchMap(new Map<string, Manifest | Error>([
      ['update-manifest.json', new Error('nope')],
      ['github.com/nostra-chat/nostra-chat/releases', new Error('nope')],
      ['ipfs.nostra.chat', new Error('nope')]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('offline');
    expect(result.manifest).toBeUndefined();
  });

  it('rejects manifests with unknown schemaVersion', async() => {
    const m = validManifest({schemaVersion: 99});
    mockFetchMap(new Map([
      ['update-manifest.json', m],
      ['github.com/nostra-chat/nostra-chat/releases', m],
      ['ipfs.nostra.chat', m]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('offline');
  });

  it('tolerates changelog differences across sources (whitespace etc.)', async() => {
    const base = validManifest();
    mockFetchMap(new Map([
      ['update-manifest.json', {...base, changelog: 'foo'}],
      ['github.com/nostra-chat/nostra-chat/releases', {...base, changelog: 'foo\n'}],
      ['ipfs.nostra.chat', {...base, changelog: 'bar'}]
    ]));

    const result = await verifyManifestsAcrossSources();
    expect(result.verdict).toBe('verified');
  });
});
