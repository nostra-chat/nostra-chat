import {finalizeEvent, verifyEvent} from 'nostr-tools/pure';
import {getChannelStore, type ChannelStore} from './channel-store';
import {CHANNEL_POST_MAX, getRootChannelId, parseChannelMetadata, type ChannelMetadata, type ChannelPostRecord, type ChannelRecord} from './channel-types';
import type {NostrRelayPool} from './nostr-relay-pool';
import type {NostrEvent} from './nostr-relay';

export type ChannelPublish = (event: NostrEvent) => Promise<void>;
export type ChannelQuery = (filter: Record<string, unknown>) => Promise<NostrEvent[]>;
export type ChannelSubscribe = (filter: Record<string, unknown>, callback: (event: NostrEvent) => void) => () => void;
export type ChannelChanged = (channelId: string) => Promise<void>;

export class ChannelAPI {
  constructor(
    private readonly ownPubkey: string,
    private readonly ownSecretKey: Uint8Array,
    private readonly publish: ChannelPublish,
    private readonly query?: ChannelQuery,
    private readonly store: ChannelStore = getChannelStore(),
    private readonly subscribeLive?: ChannelSubscribe,
    private readonly onChanged?: ChannelChanged
  ) {}

  private sign(kind: number, content: string, tags: string[][] = []): NostrEvent {
    return finalizeEvent({kind, content, tags, created_at: Math.floor(Date.now() / 1000)}, this.ownSecretKey);
  }

  async createChannel(metadata: ChannelMetadata): Promise<string> {
    const parsed = parseChannelMetadata(JSON.stringify(metadata));
    if(!parsed) throw new Error('Invalid channel metadata');
    const event = this.sign(40, JSON.stringify(parsed));
    await this.publish(event);
    await this.store.saveChannel({
      channelId: event.id,
      ownerPubkey: event.pubkey,
      name: parsed.name,
      description: parsed.about,
      picture: parsed.picture,
      subscribed: true,
      createdAt: event.created_at,
      updatedAt: event.created_at
    });
    await this.onChanged?.(event.id);
    return event.id;
  }

  async updateMetadata(channelId: string, metadata: ChannelMetadata): Promise<void> {
    const channel = await this.requireOwner(channelId);
    const parsed = parseChannelMetadata(JSON.stringify(metadata));
    if(!parsed) throw new Error('Invalid channel metadata');
    const event = this.sign(41, JSON.stringify(parsed), [['e', channel.channelId]]);
    await this.publish(event);
    await this.ingest(event);
  }

  async publishPost(channelId: string, content: string): Promise<string> {
    const channel = await this.requireOwner(channelId);
    if(typeof content !== 'string' || content.trim().length === 0 || content.length > CHANNEL_POST_MAX) throw new Error('Invalid channel post');
    const event = this.sign(42, content, [['e', channel.channelId, '', 'root']]);
    await this.publish(event);
    await this.ingest(event);
    return event.id;
  }

  async deletePost(channelId: string, eventId: string): Promise<void> {
    const channel = await this.requireOwner(channelId);
    if(!/^[0-9a-f]{64}$/.test(eventId)) throw new Error('Invalid channel post ID');
    const event = this.sign(5, JSON.stringify({reason: 'deleted by channel owner'}), [
      ['e', channel.channelId, '', 'root'],
      ['e', eventId]
    ]);
    await this.publish(event);
    await this.store.deletePost(eventId);
    await this.onChanged?.(channelId);
  }

  async subscribe(channelId: string): Promise<ChannelRecord> {
    if(!/^[0-9a-f]{64}$/.test(channelId)) throw new Error('Invalid channel ID');
    if(!this.query) throw new Error('Channel query transport unavailable');
    const roots = await this.query({kinds: [40], ids: [channelId], limit: 1});
    const root = roots.find(event => event.id === channelId && event.kind === 40);
    if(!root || !verifyEvent(root)) throw new Error('Channel root not found or invalid');
    const metadata = parseChannelMetadata(root.content);
    if(!metadata) throw new Error('Invalid channel root metadata');
    const record: ChannelRecord = {
      channelId,
      ownerPubkey: root.pubkey,
      name: metadata.name,
      description: metadata.about,
      picture: metadata.picture,
      subscribed: true,
      createdAt: root.created_at,
      updatedAt: root.created_at
    };
    await this.store.saveChannel(record);
    const events = await this.query({'kinds': [41, 42, 5], '#e': [channelId], 'limit': 500});
    for(const event of events.sort((a, b) => a.created_at - b.created_at)) await this.ingest(event);
    await this.onChanged?.(channelId);
    return (await this.store.getChannel(channelId)) ?? record;
  }

  async unsubscribe(channelId: string): Promise<void> { await this.store.unsubscribe(channelId); }

  watch(channelId: string): () => void {
    if(!this.subscribeLive) throw new Error('Channel live subscription transport unavailable');
    if(!/^[0-9a-f]{64}$/.test(channelId)) throw new Error('Invalid channel ID');
    return this.subscribeLive({'kinds': [41, 42, 5], '#e': [channelId]}, (event) => {
      void this.ingest(event).catch((err) => console.warn('[ChannelAPI] live event ingest failed', err));
    });
  }

  async ingest(event: NostrEvent): Promise<'stored' | 'ignored'> {
    if(!verifyEvent(event)) return 'ignored';
    if(event.kind === 40) return 'ignored';
    const channelId = getRootChannelId(event.tags);
    if(!channelId) return 'ignored';
    const channel = await this.store.getChannel(channelId);
    if(!channel || !channel.subscribed || event.pubkey !== channel.ownerPubkey) return 'ignored';

    if(event.kind === 41) {
      if(event.created_at < channel.updatedAt) return 'ignored';
      const metadata = parseChannelMetadata(event.content);
      if(!metadata) return 'ignored';
      await this.store.saveChannel({...channel, name: metadata.name, description: metadata.about, picture: metadata.picture, updatedAt: event.created_at});
      await this.onChanged?.(channelId);
      return 'stored';
    }
    if(event.kind === 42) {
      if(event.content.length === 0 || event.content.length > CHANNEL_POST_MAX) return 'ignored';
      const post: ChannelPostRecord = {eventId: event.id, channelId, authorPubkey: event.pubkey, content: event.content, createdAt: event.created_at};
      await this.store.savePost(post);
      await this.onChanged?.(channelId);
      return 'stored';
    }
    if(event.kind === 5) {
      const targets = event.tags
      .filter(tag => tag[0] === 'e' && tag[1] !== channelId && /^[0-9a-f]{64}$/.test(tag[1] || ''))
      .map(tag => tag[1]);
      for(const eventId of targets) await this.store.deletePost(eventId);
      if(targets.length > 0) await this.onChanged?.(channelId);
      return targets.length > 0 ? 'stored' : 'ignored';
    }
    return 'ignored';
  }

  private async requireOwner(channelId: string): Promise<ChannelRecord> {
    const channel = await this.store.getChannel(channelId);
    if(!channel) throw new Error('Channel not found');
    if(channel.ownerPubkey !== this.ownPubkey) throw new Error('Only the channel owner can publish');
    return channel;
  }
}

export function createChannelAPI(relayPool: NostrRelayPool): ChannelAPI {
  const secretKey = relayPool.getPrivateKey();
  const publicKey = relayPool.getPublicKey();
  if(!secretKey || !publicKey) throw new Error('Relay pool identity is not initialized');
  return new ChannelAPI(
    publicKey,
    secretKey,
    async(event) => {
      const result = await relayPool.publishRawEvent(event as any);
      if(result.successes.length === 0) throw new Error(`Channel publish failed: ${result.failures.map(failure => failure.error).join('; ')}`);
    },
    (filter) => relayPool.queryRawEvents(filter) as any,
    getChannelStore(),
    (filter, callback) => relayPool.subscribeRawEvents(filter, callback as any)
  );
}

let channelInstance: ChannelAPI | null = null;

export function initChannelAPI(ownPubkey: string, ownSecretKey: Uint8Array, relayPool: NostrRelayPool): ChannelAPI {
  channelInstance = new ChannelAPI(
    ownPubkey,
    ownSecretKey,
    async(event) => {
      const result = await relayPool.publishRawEvent(event as any);
      if(result.successes.length === 0) throw new Error(`Channel publish failed: ${result.failures.map(failure => failure.error).join('; ')}`);
    },
    (filter) => relayPool.queryRawEvents(filter) as any,
    getChannelStore(),
    (filter, callback) => relayPool.subscribeRawEvents(filter, callback as any),
    async(channelId) => {
      const {refreshChannelDialog} = await import('./nostra-channels-sync');
      await refreshChannelDialog(channelId, ownPubkey);
    }
  );
  if(typeof window !== 'undefined') (window as any).__nostraChannelAPI = channelInstance;
  return channelInstance;
}

export function getChannelAPI(): ChannelAPI {
  if(!channelInstance) throw new Error('ChannelAPI not initialized');
  return channelInstance;
}
