/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import callbackify from '@helpers/callbackify';
import numberThousandSplitter from '@helpers/number/numberThousandSplitter';
import {Chat, ChatFull} from '@layer';
import getParticipantsCount from '@appManagers/utils/chats/getParticipantsCount';
import {i18n, LangPackKey} from '@lib/langPack';
import apiManagerProxy from '@lib/apiManagerProxy';
import rootScope from '@lib/rootScope';

function _getChatMembersString(chat: Chat, chatFull: ChatFull) {
  let count: number;
  if(chatFull) {
    count = getParticipantsCount(chatFull);
  } else {
    count = (chat as Chat.chat).participants_count || (chat as any).participants?.participants.length;
  }

  // [Nostra.chat] FIND-3786a35f obs (C): synthetic nostra groups inject a
  // Chat with `participants_count: members.length` but no ChatFull
  // (or a ChatFull whose participants list is `chatParticipantsForbidden`).
  // `getParticipantsCount` then returns 0 and the UI shows "1 member" for
  // a multi-member group. Fall back to the Chat-level count so the synthetic
  // group surfaces its real member count.
  if(!count && (chat as Chat.chat).participants_count) {
    count = (chat as Chat.chat).participants_count;
  }

  const isBroadcast = (chat as Chat.channel).pFlags.broadcast;
  count = count || 1;

  const key: LangPackKey = isBroadcast ? 'Peer.Status.Subscribers' : 'Peer.Status.Member';
  return i18n(key, [numberThousandSplitter(count)]);
}

export default function getChatMembersString(
  chatId: ChatId,
  managers = rootScope.managers,
  chat?: Chat,
  onlySync?: boolean,
  chatFull?: ChatFull
) {
  chat ??= apiManagerProxy.getChat(chatId);
  if(chat._ === 'chatForbidden') {
    return i18n('YouWereKicked');
  }

  if(onlySync) {
    return _getChatMembersString(chat, undefined);
  }

  const result = chatFull || managers.appProfileManager.getCachedFullChat(chatId);
  return callbackify(result, (chatFull) => _getChatMembersString(chat, chatFull));
}
