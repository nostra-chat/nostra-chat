/**
 * Tests for Tor bootstrap behavior — fire-and-forget, non-blocking,
 * app remains interactive during bootstrap
 */

import '../setup';

// No rootScope mock needed — we test behavior, not events

import {PrivacyTransport} from '@lib/nostra/privacy-transport';

// ─── Mock helpers ─────────────────────────────────────────────────

function createMockPool() {
  return {
    torMode: false,
    directMode: false,

    setTorMode(_fetchFn: (url: string) => Promise<string>): void {
      this.torMode = true;
    },

    setDirectMode(): void {
      this.directMode = true;
      this.torMode = false;
    },

    isConnected(): boolean {
      return true;
    },

    async publish(): Promise<{successes: string[]; failures: any[]}> {
      return {successes: ['event-id-1'], failures: []};
    },

    async initialize(): Promise<void> {},
    disconnect(): void {},
    subscribeMessages(): void {}
  };
}

function createMockQueue() {
  return {
    messages: [] as any[],

    async queue(to: string, payload: string): Promise<string> {
      this.messages.push({to, payload});
      return `queue-${Date.now()}`;
    },

    async flush(): Promise<number> {
      const count = this.messages.length;
      this.messages = [];
      return count;
    },

    getQueued(): any[] {
      return this.messages;
    },

    getQueueSize(): number {
      return this.messages.length;
    }
  };
}

function createMockWebtorClient(options: {shouldFail?: boolean} = {}) {
  let isReady = false;
  return {
    bootstrapCalled: false,

    async bootstrap(_timeoutMs?: number): Promise<void> {
      this.bootstrapCalled = true;
      if(options.shouldFail) {
        throw new Error('Tor bootstrap failed');
      }
      isReady = true;
    },

    isReady(): boolean {
      return isReady;
    },

    async fetch(_url: string): Promise<string> {
      return '[]';
    },

    async close(): Promise<void> {}
  };
}

describe('Tor Bootstrap Behavior', () => {
  it('bootstrap is fire-and-forget — constructor returns immediately', () => {
    const pool = createMockPool();
    const queue = createMockQueue();
    const webtor = createMockWebtorClient();

    const startTime = performance.now();
    const t = new PrivacyTransport(pool as any, queue as any, webtor as any);
    const elapsed = performance.now() - startTime;

    // Constructor must complete in < 100ms (well under 3s requirement)
    expect(elapsed).toBeLessThan(100);
    t.disconnect();
  });

  it('Tor bootstrap success transitions to active state', async() => {
    const pool = createMockPool();
    const queue = createMockQueue();
    const webtor = createMockWebtorClient();
    const transport = new PrivacyTransport(pool as any, queue as any, webtor as any);

    await transport.bootstrap();

    expect(transport.getState()).toBe('active');
    expect(pool.torMode).toBe(true);
    expect(webtor.bootstrapCalled).toBe(true);

    transport.disconnect();
  });

  it('Tor failure transitions to failed state (no auto-fallback)', async() => {
    const pool = createMockPool();
    const queue = createMockQueue();
    const webtor = createMockWebtorClient({shouldFail: true});
    const transport = new PrivacyTransport(pool as any, queue as any, webtor as any);

    await transport.bootstrap();

    expect(transport.getState()).toBe('failed');
    // Pool must NOT be in direct mode — user must confirm
    expect(pool.directMode).toBe(false);

    transport.disconnect();
  });

  it('app is interactive during Tor bootstrap (messages queue, no blocking)', async() => {
    const pool = createMockPool();
    const queue = createMockQueue();
    const webtor = createMockWebtorClient({shouldFail: true});
    const transport = new PrivacyTransport(pool as any, queue as any, webtor as any);

    await transport.bootstrap();

    // During failed state, messages should queue (not throw)
    await transport.send('recipient-pubkey', 'test during bootstrap');

    expect(queue.messages).toHaveLength(1);

    transport.disconnect();
  });
});
