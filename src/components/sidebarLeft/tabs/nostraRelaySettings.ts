/*
 * Nostra.chat — Relay Settings UI
 *
 * Full CRUD: per-relay status dot, latency, read/write toggles,
 * enable/disable, add, remove, reset to defaults.
 */

import {SliderSuperTab} from '@components/slider';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import Button from '@components/button';
import rootScope from '@lib/rootScope';
import {NostrRelayPool, RelayConfig, DEFAULT_RELAYS} from '@lib/nostra/nostr-relay-pool';

const LS_ONLY_MY_RELAYS = 'nostra-only-my-relays';

export default class AppNostraRelaySettingsTab extends SliderSuperTab {
  private relayPool: NostrRelayPool | null = null;
  private relayListEl: HTMLElement | null = null;
  private stateCleanup: (() => void) | null = null;
  private listCleanup: (() => void) | null = null;

  public init(relayPool?: NostrRelayPool) {
    this.container.classList.add('nostra-relay-settings');
    this.setTitle('Nostr Relays' as any);

    if(relayPool) {
      this.relayPool = relayPool;
    } else {
      this.relayPool = (window as any).__nostraPool ?? null;
    }

    // --- "Solo i miei relay" toggle ---
    const toggleSection = new SettingSection({});
    const onlyMineWrap = document.createElement('div');
    onlyMineWrap.classList.add('relay-only-mine');

    const onlyMineLabel = document.createElement('label');
    onlyMineLabel.textContent = 'Usa solo i miei relay';

    const onlyMineCheckbox = document.createElement('input');
    onlyMineCheckbox.type = 'checkbox';
    onlyMineCheckbox.checked = localStorage.getItem(LS_ONLY_MY_RELAYS) === '1';
    onlyMineCheckbox.addEventListener('change', () => {
      localStorage.setItem(LS_ONLY_MY_RELAYS, onlyMineCheckbox.checked ? '1' : '0');
    });

    onlyMineWrap.append(onlyMineLabel, onlyMineCheckbox);
    toggleSection.content.append(onlyMineWrap);

    // --- Current Relays ---
    const relaysSection = new SettingSection({
      name: 'Current Relays' as any
    });

    const relayList = document.createElement('div');
    relayList.classList.add('relay-list');
    this.relayListEl = relayList;
    relaysSection.content.append(relayList);

    this.renderRelayList(relayList);

    // Listen for relay state updates (status dots + latency)
    const stateHandler = () => {
      this.renderRelayList(relayList);
    };
    rootScope.addEventListener('nostra_relay_state', stateHandler);
    this.stateCleanup = () => {
      rootScope.removeEventListener('nostra_relay_state', stateHandler);
    };

    // Listen for relay list changes (external adds/removes)
    const listHandler = () => {
      this.renderRelayList(relayList);
    };
    rootScope.addEventListener('nostra_relay_list_changed', listHandler);
    this.listCleanup = () => {
      rootScope.removeEventListener('nostra_relay_list_changed', listHandler);
    };

    // --- Add Relay ---
    const addSection = new SettingSection({
      name: 'Add Relay' as any
    });

    const inputWrapper = document.createElement('div');
    inputWrapper.classList.add('input-field');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'wss://relay.example.com';
    input.classList.add('input-clear');

    const inputLabel = document.createElement('label');
    inputLabel.textContent = 'Relay URL';

    inputWrapper.append(input, inputLabel);

    const addButton = Button('btn-primary btn-color-primary');
    addButton.textContent = 'Add Relay';
    attachClickEvent(addButton, () => {
      const url = input.value.trim();
      if(!url || !url.startsWith('wss://')) {
        input.classList.add('error');
        return;
      }
      input.classList.remove('error');

      if(this.relayPool) {
        this.relayPool.addRelay({url, read: true, write: true});
        input.value = '';
        this.renderRelayList(relayList);
      }
    }, {listenerSetter: this.listenerSetter});

    addSection.content.append(inputWrapper, addButton);

    // --- Reset ---
    const resetSection = new SettingSection({});

    const resetButton = Button('btn-primary btn-color-primary btn-transparent danger');
    resetButton.textContent = 'Reset to Defaults';
    attachClickEvent(resetButton, () => {
      if(this.relayPool) {
        const current = this.relayPool.getRelays();
        for(const relay of current) {
          this.relayPool.removeRelay(relay.url);
        }
        for(const relay of DEFAULT_RELAYS) {
          this.relayPool.addRelay(relay);
        }
        this.renderRelayList(relayList);
      }
    }, {listenerSetter: this.listenerSetter});

    resetSection.content.append(resetButton);

    this.scrollable.append(
      toggleSection.container,
      relaysSection.container,
      addSection.container,
      resetSection.container
    );
  }

  public destroy() {
    if(this.stateCleanup) this.stateCleanup();
    if(this.listCleanup) this.listCleanup();
  }

  private renderRelayList(container: HTMLElement): void {
    container.innerHTML = '';

    const relays: RelayConfig[] = this.relayPool?.getRelays() ?? [];
    const states = this.relayPool?.getRelayStates() ?? [];
    const stateMap = new Map(states.map(s => [s.url, s]));

    if(relays.length === 0) {
      const empty = document.createElement('div');
      empty.classList.add('relay-list-empty');
      empty.textContent = 'No relays configured';
      container.append(empty);
      return;
    }

    for(const relay of relays) {
      const st = stateMap.get(relay.url);
      const connected = st?.connected ?? false;
      const latencyMs = st?.latencyMs ?? -1;
      const enabled = st?.enabled ?? true;

      // Status dot color
      let dotColor: string;
      if(!connected) {
        dotColor = 'red';
      } else if(latencyMs > 1000) {
        dotColor = 'yellow';
      } else {
        dotColor = 'green';
      }

      // Row container
      const rowEl = document.createElement('div');
      rowEl.classList.add('relay-row');
      if(!enabled) rowEl.classList.add('relay-row--disabled');

      // Status dot
      const dot = document.createElement('span');
      dot.classList.add('relay-status-dot', `relay-status-dot--${dotColor}`);
      rowEl.append(dot);

      // URL
      const urlEl = document.createElement('span');
      urlEl.classList.add('relay-url');
      urlEl.textContent = relay.url;
      rowEl.append(urlEl);

      // Latency
      const latEl = document.createElement('span');
      latEl.classList.add('relay-latency');
      latEl.textContent = latencyMs >= 0 ? `${latencyMs}ms` : '--';
      rowEl.append(latEl);

      // Read toggle
      const readLabel = document.createElement('label');
      readLabel.classList.add('relay-toggle');
      const readCb = document.createElement('input');
      readCb.type = 'checkbox';
      readCb.checked = relay.read;
      readCb.addEventListener('change', () => {
        this.updateRelayRW(relay.url, readCb.checked, writeCb.checked);
      });
      const readSpan = document.createElement('span');
      readSpan.textContent = 'R';
      readLabel.append(readCb, readSpan);
      rowEl.append(readLabel);

      // Write toggle
      const writeLabel = document.createElement('label');
      writeLabel.classList.add('relay-toggle');
      const writeCb = document.createElement('input');
      writeCb.type = 'checkbox';
      writeCb.checked = relay.write;
      writeCb.addEventListener('change', () => {
        this.updateRelayRW(relay.url, readCb.checked, writeCb.checked);
      });
      const writeSpan = document.createElement('span');
      writeSpan.textContent = 'W';
      writeLabel.append(writeCb, writeSpan);
      rowEl.append(writeLabel);

      // Enable/Disable toggle
      const enableLabel = document.createElement('label');
      enableLabel.classList.add('relay-toggle');
      const enableCb = document.createElement('input');
      enableCb.type = 'checkbox';
      enableCb.checked = enabled;
      enableCb.addEventListener('change', () => {
        if(this.relayPool) {
          if(enableCb.checked) {
            this.relayPool.enableRelay(relay.url);
          } else {
            this.relayPool.disableRelay(relay.url);
          }
          this.renderRelayList(container);
        }
      });
      const enableSpan = document.createElement('span');
      enableSpan.textContent = 'On';
      enableLabel.append(enableCb, enableSpan);
      rowEl.append(enableLabel);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('btn-icon', 'tgico-close');
      deleteBtn.addEventListener('click', () => {
        if(this.relayPool) {
          this.relayPool.removeRelay(relay.url);
          this.renderRelayList(container);
        }
      });
      rowEl.append(deleteBtn);

      container.append(rowEl);
    }
  }

  private updateRelayRW(url: string, read: boolean, write: boolean): void {
    if(!this.relayPool) return;
    // Remove then re-add with new read/write flags
    this.relayPool.removeRelay(url);
    this.relayPool.addRelay({url, read, write});
    if(this.relayListEl) {
      this.renderRelayList(this.relayListEl);
    }
  }
}
