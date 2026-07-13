import {MOUNT_CLASS_TO} from '@config/debug';
import rootScope from '@lib/rootScope';
import {getChannelStore} from './channel-store';
import {channelIdToPeerId} from './channel-types';
import {NostraBridge} from './nostra-bridge';
import {NostraPeerMapper} from './nostra-peer-mapper';
import {getMessageStore} from './message-store';

/** Materialize a subscribed public channel into tweb's chat/message mirrors. */
export async function refreshChannelDialog(channelId: string, ownPubkey: string): Promise<number> {
  const channel = await getChannelStore().getChannel(channelId);
  if(!channel || !channel.subscribed) throw new Error('Subscribed channel not found');
  const peerId = await channelIdToPeerId(channelId);
  const chatId = Math.abs(peerId);
  const mapper = new NostraPeerMapper();
  const chat = mapper.createTwebChat({
    chatId,
    title: channel.name,
    membersCount: 0,
    date: channel.createdAt
  }) as any;
  chat._ = 'channel';
  chat.access_hash = '0';
  chat.pFlags = {
    ...chat.pFlags,
    broadcast: true,
    ...(channel.ownerPubkey === ownPubkey ? {creator: true} : {})
  };

  const proxy = MOUNT_CLASS_TO.apiManagerProxy as any;
  if(proxy?.mirrors) {
    if(!proxy.mirrors.chats) proxy.mirrors.chats = {};
    proxy.mirrors.chats[chatId] = chat;
  }
  await rootScope.managers.appChatsManager.saveApiChat(chat);

  const posts = await getChannelStore().getPosts(channelId);
  const source = posts.length > 0 ? posts : [{
    eventId: channelId,
    channelId,
    authorPubkey: channel.ownerPubkey,
    content: channel.description || channel.name,
    createdAt: channel.createdAt
  }];
  let latestMid = 0;
  let latestDate = channel.createdAt;
  for(const post of source) {
    const mid = await NostraBridge.getInstance().mapEventIdToMid(post.eventId, post.createdAt);
    latestMid = mid;
    latestDate = post.createdAt;
    const message = mapper.createTwebMessage({
      mid,
      peerId,
      date: post.createdAt,
      text: post.content,
      isOutgoing: post.authorPubkey === ownPubkey
    });
    await getMessageStore().saveMessage({
      eventId: post.eventId,
      conversationId: `channel:${channelId}`,
      senderPubkey: post.authorPubkey,
      content: post.content,
      type: 'text',
      timestamp: post.createdAt,
      deliveryState: 'sent',
      mid,
      twebPeerId: peerId,
      isOutgoing: post.authorPubkey === ownPubkey
    });
    if(proxy?.mirrors?.messages) {
      const storageKey = `${peerId}_history`;
      if(!proxy.mirrors.messages[storageKey]) proxy.mirrors.messages[storageKey] = {};
      proxy.mirrors.messages[storageKey][mid] = message;
    }
    try {
      rootScope.dispatchEvent('history_append' as any, {storageKey: `${peerId}_history`, message, peerId} as any);
    } catch(err) {
      console.debug('[ChannelSync] history_append dispatch failed', err);
    }
  }

  const dialog = mapper.createTwebDialog({
    peerId,
    topMessage: latestMid,
    topMessageDate: latestDate,
    unreadCount: 0,
    isGroup: true,
    readInboxMaxId: latestMid,
    readOutboxMaxId: latestMid
  });
  if(proxy?.mirrors) {
    if(!proxy.mirrors.dialogs) proxy.mirrors.dialogs = {};
    proxy.mirrors.dialogs[peerId] = dialog;
  }
  const asPeerId = (peerId as any).toPeerId ? (peerId as any).toPeerId(true) : peerId;
  rootScope.dispatchEvent('dialogs_multiupdate' as any, new Map([[asPeerId, {dialog}]]) as any);
  rootScope.dispatchEvent('peer_title_edit' as any, {peerId: asPeerId} as any);
  return peerId;
}
