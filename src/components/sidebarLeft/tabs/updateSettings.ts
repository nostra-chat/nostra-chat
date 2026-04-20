/*
 * App Update Settings tab — diagnostics for the update / integrity subsystem
 * plus the "Reset baseline" recovery action and an inline explanation of the
 * compromise-detection mechanism. Opened from the main Settings tab.
 */

import {SliderSuperTab} from '@components/slider';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import Button from '@components/button';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {toast} from '@components/toast';
import confirmationPopup from '@components/confirmationPopup';
import {runNetworkChecks} from '@lib/update';
import {
  getUpdateStateSnapshot,
  resetBaseline,
  type UpdateStateSnapshot
} from '@lib/update/update-baseline';

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

function shortenUrl(url: string | null, keepTail = 28): string {
  if(!url) return '—';
  if(url.length <= keepTail + 3) return url;
  return '…' + url.slice(-keepTail);
}

const HOW_IT_WORKS_DESCRIPTION =
  'On every launch Nostra.chat verifies that the loaded code matches what was installed. ' +
  'This protects you from compromised CDNs, man-in-the-middle attacks, and unauthorized updates.\n\n' +
  'Three automatic checks:\n' +
  '1) Service Worker URL — must match the one saved at first install.\n' +
  '2) No unexpected Service Worker queued for installation.\n' +
  '3) Manifest compared across three independent sources (CDN, IPFS, GitHub).\n\n' +
  'If you see the "possible compromise detected" alert: always verify from the official site before proceeding. ' +
  'If you just changed device, cleared the cache, or reinstalled manually it may be a false positive, ' +
  'and "Reset baseline" adopts the current state as the new trusted point.\n\n' +
  'Do not reset if you suspect an active attack — in that case sign out and log in from the official site.';

const RESET_CONFIRM_DESCRIPTION =
  'This clears the stored trusted state (installed version, Service Worker URL, last integrity check). ' +
  'On the next launch the currently-running bundle will be captured as the new trusted state, and the app will reload.\n\n' +
  'Only use this if you are sure the currently-loaded code is legitimate.';

export default class AppUpdateSettingsTab extends SliderSuperTab {
  public async init() {
    this.container.classList.add('update-settings');
    this.setTitle('App Updates' as any);

    const snap: UpdateStateSnapshot = await getUpdateStateSnapshot();

    // ── Installed ────────────────────────────────────────────────────────
    const infoSection = new SettingSection({name: 'Installed' as any});

    const versionRow = new Row({
      title: 'Current version' as any,
      subtitle: (snap.installedVersion || 'unknown') as any,
      clickable: false
    });
    infoSection.content.append(versionRow.container);

    const swUrlRow = new Row({
      title: 'Installed Service Worker URL' as any,
      subtitle: shortenUrl(snap.installedSwUrl) as any,
      clickable: true
    });
    attachClickEvent(swUrlRow.container, () => {
      toast((snap.installedSwUrl || 'not set') as any);
    }, {listenerSetter: this.listenerSetter});
    infoSection.content.append(swUrlRow.container);

    const activeRow = new Row({
      title: 'Active Service Worker' as any,
      subtitle: shortenUrl(snap.activeScriptUrl) as any,
      clickable: !!snap.activeScriptUrl
    });
    if(snap.activeScriptUrl) {
      attachClickEvent(activeRow.container, () => {
        toast(snap.activeScriptUrl! as any);
      }, {listenerSetter: this.listenerSetter});
    }
    infoSection.content.append(activeRow.container);

    // ── Integrity ────────────────────────────────────────────────────────
    const integritySection = new SettingSection({name: 'Integrity' as any});

    const lastCheckText = snap.lastIntegrityCheck && snap.lastIntegrityCheck > 0 ?
      formatRelativeTime(snap.lastIntegrityCheck) :
      'Never';
    const lastCheckRow = new Row({
      title: 'Last check' as any,
      subtitle: lastCheckText as any,
      clickable: false
    });
    integritySection.content.append(lastCheckRow.container);

    const hasDetails = !!snap.lastIntegrityDetails?.length;
    const integrityRow = new Row({
      title: 'Integrity status' as any,
      subtitle: (snap.lastIntegrityResult ? verdictLabel(snap.lastIntegrityResult) : 'Not checked yet') as any,
      clickable: hasDetails
    });
    if(hasDetails) {
      attachClickEvent(integrityRow.container, () => {
        const lines = snap.lastIntegrityDetails!.map((s) => {
          const icon = s.status === 'ok' ? '\u2705' : s.status === 'error' ? '\u274c' : '\u26a0\ufe0f';
          return `${icon} ${s.name}: ${s.status}${s.version ? ' v' + s.version : ''}${s.error ? ' — ' + s.error : ''}`;
        });
        toast(lines.join('\n') as any);
      }, {listenerSetter: this.listenerSetter});
    }
    integritySection.content.append(integrityRow.container);

    const waitingRow = new Row({
      title: 'Waiting Service Worker' as any,
      subtitle: (snap.waitingScriptUrl ? shortenUrl(snap.waitingScriptUrl) : 'none') as any,
      clickable: !!snap.waitingScriptUrl
    });
    if(snap.waitingScriptUrl) {
      attachClickEvent(waitingRow.container, () => {
        toast(snap.waitingScriptUrl! as any);
      }, {listenerSetter: this.listenerSetter});
    }
    integritySection.content.append(waitingRow.container);

    const pendingRow = new Row({
      title: 'Pending update finalization' as any,
      subtitle: (snap.pendingFinalization ?
        (snap.pendingManifest ? `Yes — v${snap.pendingManifest.version}` : 'Yes') :
        'No') as any,
      clickable: false
    });
    integritySection.content.append(pendingRow.container);

    // ── Actions ──────────────────────────────────────────────────────────
    const actionsSection = new SettingSection({name: 'Actions' as any});

    const checkBtn = Button('btn-primary btn-color-primary');
    checkBtn.textContent = 'Check for updates';
    attachClickEvent(checkBtn, async() => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
      try {
        await runNetworkChecks({force: true});
        const latest = await getUpdateStateSnapshot();
        if(latest.lastIntegrityCheck) {
          lastCheckRow.subtitle.textContent = formatRelativeTime(latest.lastIntegrityCheck);
        }
        if(latest.lastIntegrityResult) {
          integrityRow.subtitle.textContent = verdictLabel(latest.lastIntegrityResult);
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

    const resetBtn = Button('btn-primary btn-color-primary danger');
    resetBtn.textContent = 'Reset baseline';
    resetBtn.style.marginTop = '0.5rem';
    attachClickEvent(resetBtn, async() => {
      try {
        await confirmationPopup({
          title: 'Reset baseline',
          descriptionRaw: RESET_CONFIRM_DESCRIPTION,
          button: {
            text: document.createTextNode('Reset and reload'),
            isDanger: true
          }
        });
      } catch{
        return; // user canceled
      }
      resetBaseline();
      window.location.reload();
    }, {listenerSetter: this.listenerSetter});
    actionsSection.content.append(resetBtn);

    // ── About this protection ───────────────────────────────────────────
    const helpSection = new SettingSection({name: 'About this protection' as any});
    const helpRow = new Row({
      title: 'How it works' as any,
      subtitle: 'Why this safeguard exists and when to reset' as any,
      icon: 'info',
      clickable: () => {
        confirmationPopup({
          title: 'Update protection',
          descriptionRaw: HOW_IT_WORKS_DESCRIPTION,
          button: {text: document.createTextNode('OK')}
        }).catch(() => { /* user closed */ });
      },
      listenerSetter: this.listenerSetter
    });
    helpSection.content.append(helpRow.container);

    this.scrollable.append(
      infoSection.container,
      integritySection.container,
      actionsSection.container,
      helpSection.container
    );
  }
}
