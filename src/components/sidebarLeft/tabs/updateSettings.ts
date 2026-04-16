/*
 * App Update Settings tab — shows installed version, last integrity check,
 * integrity status, and allows manual re-check.
 */

import {SliderSuperTab} from '@components/slider';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import Button from '@components/button';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {toast} from '@components/toast';
import {runNetworkChecks} from '@lib/update';

function formatRelativeTime(tsMs: number): string {
  const diff = Date.now() - tsMs;
  const sec = Math.floor(diff / 1000);
  if(sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if(min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if(hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function verdictLabel(verdict: string): string {
  if(verdict === 'verified') return '\u2705 Verified across all sources';
  if(verdict === 'verified-partial') return '\u26a0\ufe0f Partially verified';
  if(verdict === 'conflict') return '\u274c Conflict detected';
  if(verdict === 'insufficient') return '\u2139\ufe0f Insufficient sources';
  if(verdict === 'offline') return '\ud83d\udce1 Offline — could not check';
  return verdict;
}

export default class AppUpdateSettingsTab extends SliderSuperTab {
  public init() {
    this.container.classList.add('update-settings');
    this.setTitle('App Updates' as any);

    const infoSection = new SettingSection({
      name: 'Update Information' as any
    });

    // Current version row
    const installedVersion = localStorage.getItem('nostra.update.installedVersion') || 'unknown';
    const versionRow = new Row({
      title: 'Current version' as any,
      subtitle: installedVersion as any,
      clickable: false
    });
    infoSection.content.append(versionRow.container);

    // Last check row
    const lastCheckTs = parseInt(localStorage.getItem('nostra.update.lastIntegrityCheck') || '0', 10);
    const lastCheckText = lastCheckTs > 0 ? formatRelativeTime(lastCheckTs) : 'Never';
    const lastCheckRow = new Row({
      title: 'Last check' as any,
      subtitle: lastCheckText as any,
      clickable: false
    });
    infoSection.content.append(lastCheckRow.container);

    // Integrity status row
    const lastVerdict = localStorage.getItem('nostra.update.lastIntegrityResult') || '';
    const integrityRow = new Row({
      title: 'Integrity status' as any,
      subtitle: (lastVerdict ? verdictLabel(lastVerdict) : 'Not checked yet') as any,
      clickable: true
    });

    attachClickEvent(integrityRow.container, () => {
      const detailsRaw = localStorage.getItem('nostra.update.lastIntegrityDetails');
      if(!detailsRaw) {
        toast('No integrity details available' as any);
        return;
      }
      try {
        const sources: Array<{name: string; status: string; version?: string; error?: string}> = JSON.parse(detailsRaw);
        const lines = sources.map((s) => {
          const icon = s.status === 'ok' ? '\u2705' : s.status === 'error' ? '\u274c' : '\u26a0\ufe0f';
          return `${icon} ${s.name}: ${s.status}${s.version ? ' v' + s.version : ''}${s.error ? ' — ' + s.error : ''}`;
        });
        toast(lines.join('\n') as any);
      } catch{
        toast('Could not parse integrity details' as any);
      }
    }, {listenerSetter: this.listenerSetter});

    infoSection.content.append(integrityRow.container);

    // Actions section
    const actionsSection = new SettingSection({
      name: 'Actions' as any
    });

    const checkBtn = Button('btn-primary btn-color-primary');
    checkBtn.textContent = 'Check for updates';

    attachClickEvent(checkBtn, async() => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      try {
        await runNetworkChecks({force: true});

        // Refresh displayed values from localStorage
        const newTs = parseInt(localStorage.getItem('nostra.update.lastIntegrityCheck') || '0', 10);
        if(newTs > 0) {
          lastCheckRow.subtitle.textContent = formatRelativeTime(newTs);
        }

        const newVerdict = localStorage.getItem('nostra.update.lastIntegrityResult') || '';
        if(newVerdict) {
          integrityRow.subtitle.textContent = verdictLabel(newVerdict);
        }

        toast('Check complete' as any);
      } catch(err) {
        toast(('Check failed: ' + (err instanceof Error ? err.message : String(err))) as any);
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check for updates';
      }
    }, {listenerSetter: this.listenerSetter});

    actionsSection.content.append(checkBtn);

    this.scrollable.append(
      infoSection.container,
      actionsSection.container
    );
  }
}
