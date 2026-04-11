/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import {SliderSuperTab} from '@components/slider';
import ButtonMenuToggle from '@components/buttonMenuToggle';
import AppGeneralSettingsTab from '@components/sidebarLeft/tabs/generalSettings';
import lottieLoader from '@lib/rlottie/lottieLoader';
import Row from '@components/row';
import SettingSection from '@components/settingSection';
import AppNostraRelaySettingsTab from '@components/sidebarLeft/tabs/nostraRelaySettings';
import AppNostraIdentityTab from '@components/sidebarLeft/tabs/nostraIdentity';
import useNostraIdentity from '@stores/nostraIdentity';
import showLogOutPopup from '@components/popups/logOut';

export default class AppSettingsTab extends SliderSuperTab {
  public async init() {
    this.container.classList.add('settings-container');
    this.setTitle('Settings');

    const btnMenu = ButtonMenuToggle({
      listenerSetter: this.listenerSetter,
      direction: 'bottom-left',
      buttons: [{
        icon: 'logout',
        text: 'EditAccount.Logout',
        onClick: () => {
          showLogOutPopup();
        }
      }]
    });

    this.header.append(btnMenu);

    // Profile section
    const identity = useNostraIdentity();

    const profileSection = new SettingSection({noDelimiter: true});
    const profileDiv = document.createElement('div');
    profileDiv.classList.add('nostra-settings-profile');

    const nameEl = document.createElement('div');
    nameEl.classList.add('nostra-settings-profile-name');
    nameEl.textContent = identity.displayName() || 'Nostra.chat User';

    const npubEl = document.createElement('div');
    npubEl.classList.add('nostra-settings-profile-npub');
    const npubVal = identity.npub() || '';
    npubEl.textContent = npubVal ? npubVal.slice(0, 12) + '...' + npubVal.slice(-8) : 'No identity';

    profileDiv.append(nameEl, npubEl);
    profileSection.content.append(profileDiv);

    // Menu rows
    const buttonsDiv = document.createElement('div');
    buttonsDiv.classList.add('profile-buttons');

    const identityRow = new Row({
      title: 'Identity',
      icon: 'user',
      clickable: () => {
        const tab = this.slider.createTab(AppNostraIdentityTab);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    const relayRow = new Row({
      title: 'Nostr Relays',
      icon: 'link',
      clickable: () => {
        const tab = this.slider.createTab(AppNostraRelaySettingsTab);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    const privacyRow = new Row({
      title: 'Privacy & Security',
      icon: 'lock',
      clickable: async() => {
        const {default: AppPrivacyAndSecurityTab} = await import('@components/sidebarLeft/tabs/privacyAndSecurity');
        const tab = this.slider.createTab(AppPrivacyAndSecurityTab);
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    const generalRow = new Row({
      titleLangKey: 'Nostra.GeneralSettingsViewController',
      icon: 'settings',
      clickable: () => {
        const tab = this.slider.createTab(AppGeneralSettingsTab);
        tab.open(AppGeneralSettingsTab.getInitArgs());
      },
      listenerSetter: this.listenerSetter
    });

    buttonsDiv.append(
      identityRow.container,
      relayRow.container,
      privacyRow.container,
      generalRow.container
    );

    const buttonsSection = new SettingSection();
    buttonsSection.content.append(buttonsDiv);

    this.scrollable.append(
      profileSection.container,
      buttonsSection.container
    );

    lottieLoader.loadLottieWorkers();
  }
}
