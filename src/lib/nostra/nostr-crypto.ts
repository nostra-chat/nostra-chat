import * as nip44 from 'nostr-tools/nip44';
import {generateSecretKey, getPublicKey, finalizeEvent, getEventHash} from 'nostr-tools/pure';
import {bytesToHex} from 'nostr-tools/utils';
import {wrapManyEvents, unwrapEvent as nip17UnwrapEvent} from 'nostr-tools/nip17';
import {createRumor as createNip59Rumor, createSeal as createNip59Seal, createWrap as createNip59Wrap} from 'nostr-tools/nip59';
// nostr-tools NostrEvent shape used by nip17/nip59 functions
export type NTNostrEvent = {kind: number; content: string; pubkey: string; created_at: number; tags: string[][]; id: string; sig: string};

export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
  id: string;
}

export interface SignedEvent extends UnsignedEvent {
  sig: string;
}

/**
 * In-memory conversation key cache.
 * Keyed by "{senderPrivHex}:{recipientPubHex}" to ensure uniqueness.
 */
const conversationKeyCache = new Map<string, Uint8Array>();

/**
 * Clear the conversation key cache (call on logout/lock).
 */
export function clearConversationKeyCache(): void {
  conversationKeyCache.clear();
}

/**
 * Get or compute a NIP-44 conversation key for a sender/recipient pair.
 */
export function getConversationKey(senderPriv: Uint8Array, recipientPubHex: string): Uint8Array {
  const cacheKey = bytesToHex(senderPriv) + ':' + recipientPubHex;
  const cached = conversationKeyCache.get(cacheKey);
  if(cached) {
    return cached;
  }
  const convKey = nip44.v2.utils.getConversationKey(senderPriv, recipientPubHex);
  conversationKeyCache.set(cacheKey, convKey);
  return convKey;
}

/**
 * Encrypt plaintext using NIP-44 v2.
 */
export function nip44Encrypt(plaintext: string, conversationKey: Uint8Array): string {
  return nip44.v2.encrypt(plaintext, conversationKey);
}

/**
 * Decrypt ciphertext using NIP-44 v2.
 */
export function nip44Decrypt(ciphertext: string, conversationKey: Uint8Array): string {
  return nip44.v2.decrypt(ciphertext, conversationKey);
}

// ==================== NIP-17 Gift-Wrap API (nostr-tools/nip17) ====================

/**
 * Wrap a text message as NIP-17 gift-wrap events for recipient AND sender (self-send).
 * Returns an array of kind 1059 events ready for relay publishing.
 *
 * Uses manual rumor → seal → gift-wrap pipeline instead of nostr-tools/nip17
 * `wrapManyEvents` because that function generates incorrect `#p` tags
 * (uses random pubkeys instead of the recipient's pubkey), preventing relay
 * routing and message delivery.
 *
 * @param senderSk - Sender's secret key (Uint8Array)
 * @param recipientPubHex - Recipient's hex public key
 * @param content - Message text content
 * @param replyTo - Optional reply reference {eventId, relayUrl?}
 * @returns Array of kind 1059 events (one per recipient + one for sender)
 */
export function wrapNip17Message(
  senderSk: Uint8Array,
  recipientPubHex: string,
  content: string,
  replyTo?: {eventId: string; relayUrl?: string}
): NTNostrEvent[] {
  const senderPubHex = getPublicKey(senderSk);
  const tags: string[][] = [['p', recipientPubHex]];
  if(replyTo) {
    tags.push(['e', replyTo.eventId, replyTo.relayUrl || '', 'reply']);
  }

  // Create rumor (kind 14, unsigned)
  const rumor = createRumor(content, senderSk, tags);

  // Create seal + gift-wrap for recipient
  const recipientSeal = createSeal(rumor, senderSk, recipientPubHex);
  const recipientWrap = createGiftWrap(recipientSeal, recipientPubHex);

  // Create seal + gift-wrap for self (multi-device recovery)
  const selfSeal = createSeal(rumor, senderSk, senderPubHex);
  const selfWrap = createGiftWrap(selfSeal, senderPubHex);

  return [recipientWrap, selfWrap] as unknown as NTNostrEvent[];
}

/**
 * Unwrap a kind 1059 gift-wrap event to recover the rumor.
 *
 * Uses nostr-tools/nip17 `unwrapEvent` which handles:
 * - Decrypting gift-wrap to get seal (via NIP-44 with ephemeral key)
 * - Decrypting seal to get rumor (via NIP-44 with sender key)
 * - Anti-impersonation: nostr-tools verifies seal pubkey matches rumor pubkey
 *   through the NIP-44 decrypt chain (Pitfall 8)
 *
 * @param event - Kind 1059 gift-wrap event
 * @param recipientSk - Recipient's secret key (Uint8Array)
 * @returns The unwrapped rumor {kind, content, pubkey, created_at, tags, id}
 */
export function unwrapNip17Message(
  event: NTNostrEvent,
  recipientSk: Uint8Array
): {kind: number; content: string; pubkey: string; created_at: number; tags: string[][]; id: string} {
  const rumor = nip17UnwrapEvent(event, recipientSk);
  return rumor;
}

/**
 * Wrap a delivery/read receipt as NIP-17 gift-wrap for the recipient only (no self-send).
 *
 * Creates a kind 14 rumor with empty content, receipt-type tag, and 'e' tag
 * referencing the original event. Wrapped as a single gift-wrap for the recipient.
 *
 * @param senderSk - Sender's secret key (Uint8Array)
 * @param recipientPubHex - Recipient's hex public key
 * @param originalEventId - Event ID of the message being receipted
 * @param receiptType - 'delivery' or 'read'
 * @returns Array with single kind 1059 event
 */
export function wrapNip17Receipt(
  senderSk: Uint8Array,
  recipientPubHex: string,
  originalEventId: string,
  receiptType: 'delivery' | 'read'
): NTNostrEvent[] {
  // Use nip59 lower-level API for custom rumor tags (nip17 wrapEvent
  // doesn't support arbitrary rumor tags)
  const rumorEvent = createNip59Rumor({
    kind: 14,
    content: '',
    tags: [
      ['e', originalEventId],
      ['receipt-type', receiptType],
      ['p', recipientPubHex]
    ]
  }, senderSk);

  const seal = createNip59Seal(rumorEvent, senderSk, recipientPubHex);
  const giftWrap = createNip59Wrap(seal, recipientPubHex);

  return [giftWrap];
}

// ==================== Legacy NIP-17 API (deprecated) ====================

/**
 * @deprecated Use `wrapNip17Message` instead. Will be removed in a future version.
 *
 * Create an unsigned rumor event (NIP-17 kind 14).
 * The rumor is NOT signed — it has an id but no sig.
 */
export function createRumor(
  content: string,
  senderSk: Uint8Array,
  tags?: string[][]
): UnsignedEvent {
  const pubkey = getPublicKey(senderSk);
  const event = {
    kind: 14,
    created_at: Math.floor(Date.now() / 1000),
    tags: tags || [],
    content,
    pubkey
  };
  const id = getEventHash(event);
  return {...event, id};
}

/**
 * @deprecated Use `wrapNip17Message` instead. Will be removed in a future version.
 *
 * Create a sealed event (NIP-17 kind 13).
 * Encrypts the rumor JSON with NIP-44, signs with sender's key.
 * Uses randomized created_at within past 48 hours for metadata protection.
 */
export function createSeal(
  rumor: UnsignedEvent,
  senderSk: Uint8Array,
  recipientPk: string
): SignedEvent {
  const convKey = getConversationKey(senderSk, recipientPk);
  const encryptedContent = nip44Encrypt(JSON.stringify(rumor), convKey);

  const randomOffset = Math.floor(Math.random() * 48 * 60 * 60);
  const created_at = Math.floor(Date.now() / 1000) - randomOffset;

  const sealTemplate = {
    kind: 13,
    created_at,
    tags: [] as string[][],
    content: encryptedContent
  };

  return finalizeEvent(sealTemplate, senderSk) as unknown as SignedEvent;
}

/**
 * @deprecated Use `wrapNip17Message` instead. Will be removed in a future version.
 *
 * Create a gift-wrapped event (NIP-17 kind 1059).
 * Uses an ephemeral key to wrap the seal, tagged with recipient pubkey.
 * Uses randomized created_at for metadata protection.
 */
export function createGiftWrap(
  seal: SignedEvent,
  recipientPk: string
): SignedEvent {
  const ephemeralSk = generateSecretKey();
  const convKey = getConversationKey(ephemeralSk, recipientPk);
  const encryptedContent = nip44Encrypt(JSON.stringify(seal), convKey);

  const randomOffset = Math.floor(Math.random() * 48 * 60 * 60);
  const created_at = Math.floor(Date.now() / 1000) - randomOffset;

  const wrapTemplate = {
    kind: 1059,
    created_at,
    tags: [['p', recipientPk]],
    content: encryptedContent
  };

  return finalizeEvent(wrapTemplate, ephemeralSk) as unknown as SignedEvent;
}

/**
 * @deprecated Use `unwrapNip17Message` instead. Will be removed in a future version.
 *
 * Unwrap a gift-wrapped event to recover the seal and rumor.
 * Recipient uses their own secret key to decrypt.
 */
export function unwrapGiftWrap(
  wrap: SignedEvent,
  recipientSk: Uint8Array
): {seal: SignedEvent; rumor: UnsignedEvent} {
  // Decrypt the wrap to get the seal
  const wrapConvKey = getConversationKey(recipientSk, wrap.pubkey);
  const sealJson = nip44Decrypt(wrap.content, wrapConvKey);
  const seal = JSON.parse(sealJson) as SignedEvent;

  // Decrypt the seal to get the rumor
  const sealConvKey = getConversationKey(recipientSk, seal.pubkey);
  const rumorJson = nip44Decrypt(seal.content, sealConvKey);
  const rumor = JSON.parse(rumorJson) as UnsignedEvent;

  return {seal, rumor};
}

// ==================== Group Message Wrapping ====================

/**
 * Wrap a text message as NIP-17 gift-wrap events for N group members + self.
 *
 * Creates a single rumor (kind 14) with p-tags for all members and a
 * ['group', groupId] tag, then gift-wraps it individually for each member
 * and the sender (for multi-device recovery).
 *
 * @param senderSk - Sender's secret key (Uint8Array)
 * @param memberPubkeys - Hex public keys of all group members (excluding sender)
 * @param content - Message text content
 * @param groupId - Group identifier (hex string)
 * @param kind - Rumor kind (default 14)
 * @returns Array of kind 1059 events: memberPubkeys.length + 1 (self-send)
 */
export function wrapGroupMessage(
  senderSk: Uint8Array,
  memberPubkeys: string[],
  content: string,
  groupId: string,
  kind: number = 14
): NTNostrEvent[] {
  const senderPubHex = getPublicKey(senderSk);
  const allWraps: NTNostrEvent[] = [];

  // Build tags: one p-tag per member + group tag
  const tags: string[][] = memberPubkeys.map(pk => ['p', pk]);
  tags.push(['group', groupId]);

  // Create single rumor (kind 14)
  const rumor = createRumor(content, senderSk, tags);

  // One gift-wrap per member
  for(const memberPk of memberPubkeys) {
    const seal = createSeal(rumor, senderSk, memberPk);
    const wrap = createGiftWrap(seal, memberPk);
    allWraps.push(wrap as unknown as NTNostrEvent);
  }

  // Self-send for multi-device
  const selfSeal = createSeal(rumor, senderSk, senderPubHex);
  const selfWrap = createGiftWrap(selfSeal, senderPubHex);
  allWraps.push(selfWrap as unknown as NTNostrEvent);

  return allWraps; // memberPubkeys.length + 1 events
}
