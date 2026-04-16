/**
 * PrivacyTransport — Pool-Level Tor Privacy Wrapper (Phase 3)
 *
 * Wraps the entire NostrRelayPool with a shared WebtorClient instance.
 * Routes all relay traffic through Tor HTTP polling when available.
 *
 * Fallback chain:
 * 1. webtor-rs — HTTP polling through Tor circuit (IP hidden)
 * 2. Direct WebSocket — only after explicit user confirmation (PRIV-03)
 *
 * Architecture decisions:
 * - No WebRTC in v1 (relay-only, per architecture decision)
 * - No PeerTransport dependency
 * - Single shared WebtorClient for all relays in pool
 * - Messages queued during Tor bootstrap (OfflineQueue)
 * - Tor failure does NOT auto-fallback — user must confirm
 */

import {NostrRelayPool, PublishResult} from './nostr-relay-pool';
import {OfflineQueue} from './offline-queue';
import {WebtorClient} from './webtor-fallback';
import rootScope from '@lib/rootScope';

export type PrivacyTransportState =
  | 'bootstrapping'       // Tor circuit creating
  | 'active'              // Tor active, HTTP polling
  | 'direct'              // Direct WebSocket (user confirmed)
  | 'failed'              // Tor failed, awaiting user decision
  | 'offline';            // Disconnected

/**
 * PrivacyTransport — Tor-wrapped relay pool
 *
 * Wraps NostrRelayPool with shared WebtorClient for IP privacy.
 * Exposes send/receive interface with automatic queuing during bootstrap.
 */
export class PrivacyTransport {
  private relayPool: NostrRelayPool;
  private webtorClient: WebtorClient;
  private state: PrivacyTransportState = 'offline';
  private offlineQueue: OfflineQueue;
  // True when the WebtorClient was supplied via constructor (tests inject
  // mocks). In that case the retry loop must NOT construct a fresh real
  // WebtorClient on failure — that would wipe out the injected mock and
  // try to load the real WASM module in a jsdom test environment.
  private webtorInjected: boolean;

  constructor(relayPool: NostrRelayPool, offlineQueue: OfflineQueue, webtorClient?: WebtorClient) {
    this.relayPool = relayPool;
    this.offlineQueue = offlineQueue;
    this.webtorInjected = !!webtorClient;
    this.webtorClient = webtorClient || new WebtorClient();

    // Wire circuit change callback to dispatch rootScope event
    if(this.webtorClient) {
      const origEvents = (this.webtorClient as any)._events || {};
      (this.webtorClient as any)._events = {
        ...origEvents,
        onCircuitChange: () => {
          const details = this.webtorClient?.getCircuitDetails?.();
          if(details) {
            rootScope.dispatchEvent('nostra_tor_circuit_update', details);
          }
        }
      };
    }

    // Expose for debug inspection
    if(typeof window !== 'undefined') {
      (window as any).__nostraPrivacyTransport = this;
    }
  }

  static isTorEnabled(): boolean {
    const stored = localStorage.getItem('nostra-tor-enabled');
    return stored !== 'false'; // default true
  }

  async setTorEnabled(enabled: boolean) {
    localStorage.setItem('nostra-tor-enabled', String(enabled));

    try {
      const rootScope = (await import('@lib/rootScope')).default;
      rootScope.dispatchEvent('nostra_tor_enabled_changed', enabled);
    } catch{}

    if(enabled) {
      await this.retryTor();
    } else {
      this.confirmDirectFallback();
    }
  }

  /**
   * Bootstrap privacy transport.
   *
   * 1. Set state to bootstrapping, dispatch event
   * 2. Create WebtorClient, attempt bootstrap (180s per attempt)
   * 3. On per-attempt failure: dispose the client, create a fresh one, retry
   *    (the underlying WebRTC peer can wedge into "Channel not established"
   *    and never recover — only a brand-new client gets a new tunnel)
   * 4. On success: switch pool to Tor mode, set state to active
   * 5. On final failure: set state to failed (NOT direct — user must confirm)
   */
  async bootstrap(): Promise<void> {
    this.setState('bootstrapping');

    const maxAttempts = 4;
    const perAttemptMs = 60_000;
    let lastErr: unknown = null;

    for(let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.webtorClient.bootstrap(perAttemptMs);

        if(this.webtorClient.isReady()) {
          const fetchFn = (url: string) => this.webtorClient.fetch(url);
          this.relayPool.setTorMode(fetchFn);
          this.setState('active');
          return;
        }
      } catch(err) {
        lastErr = err;
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[PrivacyTransport] bootstrap attempt ${attempt}/${maxAttempts} failed: ${errorMsg}`);

        if(attempt < maxAttempts) {
          // Tear down the wedged client and build a fresh one (only when
          // we own the client lifecycle — injected test mocks stay put).
          try { await this.webtorClient.close(); } catch{}
          if(!this.webtorInjected) {
            this.webtorClient = new WebtorClient();
          }
          continue;
        }
      }
    }

    const errorMsg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'webtor not ready');
    this.setState('failed', errorMsg);
  }

  /**
   * User confirmed direct fallback — switch pool to direct WebSocket.
   * Only call this after Tor failure and explicit user consent.
   */
  confirmDirectFallback(): void {
    this.relayPool.setDirectMode();
    this.setState('direct');

    // Flush queued messages now that we have connectivity
    this.flushQueue();
  }

  /**
   * Retry Tor bootstrap after previous failure.
   * Starts from a fresh WebtorClient (unless one was injected via
   * constructor) and reuses bootstrap()'s retry loop.
   */
  async retryTor(): Promise<void> {
    try { await this.webtorClient.close(); } catch{}
    if(!this.webtorInjected) {
      this.webtorClient = new WebtorClient();
    }
    await this.bootstrap();
    if(this.state === 'active') {
      this.flushQueue();
    }
  }

  /**
   * Send a message.
   *
   * - If bootstrapping or failed: queue via OfflineQueue
   * - If active or direct: publish via relayPool
   */
  async send(recipientPubkey: string, plaintext: string): Promise<PublishResult | null> {
    if(this.state === 'bootstrapping' || this.state === 'failed' || this.state === 'offline') {
      // Queue message — will be flushed when transport ready
      const messageId = await this.offlineQueue.queue(recipientPubkey, plaintext);
      rootScope.dispatchEvent('nostra_message_queued', {messageId, status: 'queued'});
      return null;
    }

    // Active or direct — publish via pool
    const result = await this.relayPool.publish(recipientPubkey, plaintext);

    if(result.successes.length > 0) {
      rootScope.dispatchEvent('nostra_message_queued', {
        messageId: result.successes[0],
        status: 'sent'
      });
    }

    return result;
  }

  /**
   * Get current transport state.
   */
  getState(): PrivacyTransportState {
    return this.state;
  }

  /**
   * Resolve when the transport reaches a "settled" state —
   * `active`, `direct`, or `failed`. `bootstrapping` and `offline`
   * are considered in-flight.
   *
   * Used by the startup flow to gate `pool.initialize()` so no
   * WebSocket is opened while Tor is still building its circuit.
   *
   * Resolves immediately if already settled.
   */
  waitUntilSettled(): Promise<PrivacyTransportState> {
    const isSettled = (s: PrivacyTransportState) =>
      s === 'active' || s === 'direct' || s === 'failed';

    if(isSettled(this.state)) {
      return Promise.resolve(this.state);
    }

    return new Promise((resolve) => {
      const handler = (e: {state: string; error?: string}) => {
        const s = e.state as PrivacyTransportState;
        if(isSettled(s)) {
          rootScope.removeEventListener('nostra_tor_state', handler);
          resolve(s);
        }
      };
      rootScope.addEventListener('nostra_tor_state', handler);
    });
  }

  /**
   * Disconnect — clean up all resources.
   */
  disconnect(): void {
    this.relayPool.disconnect();

    if(this.webtorClient) {
      void this.webtorClient.close();
    }

    this.setState('offline');
  }

  // ─── Private ───────────────────────────────────────────────────

  private setState(state: PrivacyTransportState, error?: string): void {
    if(this.state === state) return;
    this.state = state;

    rootScope.dispatchEvent('nostra_tor_state', {
      state: state === 'active' ? 'active' : state as any,
      error
    });
  }

  private flushQueue(): void {
    // Flush all queued messages
    const queued = this.offlineQueue.getQueued();
    for(const msg of queued) {
      this.relayPool.publish(msg.to, msg.payload).catch(() => {
        // Re-queue on failure — handled by OfflineQueue
      });
    }
  }
}
