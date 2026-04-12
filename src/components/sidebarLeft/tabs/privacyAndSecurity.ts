/*
 * Nostra.chat Privacy & Security settings
 * Replaces Telegram's MTProto-dependent privacy settings with
 * Nostr-relevant security options.
 */

import SliderSuperTab from '@components/sliderTab';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import rootScope from '@lib/rootScope';
import CheckboxField from '@components/checkboxField';
import AppNostraSecurityTab from '@components/sidebarLeft/tabs/nostraSecurity';
import AppNostraSeedPhraseTab from '@components/sidebarLeft/tabs/nostraSeedPhrase';
import {PrivacyTransport} from '@lib/nostra/privacy-transport';

export default class AppPrivacyAndSecurityTab extends SliderSuperTab {
  public static getInitArgs(fromTab: SliderSuperTab) {
    return {};
  }

  public async init(_p?: any) {
    this.container.classList.add('privacy-container');
    this.setTitle('PrivacySettings');

    // --- Tor section ---
    const torSection = new SettingSection({name: 'Tor Network' as any});

    const torEnabled = PrivacyTransport.isTorEnabled();
    const torCheckbox = new CheckboxField({
      toggle: true,
      checked: torEnabled
    });

    const torRow = new Row({
      title: 'Route traffic through Tor',
      subtitle: torEnabled ?
        'Your IP is hidden from relays' :
        'Direct connection — your IP is visible to relays',
      checkboxField: torCheckbox,
      clickable: true
    });

    const torStatusSubtitle = torRow.subtitle;

    torCheckbox.input.addEventListener('change', async() => {
      const enabled = torCheckbox.checked;
      if(!enabled) {
        const [{default: TorFallbackConfirm}, {render}] = await Promise.all([
          import('@components/popups/torFallbackConfirm'),
          import('solid-js/web')
        ]);
        const overlay = document.createElement('div');
        document.body.append(overlay);
        const dispose = render(() => TorFallbackConfirm({
          onRetry: () => {
            torCheckbox.setValueSilently(true);
            const transport = (window as any).__nostraPrivacyTransport;
            if(transport) transport.setTorEnabled(true);
          },
          onConfirmDirect: () => {
            const transport = (window as any).__nostraPrivacyTransport;
            if(transport) transport.setTorEnabled(false);
            torStatusSubtitle.textContent = 'Direct connection — your IP is visible to relays';
            torStatusSubtitle.classList.add('danger');
          },
          onClose: () => {
            dispose();
            overlay.remove();
          }
        }), overlay);
      } else {
        const transport = (window as any).__nostraPrivacyTransport;
        if(transport) transport.setTorEnabled(true);
        torStatusSubtitle.textContent = 'Connecting to Tor...';
        torStatusSubtitle.classList.remove('danger');
      }
    });

    rootScope.addEventListener('nostra_tor_state', (e) => {
      const state = e.state;
      if(state === 'active') {
        torStatusSubtitle.textContent = 'Connected via Tor';
        torStatusSubtitle.classList.remove('danger');
        torStatusSubtitle.classList.add('success');
      } else if(state === 'bootstrapping') {
        torStatusSubtitle.textContent = 'Connecting to Tor...';
        torStatusSubtitle.classList.remove('danger', 'success');
      } else if(state === 'failed') {
        torStatusSubtitle.textContent = 'Tor connection failed';
        torStatusSubtitle.classList.add('danger');
        torStatusSubtitle.classList.remove('success');
      } else if(state === 'direct') {
        torStatusSubtitle.textContent = 'Direct connection — your IP is visible to relays';
        torStatusSubtitle.classList.add('danger');
        torStatusSubtitle.classList.remove('success');
      }
    });

    torSection.content.append(torRow.container);

    // --- Mesh Network section ---
    const meshSection = new SettingSection({name: 'Mesh Network' as any});

    const meshRow = new Row({
      title: 'P2P Mesh Settings',
      subtitle: 'Direct connections between contacts',
      icon: 'link',
      clickable: async() => {
        const {default: AppNostraMeshSettingsTab} = await import('@components/sidebarLeft/tabs/nostraMeshSettings');
        const tab = new AppNostraMeshSettingsTab(this.slider);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    meshSection.content.append(meshRow.container);

    // Section 1: Key Security
    const securitySection = new SettingSection({
      name: 'Key Protection' as any,
      caption: 'Protect your Nostr private keys' as any
    });

    const keyProtectionRow = new Row({
      title: 'PIN / Passphrase',
      subtitle: 'Protect your seed phrase with a PIN or passphrase',
      icon: 'lock',
      clickable: () => {
        const tab = this.slider.createTab(AppNostraSecurityTab);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    const recoveryPhraseRow = new Row({
      title: 'Recovery Phrase',
      subtitle: 'View your 12-word backup to restore access',
      icon: 'key',
      clickable: () => {
        const tab = this.slider.createTab(AppNostraSeedPhraseTab);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    securitySection.content.append(keyProtectionRow.container, recoveryPhraseRow.container);

    // Section 2: Read Receipts (Nostra.chat-specific)
    const privacySection = new SettingSection({
      name: 'Privacy' as any
    });

    const readReceiptsRow = new Row({
      title: 'Read Receipts',
      subtitle: 'Let others know when you read their messages',
      icon: 'readchats',
      checkboxField: new CheckboxField({
        toggle: true,
        checked: true
      })
    });

    readReceiptsRow.checkboxField.input.addEventListener('change', () => {
      const enabled = readReceiptsRow.checkboxField.checked;
      rootScope.dispatchEvent('nostra_read_receipts_toggle', enabled);
    });

    // Check current state from localStorage
    try {
      const stored = localStorage.getItem('nostra:read-receipts-enabled');
      if(stored === 'false') {
        readReceiptsRow.checkboxField.checked = false;
      }
    } catch{}

    const relayPrivacyRow = new Row({
      title: 'Relay Privacy',
      subtitle: 'Messages are encrypted end-to-end via NIP-17',
      icon: 'key',
      clickable: false
    });

    privacySection.content.append(
      readReceiptsRow.container,
      relayPrivacyRow.container
    );

    // Section 3: Danger Zone
    const dangerSection = new SettingSection({
      name: 'Danger Zone' as any
    });

    const deleteAccountRow = new Row({
      title: 'Delete Account',
      subtitle: 'Remove all local data and identity',
      icon: 'delete',
      clickable: async() => {
        const {default: confirmationPopup} = await import('@components/confirmationPopup');
        try {
          await confirmationPopup({
            titleLangKey: 'DeleteAccount' as any,
            descriptionLangKey: 'AreYouSure' as any,
            button: {
              langKey: 'Delete' as any,
              isDanger: true
            }
          });
          indexedDB.deleteDatabase('Nostra.chat');
          location.reload();
        } catch{}
      },
      listenerSetter: this.listenerSetter
    });
    deleteAccountRow.container.classList.add('danger');

    dangerSection.content.append(deleteAccountRow.container);

    this.scrollable.append(
      torSection.container,
      meshSection.container,
      securitySection.container,
      privacySection.container,
      dangerSection.container
    );
  }
}

// Register lazily to avoid circular import with solidJsTabs
import('@components/solidJsTabs').then(({providedTabs}) => {
  providedTabs.AppPrivacyAndSecurityTab = AppPrivacyAndSecurityTab;
});
