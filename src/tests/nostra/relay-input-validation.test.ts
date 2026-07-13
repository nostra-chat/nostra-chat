import '../setup';
import {describe, expect, it, vi} from 'vitest';
import {finalizeEvent, generateSecretKey} from 'nostr-tools/pure';
import {
  isStructurallyValidRelayEvent,
  MAX_RELAY_EVENT_CONTENT_CHARS,
  MAX_RELAY_EVENT_TAGS,
  MAX_RELAY_FRAME_CHARS,
  NostrRelay
} from '@lib/nostra/nostr-relay';

function validEvent() {
  return finalizeEvent({
    kind: 7,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', 'a'.repeat(64)], ['p', 'b'.repeat(64)]],
    content: '👍'
  }, generateSecretKey());
}

describe('relay input resource and shape validation', () => {
  it('accepts a signed, well-shaped event', () => {
    expect(isStructurallyValidRelayEvent(validEvent())).toBe(true);
  });

  it('rejects oversized content before signature or decryption work', () => {
    const event = {...validEvent(), content: 'x'.repeat(MAX_RELAY_EVENT_CONTENT_CHARS + 1)};
    expect(isStructurallyValidRelayEvent(event)).toBe(false);
  });

  it('rejects excessive tags and malformed signature fields', () => {
    const event = validEvent();
    expect(isStructurallyValidRelayEvent({
      ...event,
      tags: Array.from({length: MAX_RELAY_EVENT_TAGS + 1}, () => ['p', 'a'])
    })).toBe(false);
    expect(isStructurallyValidRelayEvent({...event, sig: 'not-hex'})).toBe(false);
  });

  it('drops an oversized WebSocket frame without invoking a raw handler', () => {
    const relay = new NostrRelay('wss://relay.invalid');
    const rawHandler = vi.fn();
    relay.onRawEvent(rawHandler);

    (relay as any).handleMessage('x'.repeat(MAX_RELAY_FRAME_CHARS + 1));

    expect(rawHandler).not.toHaveBeenCalled();
    relay.disconnect();
  });

  it('drops a structurally malformed EVENT frame before routing', () => {
    const relay = new NostrRelay('wss://relay.invalid');
    const rawHandler = vi.fn();
    relay.onRawEvent(rawHandler);

    (relay as any).handleMessage(JSON.stringify([
      'EVENT',
      'sub-1',
      {...validEvent(), created_at: null}
    ]));

    expect(rawHandler).not.toHaveBeenCalled();
    relay.disconnect();
  });

  it('signature-verifies live raw subscription events before callback delivery', () => {
    const relay = new NostrRelay('wss://relay.invalid');
    const received: any[] = [];
    relay.subscribeRawEvents({'kinds': [42], '#e': ['a'.repeat(64)]}, event => received.push(event));
    const subscriptionId = [...(relay as any).rawSubscriptions.keys()][0];
    const event = validEvent();

    (relay as any).handleMessage(JSON.stringify(['EVENT', subscriptionId, event]));
    (relay as any).handleMessage(JSON.stringify(['EVENT', subscriptionId, {...event, sig: '0'.repeat(128)}]));

    expect(received).toEqual([event]);
    relay.disconnect();
  });
});
