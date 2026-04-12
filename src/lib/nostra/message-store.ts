/**
 * MessageStore - IndexedDB message cache per conversation
 *
 * Provides persistent storage for decrypted messages, enabling instant
 * chat load without relay queries. Messages are stored per conversation
 * with indexes for efficient retrieval and pagination.
 *
 * DB: nostra-messages, version 1
 * Store: messages (auto-increment key, indexes: conversationId, timestamp, eventId)
 */

/**
 * Stored message interface for IndexedDB
 */
export interface StoredMessage {
  /** Nostr event ID (unique) */
  eventId: string;
  /** Deterministic conversation ID (sorted pubkeys joined with ':') */
  conversationId: string;
  /** Sender's hex public key */
  senderPubkey: string;
  /** Message content (plaintext) */
  content: string;
  /** Message type */
  type: 'text' | 'file';
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Delivery state */
  deliveryState: 'sending' | 'sent' | 'delivered' | 'read';
  /** File metadata (for type='file', used by Plan 02) */
  fileMetadata?: {
    url: string;
    sha256: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
    keyHex: string;
    ivHex: string;
  };
  /** tweb message ID (mid) for cache reconstruction on reload */
  mid?: number;
  /** tweb numeric peerId used in storageKey (e.g. the sender peerId) */
  twebPeerId?: number;
  /** Whether this message was outgoing */
  isOutgoing?: boolean;
  /** Parsed application message ID (chat-XXX-N) — used so read receipts can key off the same ID that delivery receipts use */
  appMessageId?: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const DB_NAME = 'nostra-messages';
const DB_VERSION = 1;
const STORE_NAME = 'messages';
const DEFAULT_LIMIT = 50;

// ─── Singleton ─────────────────────────────────────────────────────

let _instance: MessageStore | null = null;

/**
 * Get the singleton MessageStore instance.
 * Lazily opens the IndexedDB on first call.
 */
export function getMessageStore(): MessageStore {
  if(!_instance) {
    _instance = new MessageStore();
  }
  return _instance;
}

// ─── MessageStore ──────────────────────────────────────────────────

/**
 * IndexedDB message cache per conversation.
 */
export class MessageStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Get or open the IndexedDB database.
   */
  private getDB(): Promise<IDBDatabase> {
    if(!this.dbPromise) {
      this.dbPromise = this.openDB();
    }
    return this.dbPromise;
  }

  /**
   * Open the IndexedDB database.
   */
  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if(!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {autoIncrement: true});
          store.createIndex('conversationId', 'conversationId', {unique: false});
          store.createIndex('timestamp', 'timestamp', {unique: false});
          store.createIndex('eventId', 'eventId', {unique: true});
        }
      };
    });
  }

  /**
   * Save a message (upsert by eventId).
   * If a message with the same eventId exists, it is replaced.
   */
  async saveMessage(msg: StoredMessage): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('eventId');

      // Check if exists
      const getReq = index.getKey(msg.eventId);
      getReq.onsuccess = () => {
        if(getReq.result !== undefined) {
          // Update existing — MERGE fields to preserve mid/twebPeerId/isOutgoing
          // that may have been set by a parallel save (send bridge vs ChatAPI race)
          const readReq = store.get(getReq.result);
          readReq.onsuccess = () => {
            const existing = readReq.result as StoredMessage | undefined;
            const merged = {...(existing || {}), ...msg};
            // Preserve non-null fields from existing record
            if(existing?.mid && !msg.mid) merged.mid = existing.mid;
            if(existing?.twebPeerId && !msg.twebPeerId) merged.twebPeerId = existing.twebPeerId;
            if(existing?.isOutgoing !== undefined && msg.isOutgoing === undefined) merged.isOutgoing = existing.isOutgoing;
            const putReq = store.put(merged, getReq.result);
            putReq.onerror = () => reject(putReq.error);
            putReq.onsuccess = () => resolve();
          };
          readReq.onerror = () => reject(readReq.error);
        } else {
          // Insert new
          const addReq = store.add(msg);
          addReq.onerror = () => reject(addReq.error);
          addReq.onsuccess = () => resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /**
   * Get messages for a conversation, sorted by timestamp desc.
   *
   * @param conversationId - Deterministic conversation ID
   * @param limit - Max messages to return (default 50)
   * @param before - Optional timestamp for pagination (return messages before this time)
   */
  async getMessages(conversationId: string, limit: number = DEFAULT_LIMIT, before?: number): Promise<StoredMessage[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('conversationId');
      const request = index.openCursor(IDBKeyRange.only(conversationId));

      const results: StoredMessage[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if(cursor) {
          const msg = cursor.value as StoredMessage;
          if(!before || msg.timestamp < before) {
            results.push(msg);
          }
          cursor.continue();
        } else {
          // Sort by timestamp descending and limit
          results.sort((a, b) => b.timestamp - a.timestamp);
          resolve(results.slice(0, limit));
        }
      };
    });
  }

  /**
   * Get the latest message timestamp for a conversation.
   * Used as `since` filter for relay backfill.
   *
   * @param conversationId - Deterministic conversation ID
   * @returns Latest timestamp, or 0 if no messages
   */
  async getLatestTimestamp(conversationId: string): Promise<number> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('conversationId');
      const request = index.openCursor(IDBKeyRange.only(conversationId));

      let maxTimestamp = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if(cursor) {
          const msg = cursor.value as StoredMessage;
          if(msg.timestamp > maxTimestamp) {
            maxTimestamp = msg.timestamp;
          }
          cursor.continue();
        } else {
          resolve(maxTimestamp);
        }
      };
    });
  }

  /**
   * Delete messages from a conversation.
   *
   * @param conversationId - Conversation to delete from
   * @param eventIds - Optional specific event IDs to delete. If omitted, deletes all.
   */
  async deleteMessages(conversationId: string, eventIds?: string[]): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('conversationId');
      const request = index.openCursor(IDBKeyRange.only(conversationId));

      const eventIdSet = eventIds ? new Set(eventIds) : null;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if(cursor) {
          const msg = cursor.value as StoredMessage;
          if(!eventIdSet || eventIdSet.has(msg.eventId)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  /**
   * Delete a single message by its tweb mid (numeric ID).
   */
  async deleteByMid(mid: number): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if(cursor) {
          const msg = cursor.value as StoredMessage;
          if(msg.mid === mid) {
            cursor.delete();
            resolve();
            return;
          }
          cursor.continue();
        } else {
          resolve(); // Not found — OK
        }
      };
    });
  }

  /**
   * Look up a single message by its eventId.
   * Returns the stored message or null if not found.
   */
  async getByEventId(eventId: string): Promise<StoredMessage | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('eventId');
      const request = index.get(eventId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  /**
   * Get a deterministic conversation ID from two public keys.
   * Sorts both hex pubkeys alphabetically and joins with ':'.
   */
  getConversationId(pubkeyA: string, pubkeyB: string): string {
    return [pubkeyA, pubkeyB].sort().join(':');
  }

  /**
   * Get all distinct conversation IDs from the store.
   * Needed by backfill to know which conversations to query.
   */
  async getAllConversationIds(): Promise<string[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('conversationId');
      const request = index.openKeyCursor(null, 'nextunique');

      const ids: string[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursor>).result;
        if(cursor) {
          ids.push(cursor.key as string);
          cursor.continue();
        } else {
          resolve(ids);
        }
      };
    });
  }

  async destroy(): Promise<void> {
    if(this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
    }
    this.dbPromise = null;
    _instance = null;
  }
}
