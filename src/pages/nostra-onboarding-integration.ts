/**
 * Nostra.chat Onboarding Integration for tweb
 *
 * Mounts NostraOnboarding inside tweb's auth-pages container when
 * `?nostra=1` is set, replacing the phone/SMS auth flow.
 *
 * Flow:
 * 1. User lands on / (no identity) → sees NostraOnboarding UI
 * 2. User generates identity → onIdentityCreated callback fires
 * 3. Callback: init NostraBridge → store own mapping → enable flag → mount chat → init Virtual MTProto Server
 * 4. User reloads (identity exists) → init() → showExistingIdentity → callback fires → mount chat → init Virtual MTProto Server
 */

import {loadEncryptedIdentity, loadBrowserKey, decryptKeys} from '../lib/nostra/key-storage';
import {importFromMnemonic} from '../lib/nostra/nostr-identity';
import {NostraBridge} from '../lib/nostra/nostra-bridge';
import {NostraOnboarding} from './nostra/onboarding';
import {ChatAPI} from '../lib/nostra/chat-api';
import {NostraMTProtoServer} from '../lib/nostra/virtual-mtproto-server';
import {NostraSync} from '../lib/nostra/nostra-sync';
import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '../lib/rootScope';
import {handleIncomingMessage} from '@lib/nostra/nostra-message-handler';
import {createPendingFlush} from '@lib/nostra/nostra-pending-flush';
import {createReadReceiptSender} from '@lib/nostra/nostra-read-receipts';
import {createDeliveryUI} from '@lib/nostra/nostra-delivery-ui';
// tweb-contained CSS no longer needed — onboarding uses native tweb styles

declare global {
  interface Window {
    __nostraChatAPI?: ChatAPI;
  }
}

export interface OnboardingMount {
  onboarding: NostraOnboarding;
  destroy: () => void;
}

/**
 * Mount NostraOnboarding into a container element.
 */
export async function mountNostraOnboarding(container: HTMLElement): Promise<OnboardingMount> {
  const onboarding = new NostraOnboarding();
  container.appendChild(onboarding.container);

  let identityHandled = false;

  const handleIdentity = async() => {
    if(identityHandled) return;
    identityHandled = true;
    window.removeEventListener('nostra-identity-created', handleIdentityFallback);
    console.log('[NostraOnboardingIntegration] onIdentityCreated fired');

    try {
      // --- Load & decrypt identity ---
      const record = await loadEncryptedIdentity();
      if(!record) {
        console.error('[NostraOnboardingIntegration] no identity in callback');
        return;
      }
      const browserKey = await loadBrowserKey();
      if(!browserKey) {
        console.error('[NostraOnboardingIntegration] browser key missing');
        return;
      }
      const {seed} = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
      const identity = importFromMnemonic(seed);

      // Populate nostraIdentity store
      rootScope.dispatchEvent('nostra_identity_loaded', {
        npub: identity.npub,
        displayName: record.displayName || null,
        nip05: undefined,
        protectionType: 'none'
      });

      // --- Initialize bridge ---
      const bridge = NostraBridge.getInstance();
      await bridge.init(identity.publicKey);

      // Publish NIP-65 relay list
      try {
        const privKeyBytes = new Uint8Array(identity.privateKey.match(/.{2}/g)!.map(b => parseInt(b, 16)));
        bridge.publishNip65(privKeyBytes);
      } catch(err) {
        console.warn('[NostraOnboardingIntegration] NIP-65 publish failed:', err);
      }

      // Store own-pubkey → own-peerId mapping
      const ownPeerId = await bridge.mapPubkeyToPeerId(identity.publicKey);
      await bridge.storePeerMapping(identity.publicKey, ownPeerId, record.displayName || 'Me');
      console.log('[NostraOnboardingIntegration] own mapping stored: peerId', ownPeerId);

      // --- Initialize Virtual MTProto Server ---
      const server = new NostraMTProtoServer();
      server.setOwnPubkey(identity.publicKey);
      const proxy = MOUNT_CLASS_TO.apiManagerProxy;
      if(proxy) {
        proxy.setNostraMTProtoServer(server);
      }
      (window as any).__nostraMTProtoServer = server;
      (window as any).__nostraOwnPubkey = identity.publicKey;
      console.log('[NostraOnboardingIntegration] Virtual MTProto Server registered');

      // --- Mount chat page ---
      const pageIm = await import('./pageIm');
      pageIm.default.mount();

      // Re-dispatch identity_loaded so stores registered inside pageIm module graph
      // (e.g. nostraIdentity.ts) pick up the npub after their module is loaded.
      rootScope.dispatchEventSingle('nostra_identity_loaded', {
        npub: identity.npub,
        displayName: record.displayName || null,
        nip05: undefined,
        protectionType: 'none'
      });

      // --- Initialize ChatAPI ---
      const chatAPI = new ChatAPI(identity.publicKey);
      window.__nostraChatAPI = chatAPI;
      server.setChatAPI(chatAPI);
      console.log('[NostraOnboardingIntegration] ChatAPI initialized');

      // --- Initialize GroupAPI ---
      try {
        const {initGroupAPI} = await import('@lib/nostra/group-api');
        const privKeyBytes = new Uint8Array(identity.privateKey.match(/.{2}/g)!.map(b => parseInt(b, 16)));
        const pool = bridge.getRelayPool();
        const publishFn = async(events: any[]) => {
          if(!pool) return;
          for(const event of events) {
            await pool.publishRawEvent(event);
          }
        };
        initGroupAPI(identity.publicKey, privKeyBytes, publishFn);
        console.log('[NostraOnboardingIntegration] GroupAPI initialized');
      } catch(err) {
        console.warn('[NostraOnboardingIntegration] GroupAPI init failed:', err);
      }

      // --- Initialize NostraSync ---
      const sync = new NostraSync(identity.publicKey, (event: string, data: any) => {
        rootScope.dispatchEvent(event as any, data);
      });
      chatAPI.onMessage = (msg: any) => {
        sync.onIncomingMessage(msg, msg.from);
      };
      console.log('[NostraOnboardingIntegration] NostraSync wired to ChatAPI');

      // Defer the ChatAPI's global subscription until the PrivacyTransport
      // has settled when Tor is enabled. ChatAPI owns its own NostrRelayPool
      // which would otherwise open direct WebSockets to every relay the
      // moment initGlobalSubscription runs — leaking the user IP for the
      // full duration of the Tor bootstrap.
      const startChatAPI = () => {
        chatAPI.initGlobalSubscription().catch((err) => {
          console.warn('[NostraOnboardingIntegration] global subscription failed:', err);
        });
      };
      const transport = (window as any).__nostraTransport;
      const torEnabled = typeof localStorage !== 'undefined' && localStorage.getItem('nostra-tor-enabled') !== 'false';
      if(torEnabled && transport && typeof transport.waitUntilSettled === 'function') {
        transport.waitUntilSettled().then(startChatAPI).catch(startChatAPI);
      } else {
        startChatAPI();
      }

      // --- Wire extracted modules ---
      const pendingFlush = createPendingFlush();
      const readReceipts = createReadReceiptSender();
      const deliveryUI = createDeliveryUI();

      // Incoming message handler
      rootScope.addEventListener('nostra_new_message', async(data) => {
        try {
          const result = await handleIncomingMessage(data, identity.publicKey);
          if(result) {
            pendingFlush.enqueue(result.peerId, result.msg);
          }
        } catch(err) {
          console.warn('[NostraOnboardingIntegration] nostra_new_message handler error:', err);
        }
      });

      // Pending flush with read receipts on peer open
      pendingFlush.attachListener((peerId) => {
        readReceipts.sendForPeer(peerId).catch((err) => {
          console.warn('[NostraOnboardingIntegration] markRead batch failed:', err);
        });
      });
      pendingFlush.startPeriodicFlush();

      // Delivery status UI
      deliveryUI.attach();

      // Trigger initial dialog refresh
      setTimeout(() => {
        rootScope.dispatchEvent('dialogs_multiupdate', new Map());
      }, 1000);

      // --- Initialize presence ---
      try {
        const {initPresence} = await import('@lib/nostra/nostra-presence');
        await initPresence(identity.publicKey, identity.privateKey);
        console.log('[NostraOnboardingIntegration] presence initialized');
      } catch(err) {
        console.warn('[NostraOnboardingIntegration] presence init failed:', err);
      }

      // --- Publish kind 0 metadata ---
      if(record.displayName) {
        setTimeout(async() => {
          try {
            const pool = (chatAPI as any).relayPool;
            if(!pool || !pool.isConnected()) {
              await new Promise((r) => setTimeout(r, 3000));
            }
            const {finalizeEvent} = await import('nostr-tools/pure');
            const {loadEncryptedIdentity: loadEI, loadBrowserKey: loadBK, decryptKeys: dK} = await import('../lib/nostra/key-storage');
            const {importFromMnemonic: iFM} = await import('../lib/nostra/nostr-identity');
            const {hexToBytes} = await import('nostr-tools/utils');

            const encRecord = await loadEI();
            const bk = await loadBK();
            if(!encRecord || !bk) throw new Error('No encrypted identity');
            const {seed: s} = await dK(encRecord.iv, encRecord.encryptedKeys, bk);
            const id = iFM(s);
            const sk = hexToBytes(id.privateKey);

            const event = finalizeEvent({
              kind: 0,
              created_at: Math.floor(Date.now() / 1000),
              tags: [],
              content: JSON.stringify({display_name: record.displayName, name: record.displayName})
            }, sk);

            await pool.publishRawEvent(event);
            console.log('[NostraOnboardingIntegration] kind 0 metadata published:', record.displayName);
          } catch(err) {
            console.warn('[NostraOnboardingIntegration] kind 0 publish failed:', err);
          }
        }, 3000);
      }
    } catch(err) {
      console.error('[NostraOnboardingIntegration] error during identity post-processing:', err);
    }
  };

  onboarding.onIdentityCreated = handleIdentity;

  const handleIdentityFallback = () => handleIdentity();
  window.addEventListener('nostra-identity-created', handleIdentityFallback);

  await onboarding.init();

  return {
    onboarding,
    destroy: () => onboarding.destroy()
  };
}
