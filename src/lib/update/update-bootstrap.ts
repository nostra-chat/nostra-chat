import {BootGate, CompromiseAlertError} from '@lib/update/types';
import {BUILD_VERSION} from '@lib/update/build-version';

const LS = {
  installedVersion: 'nostra.update.installedVersion',
  installedSwUrl: 'nostra.update.installedSwUrl',
  lastAcceptedVersion: 'nostra.update.lastAcceptedVersion',
  lastIntegrityCheck: 'nostra.update.lastIntegrityCheck',
  lastIntegrityResult: 'nostra.update.lastIntegrityResult',
  lastIntegrityDetails: 'nostra.update.lastIntegrityDetails',
  pendingFinalization: 'nostra.update.pendingFinalization',
  pendingManifest: 'nostra.update.pendingManifest'
};

let _bootGate: BootGate = BootGate.LocalChecksOnly;
let _networkCheckInFlight = false;

export interface BootstrapOptions {
  skipNetworkChecks?: boolean;
  skipManifestCheck?: boolean;
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = isNaN(pa[i]) ? 0 : (pa[i] ?? 0);
    const y = isNaN(pb[i]) ? 0 : (pb[i] ?? 0);
    if(x > y) return true;
    if(x < y) return false;
  }
  return false;
}

export async function updateBootstrap(opts: BootstrapOptions = {}): Promise<void> {
  const reg = await navigator.serviceWorker.ready;

  // Phase 6 post-reload finalization (runs BEFORE Step 0 so pendingFinalization branch is handled on its own terms)
  const pendingFinalization = localStorage.getItem(LS.pendingFinalization) === '1';
  if(pendingFinalization) {
    const pendingManifestRaw = localStorage.getItem(LS.pendingManifest);
    if(pendingManifestRaw) {
      try {
        const pendingManifest = JSON.parse(pendingManifestRaw);
        const expectedSwUrl = new URL(pendingManifest.swUrl, location.origin).href;
        if(reg.active?.scriptURL === expectedSwUrl) {
          localStorage.setItem(LS.installedVersion, pendingManifest.version);
          localStorage.setItem(LS.installedSwUrl, expectedSwUrl);
          localStorage.setItem(LS.lastAcceptedVersion, pendingManifest.version);
          const rs = (await import('@lib/rootScope')).default;
          rs.dispatchEventSingle('update_completed', pendingManifest.version);
        }
      } catch{}
    }
    localStorage.removeItem(LS.pendingFinalization);
    localStorage.removeItem(LS.pendingManifest);
    _bootGate = BootGate.AllVerified;
    return;
  }

  const installedVersion = localStorage.getItem(LS.installedVersion);

  // Step 0: first install
  if(!installedVersion) {
    localStorage.setItem(LS.installedVersion, BUILD_VERSION);
    localStorage.setItem(LS.installedSwUrl, reg.active!.scriptURL);
    localStorage.setItem(LS.lastAcceptedVersion, BUILD_VERSION);
    _bootGate = BootGate.AllVerified;
    return;
  }

  // Step 1a: local URL consistency
  const expectedUrl = localStorage.getItem(LS.installedSwUrl)!;
  if(reg.active!.scriptURL !== expectedUrl) {
    throw new CompromiseAlertError({type: 'sw-url-changed', expected: expectedUrl, got: reg.active!.scriptURL});
  }

  _bootGate = BootGate.LocalChecksOnly;

  if(opts.skipNetworkChecks) {
    _bootGate = BootGate.AllVerified;
    return;
  }

  // Step 1b: registration.update() byte comparison
  const waitingBefore = reg.waiting;
  try {
    await reg.update();
  } catch{
    _bootGate = BootGate.AllVerified;
    return;
  }
  const waitingAfter = reg.waiting;
  if(waitingAfter && waitingAfter !== waitingBefore) {
    throw new CompromiseAlertError({
      type: 'sw-body-changed-at-same-url',
      url: reg.active?.scriptURL,
      waitingUrl: waitingAfter.scriptURL
    });
  }

  if(opts.skipManifestCheck) {
    _bootGate = BootGate.AllVerified;
    return;
  }

  // Step 2: manifest cross-source verification
  const {verifyManifestsAcrossSources} = await import('@lib/update/manifest-verifier');
  const result = await verifyManifestsAcrossSources();

  localStorage.setItem(LS.lastIntegrityCheck, String(result.checkedAt));
  localStorage.setItem(LS.lastIntegrityResult, result.verdict);
  localStorage.setItem(LS.lastIntegrityDetails, JSON.stringify(result.sources));

  _bootGate = BootGate.AllVerified;

  const rs = (await import('@lib/rootScope')).default;
  rs.dispatchEventSingle('update_integrity_check_completed', result);

  if(result.manifest && (result.verdict === 'verified' || result.verdict === 'verified-partial')) {
    if(semverGt(result.manifest.version, installedVersion)) {
      rs.dispatchEventSingle('update_available', result.manifest);
    }
  }
}

export async function runNetworkChecks(opts: {force?: boolean} = {}): Promise<void> {
  if(_networkCheckInFlight) return;
  if(!opts.force && _bootGate === BootGate.AllVerified) {
    // Allow forced re-run from the Settings panel even when already verified
  }

  _networkCheckInFlight = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const waitingBefore = reg.waiting;
    try { await reg.update(); } catch{}
    const waitingAfter = reg.waiting;
    const expectingUpdate = localStorage.getItem(LS.pendingFinalization) === '1';
    if(waitingAfter && waitingAfter !== waitingBefore && !expectingUpdate) {
      throw new CompromiseAlertError({
        type: 'sw-body-changed-at-same-url',
        url: reg.active?.scriptURL,
        waitingUrl: waitingAfter.scriptURL
      });
    }

    const {verifyManifestsAcrossSources} = await import('@lib/update/manifest-verifier');
    const result = await verifyManifestsAcrossSources();

    localStorage.setItem(LS.lastIntegrityCheck, String(result.checkedAt));
    localStorage.setItem(LS.lastIntegrityResult, result.verdict);
    localStorage.setItem(LS.lastIntegrityDetails, JSON.stringify(result.sources));

    const rs = (await import('@lib/rootScope')).default;
    rs.dispatchEventSingle('update_integrity_check_completed', result);

    if(result.manifest && (result.verdict === 'verified' || result.verdict === 'verified-partial')) {
      const installedVer = localStorage.getItem(LS.installedVersion);
      if(installedVer && semverGt(result.manifest.version, installedVer)) {
        rs.dispatchEventSingle('update_available', result.manifest);
      }
    }

    _bootGate = BootGate.AllVerified;
  } finally {
    _networkCheckInFlight = false;
  }
}

export function getBootGate(): BootGate {
  return _bootGate;
}

export function assertBootGateOpen(): void {
  if(_bootGate !== BootGate.AllVerified) {
    throw new Error('updateBootstrap not complete — network-dependent operations forbidden');
  }
}

export function __resetForTest(): void {
  _bootGate = BootGate.LocalChecksOnly;
  _networkCheckInFlight = false;
}

// Retry on reconnect
if(typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    runNetworkChecks().catch(err => {
      console.warn('[UPDATE] retry on online failed:', err);
    });
  });
}
