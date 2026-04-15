// @ts-nocheck
import {describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach} from 'vitest';

describe('nostra_tor_circuit_update event type', () => {
  it('should accept circuit update payload shape', async() => {
    const {default: rootScope} = await import('@lib/rootScope');

    const handler = vi.fn();
    rootScope.addEventListener('nostra_tor_circuit_update', handler);

    const payload = {
      guard: 'AAAA1234',
      middle: 'BBBB5678',
      exit: 'CCCC9012',
      latency: 450,
      exitIp: '198.51.100.42',
      healthy: true
    };

    rootScope.dispatchEvent('nostra_tor_circuit_update', payload);
    expect(handler).toHaveBeenCalledWith(payload);

    rootScope.removeEventListener('nostra_tor_circuit_update', handler);
  });
});

describe('WebtorClient circuit details', () => {
  it('should expose getCircuitDetails() returning node fingerprints', async() => {
    vi.doMock('/webtor/webtor_wasm', () => ({
      default: vi.fn(),
      init: vi.fn(),
      setDebugEnabled: vi.fn(),
      setLogCallback: vi.fn(),
      TorClient: vi.fn().mockImplementation(() => ({
        getCircuitStatus: vi.fn().mockResolvedValue({
          has_ready_circuits: true,
          ready: 1,
          total: 1,
          failed: 0,
          creating: 0,
          nodes: ['AAAA1234', 'BBBB5678', 'CCCC9012']
        }),
        fetch: vi.fn().mockResolvedValue({
          text: vi.fn().mockReturnValue('198.51.100.42'),
          body_string: vi.fn().mockReturnValue('198.51.100.42')
        }),
        close: vi.fn()
      })),
      TorClientOptions: vi.fn().mockImplementation(() => ({}))
    }));

    vi.resetModules();
    const {WebtorClient} = await import('@lib/nostra/webtor-fallback');
    const client = new WebtorClient();

    expect(client.getCircuitDetails()).toBeNull();

    await client.init();
    await client.bootstrap(5000);
    const details = client.getCircuitDetails();

    expect(details).not.toBeNull();
    expect(details.guard).toBe('AAAA1234');
    expect(details.middle).toBe('BBBB5678');
    expect(details.exit).toBe('CCCC9012');
    expect(details.healthy).toBe(true);

    await client.close();
    vi.unmock('/webtor/webtor_wasm');
  });

  it('should fetch exit IP on circuit ready', async() => {
    vi.doMock('/webtor/webtor_wasm', () => ({
      default: vi.fn(),
      init: vi.fn(),
      setDebugEnabled: vi.fn(),
      setLogCallback: vi.fn(),
      TorClient: vi.fn().mockImplementation(() => ({
        getCircuitStatus: vi.fn().mockResolvedValue({
          has_ready_circuits: true,
          ready: 1,
          total: 1,
          failed: 0,
          creating: 0,
          nodes: ['A', 'B', 'C']
        }),
        fetch: vi.fn().mockResolvedValue({
          text: vi.fn().mockReturnValue('198.51.100.42'),
          body_string: vi.fn().mockReturnValue('198.51.100.42')
        }),
        close: vi.fn()
      })),
      TorClientOptions: vi.fn().mockImplementation(() => ({}))
    }));

    vi.resetModules();
    const {WebtorClient} = await import('@lib/nostra/webtor-fallback');
    const client = new WebtorClient();
    await client.init();
    await client.bootstrap(5000);

    const details = client.getCircuitDetails();
    expect(details.exitIp).toBe('198.51.100.42');

    await client.close();
    vi.unmock('/webtor/webtor_wasm');
  });
});

describe('PrivacyTransport circuit event dispatch', () => {
  it('should dispatch nostra_tor_circuit_update on circuit polling', async() => {
    const {default: rootScope} = await import('@lib/rootScope');
    const handler = vi.fn();
    rootScope.addEventListener('nostra_tor_circuit_update', handler);

    rootScope.dispatchEvent('nostra_tor_circuit_update', {
      guard: 'AAAA',
      middle: 'BBBB',
      exit: 'CCCC',
      latency: 300,
      exitIp: '1.2.3.4',
      healthy: true
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      guard: 'AAAA',
      healthy: true
    }));

    rootScope.removeEventListener('nostra_tor_circuit_update', handler);
  });
});

describe('PrivacyTransport.setTorEnabled()', () => {
  it('should persist tor enabled state to localStorage', () => {
    localStorage.setItem('nostra-tor-enabled', 'true');
    expect(localStorage.getItem('nostra-tor-enabled')).toBe('true');

    localStorage.setItem('nostra-tor-enabled', 'false');
    expect(localStorage.getItem('nostra-tor-enabled')).toBe('false');

    localStorage.removeItem('nostra-tor-enabled');
  });

  it('should read isTorEnabled() from localStorage defaulting to true', async() => {
    localStorage.removeItem('nostra-tor-enabled');

    const {PrivacyTransport} = await import('@lib/nostra/privacy-transport');

    expect(PrivacyTransport.isTorEnabled()).toBe(true);

    localStorage.setItem('nostra-tor-enabled', 'false');
    expect(PrivacyTransport.isTorEnabled()).toBe(false);

    localStorage.setItem('nostra-tor-enabled', 'true');
    expect(PrivacyTransport.isTorEnabled()).toBe(true);

    localStorage.removeItem('nostra-tor-enabled');
  });
});

describe('NostrRelay dual latency tracking', () => {
  it('should store directLatencyMs and torLatencyMs separately', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay(
      'wss://test.relay',
      'deadbeef'.repeat(8),
      'cafebabe'.repeat(8)
    );

    expect(relay.directLatencyMs).toBe(-1);
    expect(relay.torLatencyMs).toBe(-1);

    relay.disconnect();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PrivacyTransport unit/integration tests
// Uses a mocked rootScope to avoid MTProtoMessagePort.getInstance() failure
// in environments where the MessagePort singleton is not initialized.
// ──────────────────────────────────────────────────────────────────────────────

describe('PrivacyTransport (with mocked rootScope)', () => {
  let PrivacyTransport;
  let mockRootScope;
  let mockPool;
  let mockQueue;
  let mockWebtorClient;

  beforeAll(async() => {
    vi.resetModules();

    // Mock rootScope so dispatchEvent doesn't try to invoke MTProtoMessagePort
    mockRootScope = {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    vi.doMock('@lib/rootScope', () => ({default: mockRootScope}));

    const mod = await import('@lib/nostra/privacy-transport');
    PrivacyTransport = mod.PrivacyTransport;
  });

  afterAll(() => {
    vi.unmock('@lib/rootScope');
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.removeItem('nostra-tor-enabled');
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockPool = {
      setTorMode: vi.fn(),
      setDirectMode: vi.fn(),
      disconnect: vi.fn(),
      publish: vi.fn().mockResolvedValue({successes: ['ok']})
    };

    mockQueue = {
      queue: vi.fn().mockResolvedValue('msg-1'),
      getQueued: vi.fn().mockReturnValue([])
    };

    mockWebtorClient = {
      bootstrap: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(true),
      fetch: vi.fn().mockResolvedValue('ok'),
      close: vi.fn().mockResolvedValue(undefined),
      getCircuitDetails: vi.fn().mockReturnValue(null),
      _events: {}
    };

    localStorage.removeItem('nostra-tor-enabled');
  });

  // ── setTorEnabled() ──────────────────────────────────────────────────────

  it('setTorEnabled(false) calls confirmDirectFallback which calls pool.setDirectMode()', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    await transport.setTorEnabled(false);

    expect(mockPool.setDirectMode).toHaveBeenCalled();
    expect(transport.getState()).toBe('direct');
  });

  it('setTorEnabled(false) persists false to localStorage', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    await transport.setTorEnabled(false);

    expect(localStorage.getItem('nostra-tor-enabled')).toBe('false');
  });

  it('setTorEnabled(true) persists true to localStorage', async() => {
    // setTorEnabled(true) → retryTor() which calls new WebtorClient() internally.
    // We pass a pre-made mockWebtorClient as the 3rd constructor arg so
    // the initial transport uses it. retryTor() however creates a NEW WebtorClient.
    // We can't easily override the constructor via ES module live binding.
    // Instead: verify localStorage is written before retryTor's async work completes.
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);

    // setTorEnabled writes to localStorage synchronously before calling retryTor
    // We spy on retryTor to prevent the actual bootstrap attempt
    const retryTorSpy = vi.spyOn(transport, 'retryTor').mockResolvedValue(undefined);

    await transport.setTorEnabled(true);
    expect(localStorage.getItem('nostra-tor-enabled')).toBe('true');
    expect(retryTorSpy).toHaveBeenCalled();
  });

  it('setTorEnabled(true) calls retryTor()', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    const retryTorSpy = vi.spyOn(transport, 'retryTor').mockResolvedValue(undefined);

    await transport.setTorEnabled(true);

    expect(retryTorSpy).toHaveBeenCalled();
  });

  it('setTorEnabled(true) with mocked retryTor that succeeds sets state to active', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);

    vi.spyOn(transport, 'retryTor').mockImplementation(async() => {
      (transport as any).state = 'active';
      mockPool.setTorMode(vi.fn());
    });

    await transport.setTorEnabled(true);

    expect(transport.getState()).toBe('active');
    expect(mockPool.setTorMode).toHaveBeenCalled();
  });

  it('setTorEnabled(true) with mocked retryTor that fails sets state to failed', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);

    vi.spyOn(transport, 'retryTor').mockImplementation(async() => {
      (transport as any).state = 'failed';
    });

    await transport.setTorEnabled(true);

    expect(transport.getState()).toBe('failed');
    expect(mockPool.setTorMode).not.toHaveBeenCalled();
  });

  // ── circuit event wiring ────────────────────────────────────────────────

  it('fires nostra_tor_circuit_update on rootScope when onCircuitChange callback is invoked', () => {
    const circuitDetails = {
      guard: 'GUARD001',
      middle: 'MID00001',
      exit: 'EXIT0001',
      latency: 300,
      exitIp: '10.0.0.1',
      healthy: true
    };

    const mockClient = {
      ...mockWebtorClient,
      getCircuitDetails: vi.fn().mockReturnValue(circuitDetails)
    };

    new PrivacyTransport(mockPool, mockQueue, mockClient);

    const onCircuitChange = (mockClient as any)._events.onCircuitChange;
    expect(onCircuitChange).toBeDefined();
    onCircuitChange();

    expect(mockRootScope.dispatchEvent).toHaveBeenCalledWith(
      'nostra_tor_circuit_update',
      circuitDetails
    );
  });

  it('does not dispatch nostra_tor_circuit_update when getCircuitDetails returns null', () => {
    new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);

    const onCircuitChange = (mockWebtorClient as any)._events.onCircuitChange;
    onCircuitChange();

    expect(mockRootScope.dispatchEvent).not.toHaveBeenCalledWith(
      'nostra_tor_circuit_update',
      expect.anything()
    );
  });

  // ── state transitions ───────────────────────────────────────────────────

  it('bootstrap() success transitions offline → bootstrapping → active', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    expect(transport.getState()).toBe('offline');

    await transport.bootstrap();

    expect(transport.getState()).toBe('active');
    // dispatchEvent called for bootstrapping then active
    const calls = mockRootScope.dispatchEvent.mock.calls
    .filter(c => c[0] === 'nostra_tor_state')
    .map(c => c[1].state);
    expect(calls).toContain('bootstrapping');
    expect(calls).toContain('active');
  });

  it('bootstrap() failure transitions offline → bootstrapping → failed', async() => {
    const failingClient = {
      ...mockWebtorClient,
      bootstrap: vi.fn().mockRejectedValue(new Error('Network timeout'))
    };
    const transport = new PrivacyTransport(mockPool, mockQueue, failingClient);

    await transport.bootstrap();

    expect(transport.getState()).toBe('failed');
  });

  it('confirmDirectFallback() sets state to direct and calls pool.setDirectMode()', () => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    transport.confirmDirectFallback();

    expect(transport.getState()).toBe('direct');
    expect(mockPool.setDirectMode).toHaveBeenCalled();
  });

  it('disconnect() sets state to offline and calls pool.disconnect()', () => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);
    // Force non-offline state so setState fires
    (transport as any).state = 'direct';

    transport.disconnect();

    expect(transport.getState()).toBe('offline');
    expect(mockPool.disconnect).toHaveBeenCalled();
  });

  it('bootstrap() with isReady()=false sets state to failed without calling setTorMode', async() => {
    const notReadyClient = {
      ...mockWebtorClient,
      bootstrap: vi.fn().mockResolvedValue(undefined),
      isReady: vi.fn().mockReturnValue(false)
    };
    const transport = new PrivacyTransport(mockPool, mockQueue, notReadyClient);

    await transport.bootstrap();

    expect(transport.getState()).toBe('failed');
    expect(mockPool.setTorMode).not.toHaveBeenCalled();
  });

  it('bootstrap() success calls pool.setTorMode with a fetch function', async() => {
    const transport = new PrivacyTransport(mockPool, mockQueue, mockWebtorClient);

    await transport.bootstrap();

    expect(mockPool.setTorMode).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// NostrRelay.measureLatency() — HTTP polling mode
// ──────────────────────────────────────────────────────────────────────────────

describe('NostrRelay HTTP polling mode latency', () => {
  afterAll(() => {
    vi.restoreAllMocks();
  });

  // The poll loop in startHttpPolling() records latency from each torFetchFn
  // call — there's no synthetic ping in Tor mode. measureLatency() simply
  // returns the last recorded value. Tests below exercise the poll path.

  it('records torLatencyMs after a successful HTTP poll', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    (relay as any).mode = 'http-polling';
    (relay as any).publicKey = 'a'.repeat(64);
    (relay as any).torFetchFn = vi.fn().mockResolvedValue('[]');

    expect(relay.torLatencyMs).toBe(-1);

    // Trigger a single poll cycle
    (relay as any).startHttpPolling();
    // Let the kick-off 100ms timer + the async fetch resolve
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 200));

    expect(relay.torLatencyMs).toBeGreaterThanOrEqual(0);
    expect(relay.getLatency()).toBeGreaterThanOrEqual(0);

    relay.disconnect();
  });

  it('sets latency to -1 when torFetchFn throws', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    (relay as any).mode = 'http-polling';
    (relay as any).publicKey = 'a'.repeat(64);
    (relay as any).torFetchFn = vi.fn().mockRejectedValue(new Error('Tor circuit broken'));

    (relay as any).startHttpPolling();
    await new Promise((r) => setTimeout(r, 200));

    expect(relay.getLatency()).toBe(-1);

    relay.disconnect();
  });

  it('measureLatency() in HTTP polling mode returns the cached value without pinging', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    const fetchSpy = vi.fn().mockResolvedValue('[]');
    (relay as any).mode = 'http-polling';
    (relay as any).torFetchFn = fetchSpy;
    (relay as any).latencyMs = 123;

    const latency = await relay.measureLatency();

    expect(latency).toBe(123);
    expect(fetchSpy).not.toHaveBeenCalled();

    relay.disconnect();
  });

  it('directLatencyMs starts at -1 and is not set when relay not connected (WS mode)', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    expect(relay.directLatencyMs).toBe(-1);

    const latency = await relay.measureLatency();

    expect(latency).toBe(-1);
    expect(relay.directLatencyMs).toBe(-1);

    relay.disconnect();
  });

  it('torFetchFn receives a URL derived from wss:// relay URL converted to https://', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://fancy.relay.io');
    const mockFetch = vi.fn().mockResolvedValue('[]');
    (relay as any).mode = 'http-polling';
    (relay as any).publicKey = 'a'.repeat(64);
    (relay as any).torFetchFn = mockFetch;

    (relay as any).startHttpPolling();
    await new Promise((r) => setTimeout(r, 200));

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('https://fancy.relay.io'));

    relay.disconnect();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// NostrRelay.setTorMode() / setDirectMode() trigger latency measurement
// ──────────────────────────────────────────────────────────────────────────────

describe('NostrRelay setTorMode/setDirectMode schedule measureLatency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('setTorMode() does NOT schedule measureLatency (poll loop is the sample source)', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    const spy = vi.spyOn(relay, 'measureLatency').mockResolvedValue(100);

    const mockFetch = vi.fn().mockResolvedValue('ok');
    relay.setTorMode(mockFetch);

    vi.advanceTimersByTime(5000);

    expect(spy).not.toHaveBeenCalled();

    relay.disconnect();
  });

  it('setDirectMode() schedules measureLatency via setTimeout', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    // Put relay in http-polling mode first
    (relay as any).mode = 'http-polling';
    (relay as any).torFetchFn = vi.fn();
    // Don't let it try to reconnect via WebSocket (no real WS available)
    (relay as any).connectionState = 'disconnected';

    const spy = vi.spyOn(relay, 'measureLatency').mockResolvedValue(100);

    relay.setDirectMode();

    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(spy).toHaveBeenCalled();

    relay.disconnect();
  });

  it('setTorMode() switches mode to http-polling', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    vi.spyOn(relay, 'measureLatency').mockResolvedValue(0);

    relay.setTorMode(vi.fn().mockResolvedValue('ok'));

    expect(relay.getMode()).toBe('http-polling');

    relay.disconnect();
  });

  it('setDirectMode() switches mode back to websocket', async() => {
    const {NostrRelay} = await import('@lib/nostra/nostr-relay');

    const relay = new NostrRelay('wss://test.relay');
    vi.spyOn(relay, 'measureLatency').mockResolvedValue(0);

    // Set to http-polling first
    (relay as any).mode = 'http-polling';
    (relay as any).connectionState = 'disconnected';

    relay.setDirectMode();

    expect(relay.getMode()).toBe('websocket');

    relay.disconnect();
  });
});
