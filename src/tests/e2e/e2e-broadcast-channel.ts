// @ts-nocheck
import {bootHarness} from '../fuzz/harness';

const POST = `channel-post-${Date.now()}`;

async function waitFor(page: any, predicate: (arg: any) => Promise<boolean> | boolean, arg: any, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while(Date.now() < deadline) {
    if(await page.evaluate(predicate, arg)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

void (async() => {
  const {ctx, teardown} = await bootHarness();
  try {
    const A = ctx.users.userA;
    const B = ctx.users.userB;
    const channelId = await A.page.evaluate(async() => {
      const api = (window as any).__nostraChannelAPI;
      if(!api) throw new Error('ChannelAPI unavailable on owner');
      const id = await api.createChannel({name: 'E2E Broadcast', about: 'Owner-only public channel'});
      api.watch(id);
      return id;
    });

    const subscribed = await B.page.evaluate(async(id: string) => {
      const api = (window as any).__nostraChannelAPI;
      if(!api) throw new Error('ChannelAPI unavailable on subscriber');
      const channel = await api.subscribe(id);
      api.watch(id);
      return channel;
    }, channelId);
    if(subscribed.ownerPubkey !== A.pubkeyHex) throw new Error('subscriber stored wrong owner');

    await A.page.evaluate(async({id, text}: any) => {
      await (window as any).__nostraChannelAPI.publishPost(id, text);
    }, {id: channelId, text: POST});

    if(!await waitFor(B.page, async({id, text}: any) => {
      const {getChannelStore} = await import('/src/lib/nostra/channel-store.ts');
      return (await getChannelStore().getPosts(id)).some((post: any) => post.content === text);
    }, {id: channelId, text: POST})) throw new Error('subscriber did not persist owner post');

    await A.page.evaluate(async(id: string) => {
      await (window as any).__nostraChannelAPI.updateMetadata(id, {name: 'E2E Broadcast Updated', about: 'v2'});
    }, channelId);
    if(!await waitFor(B.page, async(id: string) => {
      const {getChannelStore} = await import('/src/lib/nostra/channel-store.ts');
      return (await getChannelStore().getChannel(id))?.name === 'E2E Broadcast Updated';
    }, channelId)) throw new Error('subscriber did not apply owner metadata update');

    const subscriberDenied = await B.page.evaluate(async(id: string) => {
      try {
        await (window as any).__nostraChannelAPI.publishPost(id, 'forged subscriber post');
        return false;
      } catch{return true;}
    }, channelId);
    if(!subscriberDenied) throw new Error('subscriber was allowed to publish');

    console.log('PASS: NIP-28 create/subscribe/post/metadata and owner-only authorization');
  } finally {
    await teardown();
  }
})().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
