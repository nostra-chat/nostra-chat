import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

vi.mock('@lib/nostra/blossom-upload-progress', () => ({
  BLOSSOM_SERVERS: ['https://mock'],
  uploadToBlossomWithProgress: vi.fn()
}));

import {uploadToBlossomWithProgress} from '@lib/nostra/blossom-upload-progress';
import {
  sendFileViaNostra,
  getPendingFileSend,
  getPendingFileSendCount,
  clearPendingFileSends,
  __setRetryBackoffForTests,
  __resetRetryBackoffForTests
} from '@lib/nostra/nostra-send-file';

const mockedUpload = uploadToBlossomWithProgress as unknown as ReturnType<typeof vi.fn>;

function makeCtx(overrides: any = {}) {
  const dispatched: any[] = [];
  return {
    dispatched,
    ctx: {
      ownPubkey: '11'.repeat(32),
      privkeyHex: '22'.repeat(32),
      peerPubkey: '33'.repeat(32),
      chatAPI: {
        getActivePeer: () => '33'.repeat(32),
        connect: vi.fn(async() => {}),
        sendFileMessage: vi.fn(async() => 'chat-1-1')
      },
      dispatch: (name: string, payload: any) => dispatched.push({name, payload}),
      injectBubble: vi.fn(async() => {}),
      saveMessage: vi.fn(async() => {}),
      log: Object.assign((..._: any[]) => {}, {warn: () => {}, error: () => {}}),
      ...overrides
    }
  };
}

describe('nostra-send-file', () => {
  beforeEach(() => {
    mockedUpload.mockReset();
    clearPendingFileSends();
    __setRetryBackoffForTests([0, 0, 0]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetRetryBackoffForTests();
  });

  it('encrypts, uploads, dispatches progress + completed, calls sendFileMessage', async() => {
    mockedUpload.mockImplementation(async(_blob: any, _key: any, opts: any) => {
      opts?.onProgress?.(50);
      opts?.onProgress?.(100);
      return {url: 'https://mock/x', sha256: 'abc'};
    });

    const {ctx, dispatched} = makeCtx();
    const blob = new Blob([new Uint8Array([1, 2, 3])], {type: 'image/jpeg'});
    const result = await sendFileViaNostra(ctx, {
      peerId: 1_000_000_000_000_001,
      blob,
      type: 'image',
      caption: '',
      tempMid: -1,
      width: 100,
      height: 80
    });

    expect(result.ok).toBe(true);
    expect(ctx.chatAPI.sendFileMessage).toHaveBeenCalledTimes(1);
    const progressEvents = dispatched.filter(d => d.name === 'nostra_file_upload_progress');
    expect(progressEvents.map(e => e.payload.percent)).toEqual([50, 100]);
    expect(dispatched.some(d => d.name === 'nostra_file_upload_completed')).toBe(true);
  });

  it('retries 3 times on upload failure, then hard fails', async() => {
    mockedUpload.mockRejectedValue(new Error('network'));
    const {ctx, dispatched} = makeCtx();

    const result = await sendFileViaNostra(ctx, {
      peerId: 1_000_000_000_000_002,
      blob: new Blob([new Uint8Array([1])]),
      type: 'file',
      caption: '',
      tempMid: -2
    });

    expect(result.ok).toBe(false);
    expect(mockedUpload).toHaveBeenCalledTimes(4);
    expect(dispatched.some(d => d.name === 'nostra_file_upload_failed')).toBe(true);
    expect(getPendingFileSend(-2)).toBeDefined();
  });

  it('retry map LRU-evicts at cap 20 when uploads keep failing', async() => {
    // On success pending entries are removed immediately, so LRU only kicks
    // in when entries are left behind after hard failure.
    mockedUpload.mockRejectedValue(new Error('network'));
    for(let i = 0; i < 25; i++) {
      const {ctx} = makeCtx();
      await sendFileViaNostra(ctx, {
        peerId: 1_000_000_000_000_100 + i,
        blob: new Blob([new Uint8Array([i])]),
        type: 'file',
        caption: '',
        tempMid: -1000 - i
      });
    }
    expect(getPendingFileSendCount()).toBeLessThanOrEqual(20);
    // Oldest entries should have been evicted
    expect(getPendingFileSend(-1000)).toBeUndefined();
    expect(getPendingFileSend(-1024)).toBeDefined();
  });

  it('aborts upload when signal fires', async() => {
    const abort = new AbortController();
    mockedUpload.mockImplementation((_blob: any, _key: any, opts: any) => {
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new Error('upload aborted')));
      });
    });
    const {ctx} = makeCtx();

    const p = sendFileViaNostra(ctx, {
      peerId: 1_000_000_000_000_003,
      blob: new Blob([new Uint8Array([1])]),
      type: 'file',
      caption: '',
      tempMid: -3,
      signal: abort.signal
    });
    abort.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/aborted/);
  });
});
