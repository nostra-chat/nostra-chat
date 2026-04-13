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
import Button from '@components/button';
import {uploadToBlossom} from '@lib/nostra/blossom-upload';
import {loadEncryptedIdentity, loadBrowserKey, decryptKeys} from '@lib/nostra/key-storage';
import {importFromMnemonic, decodePubkey} from '@lib/nostra/nostr-identity';
import {verifyNip05, buildNip05Instructions} from '@lib/nostra/nip05';
import type {Nip05Status} from '@lib/nostra/nip05';

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
  private nip05InputField: InputField;
  private nip05Status: Nip05Status = 'unverified';
  private nip05StatusEl: HTMLElement | null = null;

  private editPeer: EditPeer;

  public static getInitArgs() {
    // In Nostra mode getSelf() / getProfile() may hang (no MTProto auth).
    // Wrap each promise with a 3 s timeout so the UI renders regardless.
    const withTimeout = <T>(p: Promise<T>, ms = 500, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

    return {
      bioMaxLength: withTimeout(
        rootScope.managers.apiManager.getLimit('bio'),
        500,
        255
      ),
      user: withTimeout(
        rootScope.managers.appUsersManager.getSelf(),
        500,
        {first_name: '', last_name: ''} as any
      ),
      userFull: withTimeout(
        rootScope.managers.appProfileManager.getProfile(rootScope.myId.toUserId()),
        500,
        {about: ''} as any
      )
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
        maxLength: 70,
        plainText: true
      });
      this.lastNameInputField = new InputField({
        label: 'Login.Register.LastName.Placeholder',
        name: 'last-name',
        maxLength: 64,
        plainText: true
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

    // [Nostra.chat] Nostr Identity section — merged from nostraIdentity.ts
    const identity = useNostraIdentity();
    let npubValue = identity.npub() || '';

    if(!npubValue) {
      try {
        const record = await loadEncryptedIdentity();
        if(record) {
          const browserKey = await loadBrowserKey();
          if(browserKey) {
            const {seed} = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
            const id = importFromMnemonic(seed);
            npubValue = id.npub;
            rootScope.dispatchEvent('nostra_identity_loaded', {
              npub: id.npub,
              displayName: record.displayName || null,
              nip05: undefined,
              protectionType: 'none'
            });
          }
        }
      } catch(err) {
        console.warn('[EditProfile] failed to load identity:', err);
      }
    }

    if(npubValue) {
      const pubkeySection = new SettingSection({name: 'Public Key' as any});
      const npubRow = new Row({
        title: npubValue,
        subtitle: 'Your Nostr public key (npub)',
        icon: 'copy',
        clickable: () => {
          navigator.clipboard.writeText(npubValue).then(() => toast('Copied to clipboard'));
        },
        listenerSetter: this.listenerSetter
      });
      npubRow.title.classList.add('npub-wordbreak');
      pubkeySection.content.append(npubRow.container);
      this.scrollable.append(pubkeySection.container);

      const nip05Section = new SettingSection({
        name: 'NIP-05 Identity' as any,
        caption: 'Set a human-readable identifier (e.g. alice@example.com)' as any
      });
      nip05Section.container.dataset.section = 'nip05';

      this.nip05InputField = new InputField({
        label: 'NIP-05 Alias' as any,
        name: 'nip05-alias',
        maxLength: 100,
        plainText: true
      });
      this.nip05InputField.setOriginalValue(identity.nip05() || '', true);

      const instructionsEl = document.createElement('div');
      instructionsEl.classList.add('nip05-instructions');
      this.updateInstructions(instructionsEl, this.nip05InputField.value, npubValue);
      this.nip05InputField.input.addEventListener('input', () => {
        this.updateInstructions(instructionsEl, this.nip05InputField.value, npubValue);
      });

      this.nip05StatusEl = document.createElement('div');
      this.nip05StatusEl.classList.add('nip05-status');
      if(identity.nip05()) {
        this.nip05Status = 'verified';
      }
      this.updateNip05StatusDisplay();

      const verifyBtn = Button('btn-primary btn-color-primary');
      verifyBtn.textContent = 'Verify';
      attachClickEvent(verifyBtn, async() => {
        const alias = this.nip05InputField.value.trim();
        if(!alias) { toast('Enter a NIP-05 alias first'); return; }
        const hexPub = npubValue ? decodePubkey(npubValue) : null;
        if(!hexPub) { toast('No identity loaded'); return; }

        this.nip05Status = 'verifying';
        this.updateNip05StatusDisplay();

        const result = await verifyNip05(alias, hexPub);
        if(result.ok) {
          this.nip05Status = 'verified';
          this.updateNip05StatusDisplay();
          rootScope.dispatchEvent('nostra_identity_updated', {nip05: alias});
          toast('NIP-05 verified');
        } else {
          this.nip05Status = 'failed';
          this.updateNip05StatusDisplay(result.error);
        }
      }, {listenerSetter: this.listenerSetter});

      nip05Section.content.append(
        this.nip05InputField.container,
        instructionsEl,
        this.nip05StatusEl,
        verifyBtn
      );
      this.scrollable.append(nip05Section.container);
    }

    attachClickEvent(this.editPeer.nextBtn, async() => {
      this.editPeer.nextBtn.disabled = true;
      try {
        const fullName = [this.firstNameInputField.value, this.lastNameInputField.value].filter(Boolean).join(' ');
        const bio = this.bioInputField.value;

        let pictureUrl: string | undefined;
        if(this.editPeer.lastAvatarBlob) {
          try {
            const record = await loadEncryptedIdentity();
            const browserKey = await loadBrowserKey();
            if(!record || !browserKey) throw new Error('no identity loaded');
            const {seed} = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
            const id = importFromMnemonic(seed);
            const {url} = await uploadToBlossom(this.editPeer.lastAvatarBlob, id.privateKey);
            pictureUrl = url;
          } catch(err) {
            console.error('[EditProfile] blossom upload failed:', err);
            toast('Avatar upload failed — saved without new avatar');
          }
        }

        if(npubValue) {
          rootScope.dispatchEvent('nostra_identity_updated', {
            displayName: fullName,
            ...(pictureUrl ? {picture: pictureUrl} : {})
          });
          await publishKind0Metadata({
            name: fullName,
            display_name: fullName,
            about: bio,
            nip05: useNostraIdentity().nip05() || undefined,
            picture: pictureUrl || undefined
          }).catch((err) => {
            console.error('[EditProfile] kind 0 publish failed:', err);
            toast('Profile saved locally but relay publish failed');
          });
        }

        this.close();
      } finally {
        this.editPeer.nextBtn.removeAttribute('disabled');
      }
    }, {listenerSetter: this.listenerSetter});

    // In Nostra mode user may be a fallback empty object; prefer identity display name
    const identity2 = useNostraIdentity();
    const displayNameFallback = identity2.displayName() || '';
    this.firstNameInputField.setOriginalValue(user?.first_name || displayNameFallback, true);
    this.lastNameInputField.setOriginalValue(user?.last_name || '', true);
    this.bioInputField.setOriginalValue(userFull?.about || '', true);

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

  private updateInstructions(el: HTMLElement, alias: string, npub: string): void {
    el.textContent = '';
    const atIndex = alias.indexOf('@');
    if(atIndex < 1 || !npub) {
      const hint = document.createElement('p');
      hint.classList.add('nip05-hint');
      hint.textContent = 'Enter a NIP-05 alias above to see setup instructions.';
      el.append(hint);
      return;
    }
    const name = alias.slice(0, atIndex);
    const domain = alias.slice(atIndex + 1);
    const hexPub = decodePubkey(npub);
    const snippet = buildNip05Instructions(name, hexPub);
    const hint = document.createElement('p');
    hint.classList.add('nip05-hint');
    hint.textContent = `Add this to https://${domain}/.well-known/nostr.json:`;
    const pre = document.createElement('pre');
    pre.classList.add('nip05-snippet');
    pre.textContent = snippet;
    el.append(hint, pre);
  }

  private updateNip05StatusDisplay(errorMsg?: string): void {
    if(!this.nip05StatusEl) return;
    this.nip05StatusEl.className = 'nip05-status';
    switch(this.nip05Status) {
      case 'unverified': this.nip05StatusEl.textContent = ''; break;
      case 'verifying':
        this.nip05StatusEl.classList.add('nip05-status--verifying');
        this.nip05StatusEl.textContent = 'Verifying...';
        break;
      case 'verified':
        this.nip05StatusEl.classList.add('nip05-status--verified');
        this.nip05StatusEl.textContent = 'Verified';
        break;
      case 'failed':
        this.nip05StatusEl.classList.add('nip05-status--failed');
        this.nip05StatusEl.textContent = errorMsg || 'Verification failed';
        break;
    }
  }
}
