/**
 * Nostra.chat New Group Tab
 *
 * SliderSuperTab that provides group name input AFTER contacts have been
 * selected by AppAddMembersTab. Calls GroupAPI.createGroup() instead of
 * appChatsManager.createChat() (MTProto).
 */

import appDialogsManager from '@lib/appDialogsManager';
import InputField from '@components/inputField';
import {SliderSuperTab} from '@components/slider';
import AvatarEdit from '@components/avatarEdit';
import ButtonCorner from '@components/buttonCorner';
import getUserStatusString from '@components/wrappers/getUserStatusString';
import appImManager from '@lib/appImManager';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import SettingSection from '@components/settingSection';
import toggleDisability from '@helpers/dom/toggleDisability';
import {getGroupAPI} from '@lib/nostra/group-api';
import {getGroupStore} from '@lib/nostra/group-store';
import {writeGroupCreateServiceMessage} from '@lib/nostra/group-service-messages';
import rootScope from '@lib/rootScope';

export default class AppNostraNewGroupTab extends SliderSuperTab {
  public static noSame = true;
  private peerIds: PeerId[];
  private nextBtn: HTMLButtonElement;
  private groupNameInputField: InputField;
  private list: HTMLUListElement;

  public init({peerIds}: {peerIds: PeerId[]}) {
    this.peerIds = peerIds;
    this.container.classList.add('new-group-container');
    this.setTitle('NewGroup');

    const avatarEdit = new AvatarEdit(() => {});
    const section = new SettingSection({});

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('input-wrapper');

    this.groupNameInputField = new InputField({
      label: 'CreateGroup.NameHolder',
      maxLength: 128
    });

    inputWrapper.append(this.groupNameInputField.container);

    this.listenerSetter.add(this.groupNameInputField.input)('input', () => {
      const value = this.groupNameInputField.value;
      this.nextBtn.classList.toggle('is-visible', !!value.length && !this.groupNameInputField.input.classList.contains('error'));
    });

    this.nextBtn = ButtonCorner({icon: 'arrow_next'});

    attachClickEvent(this.nextBtn, async() => {
      const name = this.groupNameInputField.value.trim();
      if(!name) return;
      const toggle = toggleDisability(this.nextBtn, true);

      try {
        // Map each peerID to pubkey via virtual-peers-db reverse lookup
        const {getPubkey} = await import('@lib/nostra/virtual-peers-db');
        const pubkeyPromises = this.peerIds.map(async(pid) => {
          const numId = +pid;
          return getPubkey(numId);
        });
        const pubkeysOrNulls = await Promise.all(pubkeyPromises);
        const memberPubkeys = pubkeysOrNulls.filter((pk): pk is string => !!pk);

        if(memberPubkeys.length === 0) {
          toggle();
          return;
        }

        const groupApi = getGroupAPI();
        const groupId = await groupApi.createGroup(name, memberPubkeys);

        // Inject group dialog into chat list
        const store = getGroupStore();
        const group = await store.get(groupId);
        if(group) {
          // Inject synthetic group chat into tweb managers
          try {
            const chatId = Math.abs(group.peerId);
            const chat = {
              _: 'chat',
              id: chatId,
              title: group.name,
              participants_count: group.members.length,
              date: Math.floor(group.createdAt / 1000),
              version: 1,
              pFlags: {}
            };
            const appChatsManager = (rootScope.managers as any).appChatsManager;
            if(appChatsManager?.saveApiChat) {
              appChatsManager.saveApiChat(chat, true);
            }
            // Re-derive the service message mid (idempotent — same row was
            // already upserted by GroupAPI.createGroup). Using the real mid
            // avoids tweb's `something strange with dialog` warning.
            const service = await writeGroupCreateServiceMessage({
              groupId: group.groupId,
              peerId: group.peerId,
              timestamp: Math.floor(group.createdAt / 1000),
              adminPubkey: group.adminPubkey,
              title: group.name,
              isOutgoing: true
            });
            const dialog: any = {
              _: 'dialog',
              flags: 0,
              peer: {_: 'peerChat', chat_id: chatId},
              top_message: service.mid,
              read_inbox_max_id: 0,
              read_outbox_max_id: 0,
              unread_count: 0,
              unread_mentions_count: 0,
              unread_reactions_count: 0,
              notify_settings: {_: 'peerNotifySettings'},
              pFlags: {pinned: true},
              peerId: group.peerId.toPeerId(true)
            };
            const dialogsStorage = (rootScope.managers as any).dialogsStorage;
            if(dialogsStorage?.registerP2PDialog) {
              await dialogsStorage.registerP2PDialog(dialog);
            }
            rootScope.dispatchEvent('dialogs_multiupdate', new Map([[group.peerId.toPeerId(true), {dialog}]]));
          } catch(injectErr) {
            console.warn('[NostraNewGroup] group inject failed:', injectErr);
          }

          this.close();
          appImManager.setInnerPeer({peerId: group.peerId.toPeerId(true)});
        } else {
          toggle();
        }
      } catch(err) {
        console.error('[AppNostraNewGroupTab] createGroup error:', err);
        toggle();
      }
    }, {listenerSetter: this.listenerSetter});

    const chatsSection = new SettingSection({
      name: 'Members',
      nameArgs: [this.peerIds.length]
    });

    if(!this.peerIds.length) {
      chatsSection.container.classList.add('hide');
    }

    const list = this.list = appDialogsManager.createChatList({new: true});
    chatsSection.content.append(list);
    section.content.append(avatarEdit.container, inputWrapper);
    this.content.append(this.nextBtn);
    this.scrollable.append(section.container, chatsSection.container);

    const usersPromise = Promise.all(this.peerIds.map((peerId) => this.managers.appUsersManager.getUser(peerId.toUserId())));
    return usersPromise.then((users) => {
      return users.map((user) => {
        if(!user) return;
        const {dom} = appDialogsManager.addDialogNew({
          peerId: user.id.toPeerId(false),
          container: this.list,
          rippleEnabled: false,
          avatarSize: 'abitbigger',
          wrapOptions: {middleware: this.middlewareHelper.get()}
        });
        dom.lastMessageSpan.append(getUserStatusString(user));
      });
    });
  }
}
