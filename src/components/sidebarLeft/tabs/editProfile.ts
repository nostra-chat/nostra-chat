/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import InputField from '@components/inputField';
import {SliderSuperTab} from '@components/slider';
import EditPeer from '@components/editPeer';
import {i18n, i18n_, LangPackKey} from '@lib/langPack';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import rootScope from '@lib/rootScope';
import setBlankToAnchor from '@lib/richTextProcessor/setBlankToAnchor';
import SettingSection, {generateSection} from '@components/settingSection';
import Row from '@components/row';
import {getHeavyAnimationPromise} from '@hooks/useHeavyAnimationCheck';
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd';
import shake from '@helpers/dom/shake';
import useNostraIdentity from '@stores/nostraIdentity';
import {toast} from '@components/toast';
import {publishKind0Metadata} from '@lib/nostra/nostr-relay';
import noop from '@helpers/noop';

// TODO: аватарка не поменяется в этой вкладке после изменения почему-то (если поставить в другом клиенте, и потом тут проверить, для этого ещё вышел в чатлист)

/** @deprecated Kept for external consumers (chatType, editBot) */
export function purchaseUsernameCaption() {
  const p = document.createElement('div');
  const FRAGMENT_USERNAME_URL = 'https://fragment.com/username/';
  const a = setBlankToAnchor(document.createElement('a'));
  const purchaseText = i18n('Username.Purchase', [a]);
  purchaseText.classList.add('username-purchase-help');
  p.append(
    purchaseText,
    document.createElement('br'),
    document.createElement('br')
  );
  p.classList.add('hide');

  return {
    element: p,
    setUsername: (username: string) => {
      if(username) {
        a.href = FRAGMENT_USERNAME_URL + username;
      }

      p.classList.toggle('hide', !username);
    }
  };
}

export default class AppEditProfileTab extends SliderSuperTab {
  public static noSame = true;
  private firstNameInputField: InputField;
  private lastNameInputField: InputField;
  private bioInputField: InputField;

  private editPeer: EditPeer;

  public static getInitArgs() {
    return {
      bioMaxLength: rootScope.managers.apiManager.getLimit('bio'),
      user: rootScope.managers.appUsersManager.getSelf(),
      userFull: rootScope.managers.appProfileManager.getProfile(rootScope.myId.toUserId())
    };
  }

  public async init(p: ReturnType<typeof AppEditProfileTab['getInitArgs']> = AppEditProfileTab.getInitArgs(), focusOn?: string) {
    this.container.classList.add('edit-profile-container');
    this.setTitle('EditAccount.Title');

    const inputFields: InputField[] = [];

    const [bioMaxLength, user, userFull] = await Promise.all([p.bioMaxLength, p.user, p.userFull]);

    {
      const section = generateSection(this.scrollable, undefined, 'Bio.Description');
      const inputWrapper = document.createElement('div');
      inputWrapper.classList.add('input-wrapper');

      this.firstNameInputField = new InputField({
        label: 'EditProfile.FirstNameLabel',
        name: 'first-name',
        maxLength: 70
      });
      this.lastNameInputField = new InputField({
        label: 'Login.Register.LastName.Placeholder',
        name: 'last-name',
        maxLength: 64
      });
      this.bioInputField = new InputField({
        label: 'EditProfile.BioLabel',
        name: 'bio',
        maxLength: bioMaxLength
      });

      inputWrapper.append(
        this.firstNameInputField.container,
        this.lastNameInputField.container,
        this.bioInputField.container
      );

      inputFields.push(
        this.firstNameInputField,
        this.lastNameInputField,
        this.bioInputField
      );

      this.editPeer = new EditPeer({
        peerId: rootScope.myId,
        inputFields,
        listenerSetter: this.listenerSetter,
        middleware: this.middlewareHelper.get()
      });

      this.content.append(this.editPeer.nextBtn);

      section.append(this.editPeer.avatarEdit.container, inputWrapper);
    }

    // [Nostra.chat] Nostr Identity section
    const identity = useNostraIdentity();
    const npubValue = identity.npub() || '';
    if(npubValue) {
      const identitySection = new SettingSection({
        name: 'Nostr Identity' as any
      });

      // npub display with copy
      const npubRow = new Row({
        title: npubValue.slice(0, 20) + '...' + npubValue.slice(-8),
        subtitle: 'Your public key (npub)',
        clickable: () => {
          navigator.clipboard.writeText(npubValue).then(() => {
            toast('Copied to clipboard');
          });
        },
        listenerSetter: this.listenerSetter
      });
      npubRow.container.style.cursor = 'pointer';

      // NIP-05 alias
      const nip05Value = identity.nip05() || '';
      const nip05Row = new Row({
        title: nip05Value || 'Set NIP-05 alias',
        subtitle: nip05Value ? 'Verified identity' : 'e.g. alice@example.com',
        icon: nip05Value ? 'check' : 'mention',
        clickable: () => {
          // Open full identity tab for NIP-05 management
          import('@components/sidebarLeft/tabs/nostraIdentity').then(({default: AppNostraIdentityTab}) => {
            const tab = this.slider.createTab(AppNostraIdentityTab);
            tab.open();
          });
        },
        listenerSetter: this.listenerSetter
      });

      identitySection.content.append(npubRow.container, nip05Row.container);
      this.scrollable.append(identitySection.container);
    }

    attachClickEvent(this.editPeer.nextBtn, () => {
      this.editPeer.nextBtn.disabled = true;

      const promises: Promise<any>[] = [];

      const profilePromise = this.managers.appProfileManager.updateProfile(
        this.firstNameInputField.value,
        this.lastNameInputField.value,
        this.bioInputField.value
      );
      promises.push(profilePromise.then(() => {
        this.close();
      }, (err) => {
        console.error('updateProfile error:', err);
      }));

      if(this.editPeer.uploadAvatar) {
        promises.push(this.editPeer.uploadAvatar().then((inputFile) => {
          return this.managers.appProfileManager.uploadProfilePhoto(inputFile);
        }));
      }

      // [Nostra.chat] Also publish display name to Nostr
      if(npubValue) {
        const nostraIdentity = useNostraIdentity();
        const fullName = [this.firstNameInputField.value, this.lastNameInputField.value].filter(Boolean).join(' ');
        rootScope.dispatchEvent('nostra_identity_updated', {displayName: fullName});
        promises.push(publishKind0Metadata({
          name: fullName,
          display_name: fullName,
          nip05: nostraIdentity.nip05() || undefined
        }).catch(noop));
      }

      Promise.race(promises).finally(() => {
        this.editPeer.nextBtn.removeAttribute('disabled');
      });
    }, {listenerSetter: this.listenerSetter});

    this.firstNameInputField.setOriginalValue(user.first_name, true);
    this.lastNameInputField.setOriginalValue(user.last_name, true);
    this.bioInputField.setOriginalValue(userFull.about, true);

    this.editPeer.handleChange();
  }

  public focus(on: string) {
    getHeavyAnimationPromise().then(() => {
      const focusMap: {[key: string]: InputField} = {
        'first-name': this.firstNameInputField,
        'last-name': this.lastNameInputField,
        'bio': this.bioInputField
      };

      if(focusMap[on]) {
        placeCaretAtEnd(focusMap[on].input);
      } else if(on === 'set-photo') {
        shake(this.editPeer.avatarElem.node);
      }
    });
  }
}
