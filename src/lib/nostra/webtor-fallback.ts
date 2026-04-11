/**
 * WebtorClient — webtor-rs WASM wrapper
 *
 * Mirrors the TorWasmClient interface exactly so PrivacyTransport can use
 * either as interchangeable fallback transports.
 *
 * webtor-rs is MIT licensed, built from privacy-ethereum/webtor-rs.
 * API: TorClient.create(options) + bootstrap() + fetch(url)
 *
 * Note: webtor-rs uses 'snowflakeWebRtc()' bridge — browsers can't run
 * Snowflake without a WebRTC proxy. In headless/test envs without network
 * access to Snowflake, bootstrap will fail. This is expected behavior.
 */

import initWebtor, {TorClient, TorClientOptions} from '/webtor/webtor_wasm';

// ---------------------------------------------------------------------------
// Types matching TorWasmClient interface
// ---------------------------------------------------------------------------

export type TorState = 'idle' | 'bootstrapping' | 'ready' | 'error';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ---------------------------------------------------------------------------
// Circuit status
// ---------------------------------------------------------------------------

interface CircuitStatus {
  healthy: boolean;
  readyCircuits: number;
  totalCircuits: number;
  failedCircuits: number;
  creatingCircuits: number;
}

export interface TorWasmEvents {
  onStateChange?: (state: TorState, error?: string) => void;
  onNostrEvent?: (event: NostrEvent) => void;
  onCircuitChange?: (status: CircuitStatus) => void;
}

export interface TorPrivacyClient {
  init(): Promise<void>;
  bootstrap(timeout_ms?: number): Promise<void>;
  fetch(url: string, options?: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  }): Promise<string>;
  subscribeNostr(relayUrl: string, subscriptionId: string, filters?: Record<string, unknown>): void;
  unsubscribeNostr(subscriptionId: string): void;
  is_ready(): boolean;
  isReady(): boolean;
  getStatus(): TorState;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// WebtorClient
// ---------------------------------------------------------------------------

export class WebtorClient implements TorPrivacyClient {
  private _client: TorClient | null = null;
  private _state: TorState = 'idle';
  private _events: TorWasmEvents;
  private _pollingIntervals: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private _activeSubscriptions: Map<string, { lastPolled: number; filters: Record<string, unknown> }> = new Map();
  private _initPromise: Promise<void> | null = null;
  private _bootstrapPromise: Promise<void> | null = null;
  private _moduleReady = false;
  private _pollTimeout = 2000; // ms between Nostr polls (matches TorWasmClient)

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Constructor matches TorWasmClient signature.
   * @param events Callbacks for state, Nostr events, circuit health
   * @param _bridgeUrl Ignored (webtor-rs uses Snowflake WebRTC internally)
   */
  constructor(events: TorWasmEvents = {}, _bridgeUrl: string | null = null) {
    this._events = events;
    // bridgeUrl is ignored — webtor-rs uses snowflakeWebRtc() internally
  }

  /**
   * Initialize webtor-rs WASM module. Safe to call multiple times.
   */
  async init(): Promise<void> {
    if(this._initPromise) return this._initPromise;
    this._initPromise = this._init();
    return this._initPromise;
  }

  private async _init(): Promise<void> {
    console.debug('[WebtorClient] Initializing webtor-rs WASM module...');
    await initWebtor();
    this._moduleReady = true;
    console.debug('[WebtorClient] webtor-rs module ready');
  }

  /**
   * Bootstrap Tor circuit via Snowflake WebRTC.
   * Matches TorWasmClient.bootstrap() signature.
   *
   * @param timeout_ms Bootstrap timeout in milliseconds (default 60s)
   */
  async bootstrap(timeout_ms = 60000): Promise<void> {
    if(this._bootstrapPromise) return this._bootstrapPromise;

    // No-op if already ready
    if(this._state === 'ready' && this._client !== null) {
      console.log('[WebtorClient] already bootstrapped');
      return Promise.resolve();
    }

    this._setState('bootstrapping');

    this._bootstrapPromise = (async() => {
      try {
        await this.init();

        console.debug('[WebtorClient] Creating TorClient via Snowflake WebRTC...');
        this._setState('bootstrapping');

        const options = TorClientOptions.snowflakeWebRtc()
        .withConnectionTimeout(30_000)
        .withCircuitTimeout(45_000)
        .withCreateCircuitEarly(true);

        this._client = await TorClient.create(options);

        // Wait for first circuit to be ready
        console.debug('[WebtorClient] Waiting for Tor circuit...');
        await this._waitForCircuit(timeout_ms);

        this._setState('ready');
        console.info('[WebtorClient] webtor-rs connected via Tor circuit');

        // Start circuit health polling (for onCircuitChange events)
        this._startCircuitPolling();
      } catch(err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._setState('error', msg);
        throw err;
      }
    })();

    return this._bootstrapPromise;
  }

  private async _waitForCircuit(timeoutMs: number): Promise<void> {
    if(!this._client) return;

    const deadline = Date.now() + timeoutMs;

    while(Date.now() < deadline) {
      try {
        const status = await this._client.getCircuitStatus();

        if(status.has_ready_circuits) {
          console.debug('[WebtorClient] Circuit ready:', {
            ready: status.ready_circuits,
            total: status.total_circuits
          });
          return;
        }

        await this._delay(500);
      } catch{
        // getCircuitStatus may fail during bootstrap — keep polling
        await this._delay(500);
      }
    }

    throw new Error(`webtor-rs: circuit not ready after ${timeoutMs}ms`);
  }

  private _startCircuitPolling(): void {
    const timer = setInterval(async() => {
      if(!this._client || this._state !== 'ready') return;

      try {
        const status = await this._client.getCircuitStatus();
        const cs: CircuitStatus = {
          healthy: status.is_healthy,
          readyCircuits: status.ready_circuits,
          totalCircuits: status.total_circuits,
          failedCircuits: status.failed_circuits,
          creatingCircuits: status.creating_circuits
        };
        this._events.onCircuitChange?.(cs);
      } catch{
        // Ignore polling errors
      }
    }, 10_000);

    // Store for cleanup
    this._pollingIntervals.set('_circuitPoll', timer);
  }

  // ---------------------------------------------------------------------------
  // HTTP fetch (matches TorWasmClient interface)
  // ---------------------------------------------------------------------------

  /**
   * Fetch a URL through Tor circuit.
   * Matches TorWasmClient.fetch(url, options) → string interface.
   */
  async fetch(url: string, options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
  } = {}): Promise<string> {
    if(!this._client || this._state !== 'ready') {
      throw new Error('WebtorClient not ready. Call bootstrap() first.');
    }

    const {method = 'GET', headers, body} = options;

    if(method === 'POST' && body !== undefined) {
      const headersJson = JSON.stringify(headers ?? {});
      return this._client.post(url, new TextEncoder().encode(
        JSON.stringify({headers: headersJson, body})
      )).then(r => r.text());
    }

    return this._client.fetch(url).then(r => r.text());
  }

  // ---------------------------------------------------------------------------
  // Nostr subscription (matches TorWasmClient interface)
  // ---------------------------------------------------------------------------

  subscribeNostr(relayUrl: string, subscriptionId: string, filters: Record<string, unknown> = {}): void {
    if(this._state !== 'ready') {
      console.warn('[WebtorClient] not ready for Nostr subscription');
      return;
    }

    // Remove existing subscription if re-subscribing
    this.unsubscribeNostr(subscriptionId);

    const req = {
      subscriptionId,
      filters,
      lastPolled: Math.floor(Date.now() / 1000) - 60
    };
    this._activeSubscriptions.set(subscriptionId, req);

    const poll = async() => {
      if(this._state !== 'ready') return;

      try {
        const since = req.lastPolled;
        const params = new URLSearchParams();
        if(filters['authors']) params.set('authors', filters['authors'] as string);
        if(filters['kinds']) params.set('kinds', String(filters['kinds']));
        params.set('since', String(since));

        const url = `${relayUrl}/?${params.toString()}`;
        const body = await this.fetch(url);

        let events: NostrEvent[] = [];
        try {
          events = JSON.parse(body);
        } catch{
          // Empty or invalid response — ignore
        }

        if(Array.isArray(events) && events.length > 0) {
          const maxCreated = Math.max(...events.map(e => e.created_at ?? 0));
          req.lastPolled = maxCreated + 1;

          for(const event of events) {
            this._events.onNostrEvent?.(event);
          }
          console.debug(`[WebtorClient] Nostr: ${events.length} new events from ${relayUrl}`);
        }
      } catch(err) {
        console.warn(`[WebtorClient] Nostr poll error for ${subscriptionId}:`, err);
      }

      // Schedule next poll
      const intervalId = setTimeout(poll, this._pollTimeout);
      this._pollingIntervals.set(subscriptionId, intervalId);
    };

    // Start polling immediately
    const intervalId = setTimeout(poll, 100);
    this._pollingIntervals.set(subscriptionId, intervalId);
    console.debug(`[WebtorClient] Nostr subscription started: ${subscriptionId} → ${relayUrl}`);
  }

  unsubscribeNostr(subscriptionId: string): void {
    const intervalId = this._pollingIntervals.get(subscriptionId);
    if(intervalId !== undefined) {
      clearTimeout(intervalId);
      this._pollingIntervals.delete(subscriptionId);
    }
    this._activeSubscriptions.delete(subscriptionId);
    console.debug(`[WebtorClient] Nostr subscription stopped: ${subscriptionId}`);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  is_ready(): boolean {
    return this._state === 'ready' && this._client !== null;
  }

  // Alias (PrivacyTransport uses isReady() in some paths)
  isReady(): boolean {
    return this.is_ready();
  }

  getStatus(): TorState {
    return this._state;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async close(): Promise<void> {
    // Clear all polling intervals
    for(const intervalId of this._pollingIntervals.values()) {
      clearTimeout(intervalId);
    }
    this._pollingIntervals.clear();
    this._activeSubscriptions.clear();

    if(this._client) {
      try {
        await this._client.close();
      } catch{
        // Ignore close errors
      }
      this._client = null;
    }

    this._state = 'idle';
    this._setState('idle');
    this._bootstrapPromise = null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _setState(state: TorState, error?: string): void {
    this._state = state;
    this._events.onStateChange?.(state, error);
  }

  private _delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
