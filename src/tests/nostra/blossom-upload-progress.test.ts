import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {uploadToBlossomWithProgress, BLOSSOM_SERVERS} from '@lib/nostra/blossom-upload-progress';

class MockXHR {
  static instances: MockXHR[] = [];
  upload = {onprogress: null as ((e: {loaded: number; total: number; lengthComputable: boolean}) => void) | null};
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseText = '';
  status = 0;
  readonly method: string = '';
  readonly url: string = '';
  readonly headers: Record<string, string> = {};
  sentBody: any = null;
  aborted = false;

  open(method: string, url: string) {
    (this as any).method = method;
    (this as any).url = url;
    MockXHR.instances.push(this);
  }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(body: any) { this.sentBody = body; }
  abort() { this.aborted = true; this.onabort?.(); }
}

const PRIVKEY_HEX = '0000000000000000000000000000000000000000000000000000000000000001';

describe('blossom-upload-progress', () => {
  let origXHR: typeof XMLHttpRequest;

  beforeEach(() => {
    MockXHR.instances = [];
    origXHR = globalThis.XMLHttpRequest;
    (globalThis as any).XMLHttpRequest = MockXHR;
  });

  afterEach(() => {
    (globalThis as any).XMLHttpRequest = origXHR;
  });

  it('resolves with the first server success', async() => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const progress: number[] = [];

    const promise = uploadToBlossomWithProgress(blob, PRIVKEY_HEX, {
      onProgress: (p) => progress.push(p)
    });

    await new Promise(r => setTimeout(r, 0));
    const xhr = MockXHR.instances[0];
    expect(xhr.method).toBe('PUT');
    expect(xhr.url).toBe(BLOSSOM_SERVERS[0] + '/upload');
    expect(xhr.headers['Authorization']).toMatch(/^Nostr /);

    xhr.upload.onprogress?.({loaded: 50, total: 100, lengthComputable: true});
    xhr.upload.onprogress?.({loaded: 100, total: 100, lengthComputable: true});
    xhr.status = 200;
    xhr.responseText = JSON.stringify({url: 'https://example.com/x', sha256: 'abc'});
    xhr.onload?.();

    const result = await promise;
    expect(result.url).toBe('https://example.com/x');
    expect(progress).toEqual([50, 100]);
  });

  it('falls back to next server on failure', async() => {
    const blob = new Blob([new Uint8Array([1])]);
    const promise = uploadToBlossomWithProgress(blob, PRIVKEY_HEX, {});

    await new Promise(r => setTimeout(r, 0));
    MockXHR.instances[0].status = 503;
    MockXHR.instances[0].onload?.();

    await new Promise(r => setTimeout(r, 0));
    const second = MockXHR.instances[1];
    expect(second.url).toBe(BLOSSOM_SERVERS[1] + '/upload');
    second.status = 200;
    second.responseText = JSON.stringify({url: 'https://example.com/y', sha256: 'def'});
    second.onload?.();

    const result = await promise;
    expect(result.url).toBe('https://example.com/y');
  });

  it('throws when all servers fail', async() => {
    const blob = new Blob([new Uint8Array([1])]);
    const promise = uploadToBlossomWithProgress(blob, PRIVKEY_HEX, {});

    for(let i = 0; i < BLOSSOM_SERVERS.length; i++) {
      await new Promise(r => setTimeout(r, 0));
      MockXHR.instances[i].status = 500;
      MockXHR.instances[i].onload?.();
    }

    await expect(promise).rejects.toThrow(/all blossom servers failed/);
  });

  it('aborts the current XHR when signal fires', async() => {
    const ctrl = new AbortController();
    const blob = new Blob([new Uint8Array([1])]);
    const promise = uploadToBlossomWithProgress(blob, PRIVKEY_HEX, {signal: ctrl.signal});

    await new Promise(r => setTimeout(r, 0));
    ctrl.abort();
    expect(MockXHR.instances[0].aborted).toBe(true);
    await expect(promise).rejects.toThrow(/aborted/);
  });
});
