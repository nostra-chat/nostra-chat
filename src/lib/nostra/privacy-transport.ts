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

  constructor(relayPool: NostrRelayPool, offlineQueue: OfflineQueue, webtorClient?: WebtorClient) {
    this.relayPool = relayPool;
    this.offlineQueue = offlineQueue;
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
   * 2. Create WebtorClient, attempt bootstrap (60s timeout)
   * 3. On success: switch pool to Tor mode, set state to active
   * 4. On failure: set state to failed (NOT direct — user must confirm)
   */
  async bootstrap(): Promise<void> {
    this.setState('bootstrapping');

    try {
      await this.webtorClient.bootstrap(60000);

      if(this.webtorClient.isReady()) {
        // Switch all relays to HTTP polling via Tor
        const fetchFn = (url: string) => this.webtorClient.fetch(url);
        this.relayPool.setTorMode(fetchFn);
        this.setState('active');
      } else {
        this.setState('failed');
      }
    } catch(err) {
      // Tor failed — do NOT auto-fallback (PRIV-03, Pitfall 4)
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.setState('failed', errorMsg);
    }
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
   */
  async retryTor(): Promise<void> {
    this.setState('bootstrapping');

    try {
      // Create fresh WebtorClient
      this.webtorClient = new WebtorClient();
      await this.webtorClient.bootstrap(60000);

      if(this.webtorClient.isReady()) {
        const fetchFn = (url: string) => this.webtorClient.fetch(url);
        this.relayPool.setTorMode(fetchFn);
        this.setState('active');

        // Flush queued messages
        this.flushQueue();
      } else {
        this.setState('failed');
      }
    } catch(err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.setState('failed', errorMsg);
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
