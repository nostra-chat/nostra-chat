/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import appSidebarLeft from '..';
import {InputFile} from '@layer';
import InputField from '@components/inputField';
import {SliderSuperTab} from '@components/slider';
import AvatarEdit from '@components/avatarEdit';
import {_i18n} from '@lib/langPack';
import ButtonCorner from '@components/buttonCorner';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import SettingSection from '@components/settingSection';
import toggleDisability from '@helpers/dom/toggleDisability';
import {channelIdToPeerId} from '@lib/nostra/channel-types';

export default class AppNewChannelTab extends SliderSuperTab {
  public static noSame = true;
  private uploadAvatar: () => Promise<InputFile> = null;

  private channelNameInputField: InputField;
  private channelDescriptionInputField: InputField;
  private nextBtn: HTMLButtonElement;
  private avatarEdit: AvatarEdit;

  public init() {
    this.container.classList.add('new-channel-container');
    this.setTitle('NewChannel');

    this.avatarEdit = new AvatarEdit((_upload) => {
      this.uploadAvatar = _upload;
    });

    const section = new SettingSection({
      caption: 'Channel.DescriptionHolderDescrpiton'
    });

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('input-wrapper');

    this.channelNameInputField = new InputField({
      label: 'EnterChannelName',
      maxLength: 128
    });

    this.channelDescriptionInputField = new InputField({
      label: 'DescriptionOptionalPlaceholder',
      maxLength: 255,
      withLinebreaks: true
    });

    inputWrapper.append(
      this.channelNameInputField.container,
      this.channelDescriptionInputField.container
    );

    const onLengthChange = () => {
      this.nextBtn.classList.toggle('is-visible', !!this.channelNameInputField.value.length &&
        !this.channelNameInputField.input.classList.contains('error') &&
        !this.channelDescriptionInputField.input.classList.contains('error'));
    };

    this.channelNameInputField.input.addEventListener('input', onLengthChange);
    this.channelDescriptionInputField.input.addEventListener('input', onLengthChange);

    this.nextBtn = ButtonCorner({icon: 'arrow_next'});

    attachClickEvent(this.nextBtn, async() => {
      const title = this.channelNameInputField.value;
      const about = this.channelDescriptionInputField.value;

      const toggle = toggleDisability(this.nextBtn, true);
      try {
        const channelAPI = (window as any).__nostraChannelAPI;
        if(!channelAPI) throw new Error('ChannelAPI is not initialized');
        const channelId = await channelAPI.createChannel({name: title, about});
        channelAPI.watch(channelId);
        const peerId = await channelIdToPeerId(channelId);
        try { await navigator.clipboard?.writeText(channelId); } catch{}
        appSidebarLeft.removeTabFromHistory(this);
        const appImManager = (await import('@lib/appImManager')).default;
        appImManager.setInnerPeer({peerId: (peerId as any).toPeerId ? (peerId as any).toPeerId(true) : peerId});
      } catch(err) {
        console.error('createChannel error', err);
        toggle();
      }
    }, {listenerSetter: this.listenerSetter});

    this.content.append(this.nextBtn);
    section.content.append(this.avatarEdit.container, inputWrapper);
    this.scrollable.append(section.container);
  }

  public onCloseAfterTimeout() {
    this.avatarEdit.clear();
    this.uploadAvatar = null;
    this.channelNameInputField.value = '';
    this.channelDescriptionInputField.value = '';
    this.nextBtn.disabled = false;
    return super.onCloseAfterTimeout();
  }
}
