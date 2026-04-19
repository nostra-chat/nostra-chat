// @vitest-environment jsdom
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import 'fake-indexeddb/auto';

describe('nostra-reactions-publish', () => {
  let publishMod: any;
  let storeMod: any;
  let mockChatAPI: any;
  let publishedEvents: any[];

  afterEach(async () => {
    await storeMod?.nostraReactionsStore?.destroy?.();
  });

  beforeEach(async () => {
    vi.resetModules();
    await new Promise<void>((resolve, reject) => {
      const req = (globalThis as any).indexedDB.deleteDatabase('nostra-reactions');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
    publishedEvents = [];
    mockChatAPI = {
      publishEvent: vi.fn(async (unsigned: any) => {
        const signed = {...unsigned, id: `fakeid-${publishedEvents.length}`, pubkey: 'ownpk'};
        publishedEvents.push(signed);
        return signed;
      }),
      ownId: 'ownpk'
    };
    storeMod = await import('@lib/nostra/nostra-reactions-store');
    publishMod = await import('@lib/nostra/nostra-reactions-publish');
    publishMod.setChatAPI(mockChatAPI);
    await storeMod.nostraReactionsStore.init();
  });

  it('publish() emits kind-7 with e/p tags + emoji content', async () => {
    await publishMod.nostraReactionsPublish.publish({
      targetEventId: 'evtX',
      targetMid: 42,
      targetPeerId: 1e16,
      targetAuthor: 'peerpk',
      emoji: '👍'
    });
    expect(mockChatAPI.publishEvent).toHaveBeenCalledTimes(1);
    const call = mockChatAPI.publishEvent.mock.calls[0][0];
    expect(call.kind).toBe(7);
    expect(call.content).toBe('👍');
    const tagKeys = call.tags.map((t: any[]) => t[0]);
    expect(tagKeys).toContain('e');
    expect(tagKeys).toContain('p');
    const eTag = call.tags.find((t: any[]) => t[0] === 'e');
    expect(eTag[1]).toBe('evtX');
    const pTag = call.tags.find((t: any[]) => t[0] === 'p');
    expect(pTag[1]).toBe('peerpk');
  });

  it('publish() persists row with reactionEventId from published event', async () => {
    await publishMod.nostraReactionsPublish.publish({
      targetEventId: 'evtX',
      targetMid: 42,
      targetPeerId: 1e16,
      targetAuthor: 'peerpk',
      emoji: '👍'
    });
    const rows = await storeMod.nostraReactionsStore.getByTarget('evtX');
    expect(rows).toHaveLength(1);
    expect(rows[0].reactionEventId).toBe('fakeid-0');
    expect(rows[0].fromPubkey).toBe('ownpk');
  });

  it('unpublish() emits kind-5 delete referencing the reaction event id', async () => {
    await publishMod.nostraReactionsPublish.publish({
      targetEventId: 'evtX', targetMid: 42, targetPeerId: 1e16,
      targetAuthor: 'peerpk', emoji: '👍'
    });
    await publishMod.nostraReactionsPublish.unpublish('fakeid-0');
    expect(mockChatAPI.publishEvent).toHaveBeenCalledTimes(2);
    const call = mockChatAPI.publishEvent.mock.calls[1][0];
    expect(call.kind).toBe(5);
    const eTag = call.tags.find((t: any[]) => t[0] === 'e');
    expect(eTag[1]).toBe('fakeid-0');
  });

  it('unpublish() removes the row from the store', async () => {
    await publishMod.nostraReactionsPublish.publish({
      targetEventId: 'evtX', targetMid: 42, targetPeerId: 1e16,
      targetAuthor: 'peerpk', emoji: '👍'
    });
    await publishMod.nostraReactionsPublish.unpublish('fakeid-0');
    const rows = await storeMod.nostraReactionsStore.getByTarget('evtX');
    expect(rows).toHaveLength(0);
  });
});
