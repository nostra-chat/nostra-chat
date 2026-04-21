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
import I18n from '@lib/langPack';
import {runNetworkChecks} from '@lib/update';
import {
  getUpdateStateSnapshot,
  resetBaseline,
  type UpdateStateSnapshot,
  type IntegritySourceDetail
} from '@lib/update/update-baseline';
import {MANIFEST_SOURCES} from '@lib/update/manifest-verifier';

function formatRelativeTime(tsMs: number): string {
  const diff = Date.now() - tsMs;
  const sec = Math.floor(diff / 1000);
  if(sec < 60) return I18n.format('Update.RelativeTime.JustNow', true);
  const min = Math.floor(sec / 60);
  if(min < 60) return I18n.format('Update.RelativeTime.MinutesAgo', true, [min]);
  const hr = Math.floor(min / 60);
  if(hr < 24) return I18n.format('Update.RelativeTime.HoursAgo', true, [hr]);
  const d = Math.floor(hr / 24);
  return I18n.format('Update.RelativeTime.DaysAgo', true, [d]);
}

function verdictLabel(verdict: string): string {
  if(verdict === 'verified') return I18n.format('Update.Verdict.Verified', true);
  if(verdict === 'verified-partial') return I18n.format('Update.Verdict.VerifiedPartial', true);
  if(verdict === 'conflict') return I18n.format('Update.Verdict.Conflict', true);
  if(verdict === 'insufficient') return I18n.format('Update.Verdict.Insufficient', true);
  if(verdict === 'offline') return I18n.format('Update.Verdict.Offline', true);
  return verdict;
}

function pickLatestVersion(snap: UpdateStateSnapshot): string | null {
  if(snap.pendingManifest?.version) return snap.pendingManifest.version;
  const okSource = snap.lastIntegrityDetails?.find((d) => d.status === 'ok' && d.version);
  return okSource?.version ?? null;
}

function latestVersionSubtitle(snap: UpdateStateSnapshot): string {
  const latest = pickLatestVersion(snap);
  if(!latest) return I18n.format('Update.Value.NotCheckedYet', true);
  if(snap.installedVersion && latest !== snap.installedVersion) {
    return I18n.format('Update.Value.UpdateAvailable', true, [latest]);
  }
  return I18n.format('Update.Value.UpToDate', true, [latest]);
}

function buildIntegrityDetailsBlock(details: IntegritySourceDetail[]): HTMLDivElement {
  const urlByName = new Map(MANIFEST_SOURCES.map((s) => [s.name, s.url]));
  const block = document.createElement('div');
  block.className = 'update-integrity-details';
  block.style.cssText = 'display:flex;flex-direction:column;gap:0.375rem;padding:0.25rem 1.5rem 0.75rem 4.5rem;font-size:0.875rem';
  for(const s of details) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap';
    const icon = s.status === 'ok' ? '✅' : s.status === 'error' ? '❌' : '⚠️';
    const label = document.createElement('span');
    label.textContent = `${icon} ${s.name}: ${s.status}${s.version ? ' v' + s.version : ''}${s.error ? ' — ' + s.error : ''}`;
    label.style.cssText = 'flex:1;min-width:0;word-break:break-word;color:var(--secondary-text-color)';
    row.appendChild(label);
    const url = urlByName.get(s.name);
    if(url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = I18n.format('Update.Sources.OpenInTab', true);
      link.style.cssText = 'color:var(--primary-color);text-decoration:underline;flex-shrink:0';
      row.appendChild(link);
    }
    block.appendChild(row);
  }
  return block;
}

function applyFullUrlStyle(row: Row): void {
  row.subtitle.style.wordBreak = 'break-all';
  row.subtitle.style.whiteSpace = 'normal';
}

export default class AppUpdateSettingsTab extends SliderSuperTab {
  public async init() {
    this.container.classList.add('update-settings');
    this.setTitle('Update.Tab.Title');

    const snap: UpdateStateSnapshot = await getUpdateStateSnapshot();

    // ── Installed ────────────────────────────────────────────────────────
    const infoSection = new SettingSection({name: 'Update.Section.Installed'});

    const versionRow = new Row({
      titleLangKey: 'Update.Row.CurrentVersion',
      subtitle: snap.installedVersion || I18n.format('Update.Value.Unknown', true),
      clickable: false
    });
    infoSection.content.append(versionRow.container);

    const latestVersionRow = new Row({
      titleLangKey: 'Update.Row.LatestVersion',
      subtitle: latestVersionSubtitle(snap),
      clickable: false
    });
    infoSection.content.append(latestVersionRow.container);

    const swUrlRow = new Row({
      titleLangKey: 'Update.Row.InstalledSwUrl',
      subtitle: snap.installedSwUrl || I18n.format('Update.Value.NotSet', true),
      clickable: false
    });
    applyFullUrlStyle(swUrlRow);
    infoSection.content.append(swUrlRow.container);

    const activeRow = new Row({
      titleLangKey: 'Update.Row.ActiveSw',
      subtitle: snap.activeScriptUrl || I18n.format('Update.Value.NotSet', true),
      clickable: false
    });
    applyFullUrlStyle(activeRow);
    infoSection.content.append(activeRow.container);

    // ── Integrity ────────────────────────────────────────────────────────
    const integritySection = new SettingSection({name: 'Update.Section.Integrity'});

    const lastCheckText = snap.lastIntegrityCheck && snap.lastIntegrityCheck > 0 ?
      formatRelativeTime(snap.lastIntegrityCheck) :
      I18n.format('Update.Value.Never', true);
    const lastCheckRow = new Row({
      titleLangKey: 'Update.Row.LastCheck',
      subtitle: lastCheckText,
      clickable: false
    });
    integritySection.content.append(lastCheckRow.container);

    const integrityRow = new Row({
      titleLangKey: 'Update.Row.IntegrityStatus',
      subtitle: snap.lastIntegrityResult ? verdictLabel(snap.lastIntegrityResult) : I18n.format('Update.Value.NotCheckedYet', true),
      clickable: false
    });
    integritySection.content.append(integrityRow.container);

    let detailsBlock: HTMLDivElement | null = null;
    const renderDetails = (details: IntegritySourceDetail[] | null) => {
      detailsBlock?.remove();
      detailsBlock = null;
      if(details?.length) {
        detailsBlock = buildIntegrityDetailsBlock(details);
        integrityRow.container.after(detailsBlock);
      }
    };
    renderDetails(snap.lastIntegrityDetails);

    const waitingRow = new Row({
      titleLangKey: 'Update.Row.WaitingSw',
      subtitle: snap.waitingScriptUrl || I18n.format('Update.Value.None', true),
      clickable: false
    });
    applyFullUrlStyle(waitingRow);
    integritySection.content.append(waitingRow.container);

    const pendingRow = new Row({
      titleLangKey: 'Update.Row.PendingFinalization',
      subtitle: snap.pendingFinalization ?
        (snap.pendingManifest ? I18n.format('Update.Value.PendingYesWithVersion', true, [snap.pendingManifest.version]) : I18n.format('Update.Value.Yes', true)) :
        I18n.format('Update.Value.No', true),
      clickable: false
    });
    integritySection.content.append(pendingRow.container);

    // ── Actions ──────────────────────────────────────────────────────────
    const actionsSection = new SettingSection({name: 'Update.Section.Actions'});

    const checkBtnLabel = I18n.format('Update.Action.CheckForUpdates', true);
    const checkBtn = Button('btn-primary btn-color-primary');
    checkBtn.textContent = checkBtnLabel;
    attachClickEvent(checkBtn, async() => {
      checkBtn.disabled = true;
      checkBtn.textContent = I18n.format('Update.Action.Checking', true);
      try {
        await runNetworkChecks({force: true});
        // Also trigger consent-gated probe (signature verify + downgrade check)
        const {runProbeIfDue} = await import('@lib/update/update-popup-controller');
        await runProbeIfDue(true).catch((e) => console.warn('[update] probe failed', e));
        const latest = await getUpdateStateSnapshot();
        if(latest.lastIntegrityCheck) {
          lastCheckRow.subtitle.textContent = formatRelativeTime(latest.lastIntegrityCheck);
        }
        if(latest.lastIntegrityResult) {
          integrityRow.subtitle.textContent = verdictLabel(latest.lastIntegrityResult);
        }
        latestVersionRow.subtitle.textContent = latestVersionSubtitle(latest);
        renderDetails(latest.lastIntegrityDetails);
        toast(I18n.format('Update.Action.CheckComplete', true));
      } catch(err) {
        toast(I18n.format('Update.Action.CheckFailed', true, [err instanceof Error ? err.message : String(err)]));
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = checkBtnLabel;
      }
    }, {listenerSetter: this.listenerSetter});
    actionsSection.content.append(checkBtn);

    const resetBtn = Button('btn-primary btn-color-primary danger');
    resetBtn.textContent = I18n.format('Update.Action.ResetBaseline', true);
    resetBtn.style.marginTop = '0.5rem';
    attachClickEvent(resetBtn, async() => {
      try {
        await confirmationPopup({
          titleLangKey: 'Update.Action.ResetBaseline',
          descriptionLangKey: 'Update.Reset.Description',
          button: {
            text: document.createTextNode(I18n.format('Update.Action.ResetAndReload', true)),
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
    const helpSection = new SettingSection({name: 'Update.Section.About'});
    const helpRow = new Row({
      titleLangKey: 'Update.Row.HowItWorks',
      subtitleLangKey: 'Update.Row.HowItWorks.Subtitle',
      icon: 'info',
      clickable: () => {
        confirmationPopup({
          titleLangKey: 'Update.Confirm.ProtectionTitle',
          descriptionLangKey: 'Update.HowItWorks.Description',
          button: {text: document.createTextNode(I18n.format('Update.Action.OK', true))}
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
