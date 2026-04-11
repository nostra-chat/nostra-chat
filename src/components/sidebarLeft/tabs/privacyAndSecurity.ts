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

export default class AppPrivacyAndSecurityTab extends SliderSuperTab {
  public static getInitArgs(fromTab: SliderSuperTab) {
    return {};
  }

  public async init(_p?: any) {
    this.container.classList.add('privacy-container');
    this.setTitle('PrivacySettings');

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

    securitySection.content.append(keyProtectionRow.container);

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
