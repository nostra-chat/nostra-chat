import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {finalizeEvent, getPublicKey} from 'nostr-tools/pure';
import {ChannelAPI} from '@lib/nostra/channel-api';
import {ChannelStore} from '@lib/nostra/channel-store';

const ownerSk = new Uint8Array(32).fill(3);
const subscriberSk = new Uint8Array(32).fill(4);
const attackerSk = new Uint8Array(32).fill(5);
const ownerPk = getPublicKey(ownerSk);

function sign(sk: Uint8Array, kind: number, content: string, tags: string[][] = [], createdAt = Math.floor(Date.now() / 1000)) {
  return finalizeEvent({kind, content, tags, created_at: createdAt}, sk);
}

describe('ChannelAPI owner-only NIP-28 flow', () => {
  it('creates a channel and publishes owner posts', async() => {
    const store = new ChannelStore();
    const published: any[] = [];
    const api = new ChannelAPI(ownerPk, ownerSk, async(event) => { published.push(event); }, undefined, store);

    const channelId = await api.createChannel({name: 'Release notes', about: 'Public updates'});
    const postId = await api.publishPost(channelId, 'Version 1 is ready');

    expect(published.map(event => event.kind)).toEqual([40, 42]);
    expect(published[1].tags[0][1]).toBe(channelId);
    expect((await store.getPosts(channelId)).map(post => post.eventId)).toEqual([postId]);

    await api.deletePost(channelId, postId);
    expect(published.map(event => event.kind)).toEqual([40, 42, 5]);
    expect(await store.getPosts(channelId)).toEqual([]);
  });

  it('subscribes by root ID, applies owner metadata/posts, and rejects forged posts', async() => {
    const root = sign(ownerSk, 40, JSON.stringify({name: 'News', about: 'Initial'}));
    const metadata = sign(ownerSk, 41, JSON.stringify({name: 'News 2', about: 'Updated'}), [['e', root.id]], root.created_at + 1);
    const ownerPost = sign(ownerSk, 42, 'authentic', [['e', root.id, '', 'root']], root.created_at + 2);
    const forged = sign(attackerSk, 42, 'forged', [['e', root.id, '', 'root']], root.created_at + 3);
    const query = async(filter: Record<string, any>) => filter.kinds.includes(40) ? [root] : [metadata, ownerPost, forged];
    const store = new ChannelStore();
    const api = new ChannelAPI(getPublicKey(subscriberSk), subscriberSk, async() => {}, query, store);

    const channel = await api.subscribe(root.id);

    expect(channel.name).toBe('News 2');
    expect(channel.ownerPubkey).toBe(ownerPk);
    expect((await store.getPosts(root.id)).map(post => post.content)).toEqual(['authentic']);
  });

  it('prevents a subscriber from publishing or changing metadata', async() => {
    const root = sign(ownerSk, 40, JSON.stringify({name: 'Owner channel'}));
    const store = new ChannelStore();
    await store.saveChannel({
      channelId: root.id,
      ownerPubkey: ownerPk,
      name: 'Owner channel',
      subscribed: true,
      createdAt: root.created_at,
      updatedAt: root.created_at
    });
    const api = new ChannelAPI(getPublicKey(subscriberSk), subscriberSk, async() => {}, undefined, store);

    await expect(api.publishPost(root.id, 'not allowed')).rejects.toThrow('Only the channel owner');
    await expect(api.updateMetadata(root.id, {name: 'Hijacked'})).rejects.toThrow('Only the channel owner');
  });
});
