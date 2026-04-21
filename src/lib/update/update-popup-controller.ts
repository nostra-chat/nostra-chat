import rootScope from '@lib/rootScope';
import {probe} from './probe';
import {getActiveVersion} from '@lib/serviceWorker/shell-cache';
import {getBakedPubkey} from './signing/trusted-keys';
import {startUpdateSigned} from './update-flow';

const SNOOZE_VERSION_KEY = 'nostra.update.snoozedVersion';
const SNOOZE_UNTIL_KEY = 'nostra.update.snoozedUntil';
const DECLINE_COUNT_KEY = 'nostra.update.declineCount';
const LAST_PROBE_KEY = 'nostra.update.lastProbe';
const PROBE_THROTTLE_MS = 12 * 60 * 60 * 1000;
const DECLINE_THRESHOLD_FOR_STALENESS = 7;

function now() { return Date.now(); }

function isSnoozed(version: string): boolean {
  const snoozedVersion = localStorage.getItem(SNOOZE_VERSION_KEY);
  const snoozedUntil = parseInt(localStorage.getItem(SNOOZE_UNTIL_KEY) || '0', 10);
  return snoozedVersion === version && snoozedUntil > now();
}

function recordDecline(version: string): number {
  const key = `${DECLINE_COUNT_KEY}.${version}`;
  const count = parseInt(localStorage.getItem(key) || '0', 10) + 1;
  localStorage.setItem(key, String(count));
  localStorage.setItem(SNOOZE_VERSION_KEY, version);
  localStorage.setItem(SNOOZE_UNTIL_KEY, String(now() + 24 * 60 * 60 * 1000));
  return count;
}

export async function runProbeIfDue(force = false): Promise<void> {
  if(!force) {
    const last = parseInt(localStorage.getItem(LAST_PROBE_KEY) || '0', 10);
    if(now() - last < PROBE_THROTTLE_MS) return;
  }
  localStorage.setItem(LAST_PROBE_KEY, String(now()));
  const active = await getActiveVersion();
  const installedPubkey = active?.installedPubkey || getBakedPubkey();
  if(!installedPubkey || installedPubkey.length === 0) {
    console.warn('[update] no trusted pubkey baked — probe skipped');
    return;
  }
  const result = await probe(installedPubkey, active?.version);
  if(result.outcome === 'update-available' && result.manifest && !isSnoozed(result.manifest.version)) {
    rootScope.dispatchEvent('update_available', {manifest: result.manifest, signature: result.signature || ''});
  }
  if(result.outcome === 'update-available' && result.manifest) {
    const count = parseInt(localStorage.getItem(`${DECLINE_COUNT_KEY}.${result.manifest.version}`) || '0', 10);
    if(count >= DECLINE_THRESHOLD_FOR_STALENESS) {
      rootScope.dispatchEvent('update_staleness_banner', {version: result.manifest.version});
    }
  }
}

export async function acceptUpdate(manifest: any, signature: string): Promise<{ok: boolean; reason?: string}> {
  return startUpdateSigned(manifest, signature);
}

export function declineUpdate(version: string): number {
  return recordDecline(version);
}
