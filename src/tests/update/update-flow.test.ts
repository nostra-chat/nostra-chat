import {describe, it, expect, afterEach, vi} from 'vitest';
import {
  downloadAndVerify,
  startUpdateSigned,
  UPDATE_CANCEL_GRACE_MS,
  UPDATE_INACTIVITY_TIMEOUT_MS
} from '@lib/update/update-flow';
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

class TestMessagePort {
  peer?: TestMessagePort;
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(data: unknown): void {
    this.peer?.onmessage?.({data} as MessageEvent);
  }

  close(): void {}
  start(): void {}
}

class TestMessageChannel {
  port1 = new TestMessagePort();
  port2 = new TestMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

function signedManifest(): any {
  return {
    schemaVersion: 2,
    version: '1.2.3',
    gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    published: new Date().toISOString(),
    swUrl: './sw.js',
    signingKeyFingerprint: 'fingerprint',
    securityRelease: false,
    securityRollback: false,
    rotation: null,
    bundleHashes: {'./sw.js': `sha256-${'0'.repeat(64)}`}
  };
}

describe('signed update watchdog', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resets on progress, then cancels and keeps the lock through the grace period', async() => {
    vi.useFakeTimers();
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const previousMessageChannel = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
    let serviceWorkerPort: TestMessagePort | undefined;
    let cancelReceived = false;
    Object.defineProperty(globalThis, 'MessageChannel', {configurable: true, value: TestMessageChannel});
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: async() => ({
            active: {
              postMessage: (_message: unknown, ports: TestMessagePort[]) => {
                serviceWorkerPort = ports[0];
                serviceWorkerPort.onmessage = (event) => {
                  if(event.data?.type === 'UPDATE_CANCEL') cancelReceived = true;
                };
              }
            }
          })
        }
      }
    });

    try {
      const resultPromise = startUpdateSigned(signedManifest(), 'signature');
      await Promise.resolve();
      await Promise.resolve();
      expect(serviceWorkerPort).toBeDefined();

      await vi.advanceTimersByTimeAsync(UPDATE_INACTIVITY_TIMEOUT_MS - 1);
      serviceWorkerPort!.postMessage({type: 'UPDATE_PROGRESS', done: 10, total: 100});
      await vi.advanceTimersByTimeAsync(UPDATE_INACTIVITY_TIMEOUT_MS - 1);
      expect(cancelReceived).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(cancelReceived).toBe(true);
      let settled = false;
      void resultPromise.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(UPDATE_CANCEL_GRACE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toMatchObject({ok: false, outcome: 'update-timeout'});
    } finally {
      if(previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete (globalThis as any).navigator;
      if(previousMessageChannel) Object.defineProperty(globalThis, 'MessageChannel', previousMessageChannel);
      else delete (globalThis as any).MessageChannel;
    }
  });

  it('uses the exact signed manifest and stops the watchdog after a result', async() => {
    vi.useFakeTimers();
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const previousMessageChannel = Object.getOwnPropertyDescriptor(globalThis, 'MessageChannel');
    const approved = signedManifest();
    const unsignedArgument = {...approved, swUrl: './tampered.js'};
    let dispatchedManifest: unknown;
    let cancelReceived = false;
    Object.defineProperty(globalThis, 'MessageChannel', {configurable: true, value: TestMessageChannel});
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        serviceWorker: {
          getRegistration: async() => ({
            active: {
              postMessage: (message: any, ports: TestMessagePort[]) => {
                dispatchedManifest = message.manifest;
                const port = ports[0];
                port.onmessage = (event) => {
                  if(event.data?.type === 'UPDATE_CANCEL') cancelReceived = true;
                };
                port.postMessage({type: 'UPDATE_RESULT', outcome: 'invalid-signature'});
              }
            }
          })
        }
      }
    });

    try {
      await expect(startUpdateSigned(unsignedArgument, 'signature', JSON.stringify(approved))).resolves.toMatchObject({
        ok: false,
        outcome: 'invalid-signature'
      });
      expect(dispatchedManifest).toEqual(approved);
      await vi.advanceTimersByTimeAsync(UPDATE_INACTIVITY_TIMEOUT_MS + UPDATE_CANCEL_GRACE_MS);
      expect(cancelReceived).toBe(false);
    } finally {
      if(previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete (globalThis as any).navigator;
      if(previousMessageChannel) Object.defineProperty(globalThis, 'MessageChannel', previousMessageChannel);
      else delete (globalThis as any).MessageChannel;
    }
  });
});
