import type {ChannelPostRecord, ChannelRecord} from './channel-types';

const DB_NAME = 'nostra-channels';
const DB_VERSION = 1;
const CHANNELS = 'channels';
const POSTS = 'posts';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if(!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const database = request.result;
        if(!database.objectStoreNames.contains(CHANNELS)) database.createObjectStore(CHANNELS, {keyPath: 'channelId'});
        if(!database.objectStoreNames.contains(POSTS)) {
          const posts = database.createObjectStore(POSTS, {keyPath: 'eventId'});
          posts.createIndex('channelId', 'channelId', {unique: false});
        }
      };
    });
  }
  return dbPromise;
}

async function put(storeName: string, value: unknown): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class ChannelStore {
  async saveChannel(channel: ChannelRecord): Promise<void> { await put(CHANNELS, channel); }
  async savePost(post: ChannelPostRecord): Promise<void> { await put(POSTS, post); }

  async getChannel(channelId: string): Promise<ChannelRecord | null> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction(CHANNELS, 'readonly').objectStore(CHANNELS).get(channelId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async getChannels(): Promise<ChannelRecord[]> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction(CHANNELS, 'readonly').objectStore(CHANNELS).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  async getPosts(channelId: string): Promise<ChannelPostRecord[]> {
    const database = await db();
    return new Promise((resolve, reject) => {
      const request = database.transaction(POSTS, 'readonly').objectStore(POSTS).index('channelId').getAll(channelId);
      request.onsuccess = () => resolve((request.result ?? []).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  }

  async deletePost(eventId: string): Promise<void> {
    const database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(POSTS, 'readwrite');
      tx.objectStore(POSTS).delete(eventId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async unsubscribe(channelId: string): Promise<void> {
    const channel = await this.getChannel(channelId);
    if(!channel) return;
    channel.subscribed = false;
    channel.updatedAt = Date.now();
    await this.saveChannel(channel);
  }

  async destroy(): Promise<void> {
    if(dbPromise) (await dbPromise).close();
    dbPromise = null;
  }
}

let instance: ChannelStore | null = null;
export function getChannelStore(): ChannelStore {
  if(!instance) instance = new ChannelStore();
  return instance;
}
