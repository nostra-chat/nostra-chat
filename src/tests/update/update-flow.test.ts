import {describe, it, expect, afterEach} from 'vitest';
import {downloadAndVerify, startUpdateSigned} from '@lib/update/update-flow';
import {setUpdateTransport, resetUpdateTransport} from '@lib/update/update-transport';
import {UpdateFlowError} from '@lib/update/types';

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return 'sha256-' + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('downloadAndVerify', () => {
  afterEach(() => resetUpdateTransport());

  it('returns files when all hashes match', async() => {
    const payloadA = new TextEncoder().encode('file A content').buffer;
    const payloadB = new TextEncoder().encode('file B content').buffer;
    const hashA = await sha256Hex(payloadA);
    const hashB = await sha256Hex(payloadB);

    setUpdateTransport(async(url: any) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if(urlStr.includes('a.js')) return new Response(payloadA) as any;
      if(urlStr.includes('b.js')) return new Response(payloadB) as any;
      throw new Error('no mock');
    });

    const manifest = {
      schemaVersion: 1, version: '1.0', gitSha: 'x', published: 'x', swUrl: './a.js',
      bundleHashes: {'./a.js': hashA, './b.js': hashB}, changelog: ''
    };

    const files = await downloadAndVerify(manifest as any);
    expect(files.size).toBe(2);
    expect(files.get('./a.js')!.byteLength).toBe(payloadA.byteLength);
  });

  it('throws UpdateFlowError on hash mismatch', async() => {
    const payload = new TextEncoder().encode('content').buffer;
    setUpdateTransport(async() => new Response(payload) as any);

    const manifest = {
      schemaVersion: 1, version: '1.0', gitSha: 'x', published: 'x', swUrl: './a.js',
      bundleHashes: {'./a.js': 'sha256-wrong-hash'}, changelog: ''
    };

    await expect(downloadAndVerify(manifest as any)).rejects.toThrow(UpdateFlowError);
  });
});

describe('signed update multi-tab coordination', () => {
  it('does not start a second update while another tab holds the update lock', async() => {
    const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {getRegistration: async() => { throw new Error('must not register'); }},
        locks: {request: async(_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null)}
      }
    });
    try {
      const manifest = {
        schemaVersion: 2,
        version: '1.2.3',
        gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        published: new Date().toISOString(),
        swUrl: './sw.js',
        bundleHashes: {'./sw.js': `sha256-${'0'.repeat(64)}`}
      };
      await expect(startUpdateSigned(manifest, 'signature')).resolves.toMatchObject({
        ok: false,
        outcome: 'update-in-progress'
      });
    } finally {
      if(previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
      else delete (globalThis as any).navigator;
    }
  });
});
