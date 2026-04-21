// Dev-only helper for simulating the update-available flow in localhost without
// a mainnet deploy. updateBootstrap() is guarded by import.meta.env.PROD, so
// the popup controller never fires during `pnpm start`. This module registers
// the controller's listeners AND exposes a window.__triggerUpdatePopup() that
// dispatches a fake `update_integrity_check_completed` + `update_available`
// pair. Only loaded when import.meta.env.DEV is true — no prod footprint.
import rootScope from '@lib/rootScope';
import type {IntegrityResult, Manifest} from '@lib/update/types';

export interface TriggerOptions {
  version?: string;
  changelog?: string;
  verdict?: 'verified' | 'verified-partial' | 'conflict';
  swUrl?: string;
}

export async function install(): Promise<void> {
  // Ensure the popup controller's listeners are registered — otherwise the
  // dispatched events go nowhere.
  await import('@lib/update/update-popup-controller');

  (window as any).__triggerUpdatePopup = (opts: TriggerOptions = {}) => {
    const verdict = opts.verdict ?? 'verified';
    const version = opts.version ?? '99.0.0';
    const swUrl = opts.swUrl ?? '/sw.js';
    const manifest: Manifest = {
      schemaVersion: 1,
      version,
      gitSha: 'devdev0',
      published: new Date().toISOString(),
      swUrl,
      bundleHashes: {},
      changelog: opts.changelog ?? '## What\'s new\n- Dev trigger\n- Second item'
    };
    const integrity: IntegrityResult = {
      verdict,
      checkedAt: Date.now(),
      sources: [
        {name: 'cdn', status: 'ok', version, swUrl},
        {name: 'ipfs', status: 'ok', version, swUrl},
        {name: 'github', status: 'ok', version, swUrl}
      ],
      manifest
    };
    rootScope.dispatchEventSingle('update_integrity_check_completed', integrity);
    rootScope.dispatchEventSingle('update_available', manifest);
    return {manifest, integrity};
  };

  console.info('[DEV] update popup trigger ready — call __triggerUpdatePopup() from the console');
}
