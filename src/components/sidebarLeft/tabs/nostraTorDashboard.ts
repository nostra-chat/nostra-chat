/**
 * AppNostraTorDashboardTab — Tor circuit dashboard in sidebar
 *
 * Shows guard/middle/exit hop chain, exit IP, circuit age, latency.
 * Rebuild button forces a new circuit via PrivacyTransport.retryTor().
 */

import SliderSuperTab from '@components/sliderTab';
import SettingSection from '@components/settingSection';
import rootScope from '@lib/rootScope';

export default class AppNostraTorDashboardTab extends SliderSuperTab {
  private circuitEl: HTMLElement;
  private exitIpEl: HTMLElement;
  private circuitAgeEl: HTMLElement;
  private latencyEl: HTMLElement;
  private circuitAgeInterval: ReturnType<typeof setInterval>;
  private circuitBuiltAt: number = 0;
  private rebuildBtn: HTMLButtonElement;

  public static getInitArgs() {
    return {};
  }

  public init() {
    this.setTitle('Tor Circuit' as any);
    this.container.classList.add('tor-dashboard-container');

    // ─── Section: Circuit Hops ───────────────────────────────

    const circuitSection = new SettingSection({
      name: 'Circuit' as any,
      caption: 'Current Tor relay chain' as any
    });

    const hopChain = document.createElement('div');
    hopChain.className = 'tor-hop-chain';

    const guardEl = this.createHop('Guard');
    const middleEl = this.createHop('Middle');
    const exitEl = this.createHop('Exit');

    const arrow1 = document.createElement('span');
    arrow1.className = 'tor-hop-arrow';
    arrow1.textContent = '→';

    const arrow2 = document.createElement('span');
    arrow2.className = 'tor-hop-arrow';
    arrow2.textContent = '→';

    hopChain.append(guardEl.container, arrow1, middleEl.container, arrow2, exitEl.container);
    circuitSection.content.append(hopChain);

    this.circuitEl = hopChain;
    (this.circuitEl as any)._hops = {guard: guardEl, middle: middleEl, exit: exitEl};

    // ─── Section: Details ────────────────────────────────────

    const detailsSection = new SettingSection({
      name: 'Details' as any
    });

    const exitIpRow = this.createDetailRow('Exit IP');
    const circuitAgeRow = this.createDetailRow('Circuit Age');
    const latencyRow = this.createDetailRow('Latency');

    this.exitIpEl = exitIpRow.valueEl;
    this.circuitAgeEl = circuitAgeRow.valueEl;
    this.latencyEl = latencyRow.valueEl;

    detailsSection.content.append(
      exitIpRow.rowEl,
      circuitAgeRow.rowEl,
      latencyRow.rowEl
    );

    // ─── Rebuild Button ──────────────────────────────────────

    const rebuildSection = new SettingSection({});

    const btn = document.createElement('button');
    btn.className = 'btn-primary tor-rebuild-btn';
    btn.textContent = 'Rebuild Circuit';
    btn.onclick = () => this.handleRebuild();
    this.rebuildBtn = btn;

    rebuildSection.content.append(btn);

    // ─── Event Listener ──────────────────────────────────────

    const onCircuitUpdate = (details: {
      guard: string;
      middle: string;
      exit: string;
      latency: number;
      exitIp: string;
      healthy: boolean;
    }) => {
      const hops = (this.circuitEl as any)._hops;
      this.updateHop(hops.guard, details.guard, details.healthy);
      this.updateHop(hops.middle, details.middle, details.healthy);
      this.updateHop(hops.exit, details.exit, details.healthy);

      this.exitIpEl.textContent = details.exitIp || '—';
      this.latencyEl.textContent = details.latency ? `${details.latency}ms` : '—';

      this.circuitBuiltAt = Date.now();
      this.updateCircuitAge();
    };

    rootScope.addEventListener('nostra_tor_circuit_update', onCircuitUpdate);

    // ─── Circuit Age Timer ───────────────────────────────────

    this.circuitAgeInterval = setInterval(() => {
      this.updateCircuitAge();
    }, 1000);

    // ─── Cleanup ─────────────────────────────────────────────

    (this as any).eventListener?.addEventListener('destroy', () => {
      clearInterval(this.circuitAgeInterval);
      rootScope.removeEventListener('nostra_tor_circuit_update', onCircuitUpdate);
    });

    this.scrollable.append(
      circuitSection.container,
      detailsSection.container,
      rebuildSection.container
    );
  }

  private createHop(label: string): {container: HTMLElement, labelEl: HTMLElement, idEl: HTMLElement} {
    const container = document.createElement('div');
    container.className = 'tor-hop';

    const labelEl = document.createElement('span');
    labelEl.className = 'tor-hop-label';
    labelEl.textContent = label;

    const idEl = document.createElement('span');
    idEl.className = 'tor-hop-id';
    idEl.textContent = '—';

    container.append(labelEl, idEl);
    return {container, labelEl, idEl};
  }

  private updateHop(hop: {container: HTMLElement, labelEl: HTMLElement, idEl: HTMLElement}, fingerprint: string, healthy: boolean) {
    hop.idEl.textContent = fingerprint ? fingerprint.slice(0, 8) + '…' : '—';
    hop.container.classList.remove('tor-hop--healthy', 'tor-hop--unhealthy');
    if(fingerprint) {
      hop.container.classList.add(healthy ? 'tor-hop--healthy' : 'tor-hop--unhealthy');
    }
  }

  private createDetailRow(label: string): {rowEl: HTMLElement, valueEl: HTMLElement} {
    const rowEl = document.createElement('div');
    rowEl.className = 'tor-detail-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'tor-detail-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'tor-detail-value';
    valueEl.textContent = '—';

    rowEl.append(labelEl, valueEl);
    return {rowEl, valueEl};
  }

  private updateCircuitAge() {
    if(!this.circuitBuiltAt) {
      this.circuitAgeEl.textContent = '—';
      return;
    }
    const elapsed = Math.floor((Date.now() - this.circuitBuiltAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    this.circuitAgeEl.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  private handleRebuild() {
    const transport = (window as any).__nostraPrivacyTransport;
    if(!transport) return;

    this.rebuildBtn.disabled = true;
    this.rebuildBtn.textContent = 'Rebuilding…';

    Promise.resolve(transport.retryTor?.()).then(() => {
      this.rebuildBtn.disabled = false;
      this.rebuildBtn.textContent = 'Rebuild Circuit';
    }).catch(() => {
      this.rebuildBtn.disabled = false;
      this.rebuildBtn.textContent = 'Rebuild Circuit';
    });
  }
}
