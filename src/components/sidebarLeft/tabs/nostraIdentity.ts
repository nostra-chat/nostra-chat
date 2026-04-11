/*
 * Nostra.chat -- Identity Settings UI
 *
 * Settings > Identity tab: display npub, edit display name,
 * NIP-05 alias setup with verification, and kind 0 metadata publishing.
 */

import {SliderSuperTab} from '@components/slider';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import InputField from '@components/inputField';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import Button from '@components/button';
import {toast} from '@components/toast';
import useNostraIdentity from '@stores/nostraIdentity';
import rootScope from '@lib/rootScope';
import {publishKind0Metadata} from '@lib/nostra/nostr-relay';
import {verifyNip05, buildNip05Instructions} from '@lib/nostra/nip05';
import {loadEncryptedIdentity, loadBrowserKey, decryptKeys} from '@lib/nostra/key-storage';
import {importFromMnemonic, decodePubkey} from '@lib/nostra/nostr-identity';
import type {Nip05Status} from '@lib/nostra/nip05';
import {generateDicebearAvatar} from '@helpers/generateDicebearAvatar';

export default class AppNostraIdentityTab extends SliderSuperTab {
  private nip05Status: Nip05Status = 'unverified';
  private statusEl: HTMLElement | null = null;

  public async init() {
    this.container.classList.add('nostra-identity-settings');
    this.setTitle('Identity' as any);

    const identity = useNostraIdentity();

    // Try store first, then load from IndexedDB as fallback
    let npubValue = identity.npub() || '';
    let displayNameValue = identity.displayName() || '';

    if(!npubValue) {
      try {
        const record = await loadEncryptedIdentity();
        if(record) {
          const browserKey = await loadBrowserKey();
          if(browserKey) {
            const {seed} = await decryptKeys(record.iv, record.encryptedKeys, browserKey);
            const id = importFromMnemonic(seed);
            npubValue = id.npub;
            displayNameValue = record.displayName || '';
            // Populate the store for future access
            rootScope.dispatchEvent('nostra_identity_loaded', {
              npub: id.npub,
              displayName: record.displayName || null,
              nip05: undefined,
              protectionType: 'none'
            });
          }
        }
      } catch(err) {
        console.warn('[NostraIdentity] failed to load from IndexedDB:', err);
      }
    }

    // Avatar preview
    const avatarSection = document.createElement('div');
    avatarSection.classList.add('nostra-identity-avatar');

    const avatarImg = document.createElement('img');
    avatarImg.classList.add('nostra-identity-avatar-img');
    avatarSection.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:1.5rem 0 0.5rem';
    avatarImg.style.cssText = 'width:96px;height:96px;border-radius:50%;object-fit:cover';
    avatarSection.append(avatarImg);

    if(npubValue) {
      try {
        const hex = decodePubkey(npubValue);
        generateDicebearAvatar(hex).then((url) => {
          avatarImg.src = url;
        });
      } catch{}
    }

    this.scrollable.append(avatarSection);

    // Section: Public Key
    const pubkeySection = new SettingSection({
      name: 'Public Key' as any
    });

    const npubRow = new Row({
      title: npubValue || 'No identity loaded',
      subtitle: 'Your Nostr public key (npub)',
      icon: 'copy',
      clickable: () => {
        if(npubValue) {
          navigator.clipboard.writeText(npubValue).then(() => {
            toast('Copied to clipboard');
          });
        }
      },
      listenerSetter: this.listenerSetter
    });

    npubRow.title.classList.add('npub-wordbreak');

    pubkeySection.content.append(npubRow.container);

    // Section: Display Name
    const nameSection = new SettingSection({
      name: 'Display Name' as any
    });

    const nameInputField = new InputField({
      label: 'Display Name' as any,
      name: 'display-name',
      maxLength: 70,
      plainText: true
    });
    nameInputField.setOriginalValue(displayNameValue || identity.displayName() || '', true);

    const saveNameBtn = Button('btn-primary btn-color-primary');
    saveNameBtn.textContent = 'Save Name';
    attachClickEvent(saveNameBtn, async() => {
      const newName = nameInputField.value.trim();
      if(!newName) return;

      rootScope.dispatchEvent('nostra_identity_updated', {displayName: newName});

      // Publish kind 0 metadata
      const hexPub = this.npubToHex(identity.npub() || '');
      if(hexPub) {
        try {
          await publishKind0Metadata({
            name: newName,
            display_name: newName,
            nip05: identity.nip05() || undefined
          });
          toast('Display name updated and published');
        } catch(err) {
          toast('Name saved locally but relay publish failed');
        }
      }
    }, {listenerSetter: this.listenerSetter});

    nameSection.content.append(nameInputField.container, saveNameBtn);

    // Section: NIP-05 Identity
    const nip05Section = new SettingSection({
      name: 'NIP-05 Identity' as any,
      caption: 'Set a human-readable identifier (e.g. alice@example.com)' as any
    });

    const aliasInputField = new InputField({
      label: 'NIP-05 Alias' as any,
      name: 'nip05-alias',
      maxLength: 100,
      plainText: true
    });
    aliasInputField.setOriginalValue(identity.nip05() || '', true);

    // Instructions
    const instructionsEl = document.createElement('div');
    instructionsEl.classList.add('nip05-instructions');
    this.updateInstructions(instructionsEl, aliasInputField.value, identity.npub() || '');

    aliasInputField.input.addEventListener('input', () => {
      this.updateInstructions(instructionsEl, aliasInputField.value, identity.npub() || '');
    });

    // Status indicator
    this.statusEl = document.createElement('div');
    this.statusEl.classList.add('nip05-status');
    this.updateStatusDisplay();

    // If already verified, show it
    if(identity.nip05()) {
      this.nip05Status = 'verified';
      this.updateStatusDisplay();
    }

    // Verify button
    const verifyBtn = Button('btn-primary btn-color-primary');
    verifyBtn.textContent = 'Verify';
    attachClickEvent(verifyBtn, async() => {
      const alias = aliasInputField.value.trim();
      if(!alias) {
        toast('Enter a NIP-05 alias first');
        return;
      }

      const hexPub = this.npubToHex(identity.npub() || '');
      if(!hexPub) {
        toast('No identity loaded');
        return;
      }

      this.nip05Status = 'verifying';
      this.updateStatusDisplay();

      const result = await verifyNip05(alias, hexPub);

      if(result.ok) {
        this.nip05Status = 'verified';
        this.updateStatusDisplay();

        rootScope.dispatchEvent('nostra_identity_updated', {nip05: alias});

        // Publish kind 0 metadata with nip05
        try {
          await publishKind0Metadata({
            name: identity.displayName() || undefined,
            display_name: identity.displayName() || undefined,
            nip05: alias
          });
          toast('NIP-05 verified and published');
        } catch{
          toast('Verified locally but relay publish failed');
        }
      } else {
        this.nip05Status = 'failed';
        this.updateStatusDisplay(result.error);
      }
    }, {listenerSetter: this.listenerSetter});

    nip05Section.content.append(
      aliasInputField.container,
      instructionsEl,
      this.statusEl,
      verifyBtn
    );

    this.scrollable.append(
      pubkeySection.container,
      nameSection.container,
      nip05Section.container
    );
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
    const hexPub = this.npubToHex(npub) || '<your-hex-pubkey>';

    const snippet = buildNip05Instructions(name, hexPub);

    const hint = document.createElement('p');
    hint.classList.add('nip05-hint');
    hint.textContent = `Add this to https://${domain}/.well-known/nostr.json:`;

    const pre = document.createElement('pre');
    pre.classList.add('nip05-snippet');
    pre.textContent = snippet;

    el.append(hint, pre);
  }

  private updateStatusDisplay(errorMsg?: string): void {
    if(!this.statusEl) return;

    this.statusEl.className = 'nip05-status';

    switch(this.nip05Status) {
      case 'unverified':
        this.statusEl.textContent = '';
        break;
      case 'verifying':
        this.statusEl.classList.add('nip05-status--verifying');
        this.statusEl.textContent = 'Verifying...';
        break;
      case 'verified':
        this.statusEl.classList.add('nip05-status--verified');
        this.statusEl.textContent = 'Verified';
        break;
      case 'failed':
        this.statusEl.classList.add('nip05-status--failed');
        this.statusEl.textContent = errorMsg || 'Verification failed';
        break;
    }
  }

  /**
   * Convert bech32 npub to hex pubkey.
   * Simple decode: npub is bech32 with "npub1" prefix.
   */
  private npubToHex(npub: string): string | null {
    if(!npub || !npub.startsWith('npub1')) return null;

    try {
      // Use nostr-tools nip19 decode if available, or manual bech32 decode
      // For now, use a simple approach: the hex is stored alongside npub
      // in the identity store, so we can look it up.
      // This is a simplified fallback — the identity store should provide hex.
      const {nip19} = require('nostr-tools');
      const decoded = nip19.decode(npub);
      if(decoded.type === 'npub') {
        return decoded.data as string;
      }
      return null;
    } catch{
      return null;
    }
  }
}
