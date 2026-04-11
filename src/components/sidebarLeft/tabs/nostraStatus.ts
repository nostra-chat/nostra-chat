/**
 * AppNostraStatusTab — Status page in hamburger menu
 *
 * Displays Tor status and Nostr relay connection status.
 * Accessible from hamburger menu and search bar status icons.
 */

import SliderSuperTab from '@components/sliderTab';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import rootScope from '@lib/rootScope';
import {DEFAULT_RELAYS} from '@lib/nostra/nostr-relay-pool';

export default class AppNostraStatusTab extends SliderSuperTab {
  public static getInitArgs() {
    return {};
  }

  public async init() {
    this.container.classList.add('nostra-status-container');
    this.setTitle('Status' as any);

    // ─── Section: Tor Status ─────────────────────────────────

    const torSection = new SettingSection({
      name: 'Tor Connection' as any,
      caption: 'Anonymous routing via Tor network' as any
    });

    const torStatusRow = new Row({
      title: 'Tor Status',
      subtitle: 'Checking...',
      icon: 'lock'
    });

    // Update Tor status
    const updateTorStatus = (state: string) => {
      const subtitles: Record<string, string> = {
        active: '🟢 Active — traffic routed through Tor',
        bootstrap: '⏳ Bootstrapping...',
        direct: '🟠 Direct connection (IP visible)',
        error: '🔴 Tor failed'
      };
      torStatusRow.subtitle.textContent = subtitles[state] || state;
    };

    updateTorStatus('direct'); // default

    rootScope.addEventListener('nostra_tor_state', (state) => {
      updateTorStatus(typeof state === 'string' ? state : state?.state || 'direct');
    });

    torSection.content.append(torStatusRow.container);

    // ─── Section: Relay Status ───────────────────────────────

    const relaySection = new SettingSection({
      name: 'Nostr Relays' as any,
      caption: 'Message routing and storage' as any
    });

    // Create a row for each relay
    const relayRows: Row[] = [];
    for(const relay of DEFAULT_RELAYS) {
      const row = new Row({
        title: relay.url,
        subtitle: 'Connecting...',
        icon: 'link'
      });

      // Add R/W badges
      const badges = document.createElement('span');
      badges.style.cssText = 'margin-left:auto;font-size:11px;opacity:0.7;';
      if(relay.read) badges.textContent += ' R';
      if(relay.write) badges.textContent += ' W';
      row.container.querySelector('.row-title')?.append(badges);

      relayRows.push(row);
      relaySection.content.append(row.container);
    }

    // Update relay status from the global relay pool
    const updateRelayStatus = () => {
      try {
        const pool = (window as any).__nostraPool;
        if(!pool) return;

        const entries = pool.getRelayEntries?.() || [];
        entries.forEach((entry: any, i: number) => {
          if(i >= relayRows.length) return;
          const row = relayRows[i];
          const instance = entry.instance;
          const connected = instance?.isConnected?.() ?? false;
          const latency = instance?.getLatency?.();

          if(connected) {
            const latStr = latency ? `${latency}ms` : '';
            row.subtitle.textContent = `🟢 Connected ${latStr}`;
          } else {
            const state = instance?.getConnectionState?.() || 'disconnected';
            row.subtitle.textContent = state === 'connecting' || state === 'reconnecting' ?
              `⏳ ${state.charAt(0).toUpperCase() + state.slice(1)}...` :
              '🔴 Disconnected';
          }
        });
      } catch(err) {
        console.debug('[NostraStatus] relay status update failed:', err);
      }
    };

    // Initial update + periodic refresh
    updateRelayStatus();
    const interval = setInterval(updateRelayStatus, 5000);

    // Listen for relay state changes
    rootScope.addEventListener('nostra_relay_state', updateRelayStatus as any);

    // Clean up on tab destroy
    (this as any).eventListener?.addEventListener('destroy', () => {
      clearInterval(interval);
    });

    this.scrollable.append(
      torSection.container,
      relaySection.container
    );
  }
}
