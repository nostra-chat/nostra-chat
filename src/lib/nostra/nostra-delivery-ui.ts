/**
 * nostra-delivery-ui.ts
 *
 * Handles delivery status UI updates (sent → delivered → read) on message bubbles.
 * Listens to nostra_delivery_update events and updates bubble DOM + icons.
 * Extracted from nostra-onboarding-integration.ts for testability.
 */

import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '@lib/rootScope';

export interface DeliveryUIManager {
  /** Start listening for delivery updates */
  attach(): void;
}

/**
 * Apply delivery state to a bubble element.
 * Returns true if the bubble was found and updated.
 */
export async function applyBubbleState(mid: string, state: 'delivered' | 'read'): Promise<boolean> {
  const bubble = document.querySelector<HTMLElement>(`.bubble[data-mid="${CSS.escape(mid)}"]`);
  if(!bubble) return false;
  bubble.classList.remove('is-sending', 'is-error', 'is-sent');
  bubble.classList.add('is-read');
  if(state === 'read') bubble.classList.add('is-p2p-read');

  const Icon = (await import('@components/icon')).default;
  bubble.querySelectorAll<HTMLElement>('.time, .time-inner').forEach((element) => {
    const existing = element.querySelector('.time-sending-status');
    const newIcon = Icon('checks' as any, 'time-sending-status');
    if(existing) existing.replaceWith(newIcon);
    else element.prepend(newIcon);
  });
  return true;
}

/**
 * Refresh the chat list preview after a sent message.
 * Worker's send shortcut returns emptyUpdates, so tweb never triggers
 * the normal updateNewMessage → dialog_update flow.
 */
async function refreshDialogPreview(numericPeerId: number): Promise<void> {
  const {NostraPeerMapper} = await import('@lib/nostra/nostra-peer-mapper');
  const mapper = new NostraPeerMapper();
  const {getMessageStore} = await import('@lib/nostra/message-store');
  const store = getMessageStore();
  const ownPk = (window as any).__nostraOwnPubkey;
  const {getPubkey} = await import('@lib/nostra/virtual-peers-db');
  const peerPk = await getPubkey(numericPeerId);
  if(!ownPk || !peerPk) return;

  const convId = store.getConversationId(ownPk, peerPk);
  const latest = (await store.getMessages(convId, 1))[0];
  if(!latest) return;

  const mid = latest.mid ?? await mapper.mapEventId(latest.eventId, latest.timestamp);
  const isOut = latest.isOutgoing ?? (latest.senderPubkey === ownPk);
  const msg = mapper.createTwebMessage({
    mid,
    peerId: numericPeerId,
    fromPeerId: isOut ? undefined : numericPeerId,
    date: latest.timestamp,
    text: latest.content,
    isOutgoing: isOut
  });

  const proxy = MOUNT_CLASS_TO.apiManagerProxy;
  if(proxy?.mirrors?.messages) {
    const storageKey = `${numericPeerId}_history`;
    if(!proxy.mirrors.messages[storageKey]) proxy.mirrors.messages[storageKey] = {};
    proxy.mirrors.messages[storageKey][mid] = msg;
  }

  const dialog = mapper.createTwebDialog({
    peerId: numericPeerId,
    topMessage: mid,
    topMessageDate: latest.timestamp,
    unreadCount: 0
  });
  const dispatchFn = () => rootScope.dispatchEvent('dialogs_multiupdate' as any, new Map([[
    (numericPeerId as any).toPeerId ? (numericPeerId as any).toPeerId(false) : numericPeerId,
    {dialog}
  ]]));
  dispatchFn();
  setTimeout(dispatchFn, 300);
}

export function createDeliveryUI(): DeliveryUIManager {
  // Map from tracker eventId (chat-XXX-N) to the bubble's data-mid.
  const eventIdToBubbleMid = new Map<string, string>();

  const handleSent = async(eventId: string) => {
    const tracked = new Set(eventIdToBubbleMid.values());
    const captureLatest = () => {
      const bubbles = document.querySelectorAll<HTMLElement>('.bubble.is-out[data-mid]');
      for(let i = bubbles.length - 1; i >= 0; i--) {
        const mid = bubbles[i].dataset.mid;
        if(!mid || tracked.has(mid)) continue;
        eventIdToBubbleMid.set(eventId, mid);
        return true;
      }
      return false;
    };
    if(!captureLatest()) {
      for(const delay of [100, 300, 800, 2000]) {
        await new Promise((r) => setTimeout(r, delay));
        if(captureLatest()) break;
      }
    }

    // Refresh chat list preview
    try {
      const im = MOUNT_CLASS_TO.appImManager;
      const chatPid = im?.chat?.peerId;
      if(chatPid) {
        await refreshDialogPreview(+chatPid);
      }
    } catch{ /* non-critical */ }
  };

  const handleDeliveredOrRead = async(eventId: string, state: 'delivered' | 'read') => {
    let mid = eventIdToBubbleMid.get(eventId);
    if(!mid) {
      const {NostraPeerMapper} = await import('@lib/nostra/nostra-peer-mapper');
      const mapper = new NostraPeerMapper();
      const {getMessageStore: gms2} = await import('@lib/nostra/message-store');
      const stored = await gms2().getByEventId(eventId);
      const ts = stored?.timestamp ?? Math.floor(Date.now() / 1000);
      const hashed = await mapper.mapEventId(eventId, ts);
      if(hashed) mid = String(hashed);
    }
    if(!mid) return;

    if(!await applyBubbleState(mid, state)) {
      for(const delay of [300, 800, 2000]) {
        await new Promise((r) => setTimeout(r, delay));
        if(await applyBubbleState(mid, state)) break;
      }
    }
  };

  return {
    attach() {
      rootScope.addEventListener('nostra_delivery_update', async(data: any) => {
        try {
          const state = data?.state;
          const eventId = data?.eventId;
          if(!eventId || !state) return;

          if(state === 'sent') {
            await handleSent(eventId);
            return;
          }

          if(state === 'delivered' || state === 'read') {
            await handleDeliveredOrRead(eventId, state);
          }
        } catch(err) {
          console.warn('[NostraDeliveryUI] nostra_delivery_update handler error:', err);
        }
      });
    }
  };
}
