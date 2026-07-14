import {verifyDetachedSignature} from '@lib/update/signing/verify';
import {verifyCrossCert} from '@lib/update/signing/trusted-keys';
import {activeShellCacheName, commitPreparedShell, getActiveVersion, preparedCacheName} from './shell-cache';
import {validateManifestFreshness, validateUpdateManifest} from '@lib/update/manifest-validation';
import {
  createProgressReporter,
  manifestAssetUrl,
  responseFromVerifiedBytes,
  runBoundedWorkers,
  sha256Hex,
  SIGNED_UPDATE_CONCURRENCY
} from './update-asset-utils';

export interface Manifest {
  schemaVersion: number;
  version: string;
  gitSha: string;
  published: string;
  swUrl: string;
  signingKeyFingerprint: string;
  securityRelease: boolean;
  securityRollback: boolean;
  bundleHashes: Record<string, string>;
  rotation: null | {newPubkey: string; newFingerprint: string; crossCertSig: string};
}

export type ApprovedOutcome =
  | 'applied'
  | 'invalid-signature'
  | 'invalid-manifest'
  | 'stale-manifest'
  | 'downgrade-rejected'
  | 'rotation-cross-cert-invalid'
  | 'chunk-mismatch'
  | 'network-error'
  | 'quota-exceeded'
  | 'swap-failed';

export interface ApprovedResult {
  outcome: ApprovedOutcome;
  reason?: string;
  chunk?: string;
  expected?: string;
  actual?: string;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[+-]/, 1)[0].split('.').map(Number);
  const pb = b.split(/[+-]/, 1)[0].split('.').map(Number);
  for(let i = 0; i < 3; i++) {
    if(pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export async function handleUpdateApproved(
  manifest: Manifest,
  signatureB64: string,
  trustedPubkeyB64: string,
  onProgress?: (done: number, total: number) => void,
  manifestText?: string,
  options: {signal?: AbortSignal} = {}
): Promise<ApprovedResult> {
  // Verify signature over the ORIGINAL bytes fetched from the server, not over
  // a re-serialized object (JSON.stringify key order differs from server output).
  const exactManifestText = manifestText ?? JSON.stringify(manifest);
  const manifestBytes = new TextEncoder().encode(exactManifestText);
  const sigOk = await verifyDetachedSignature(manifestBytes, signatureB64, trustedPubkeyB64);
  if(!sigOk) return {outcome: 'invalid-signature'};

  let approvedManifest: Manifest;
  try {
    approvedManifest = JSON.parse(exactManifestText) as Manifest;
  } catch(err) {
    return {outcome: 'invalid-manifest', reason: `signed manifest JSON is invalid: ${String(err)}`};
  }

  const validation = validateUpdateManifest(approvedManifest);
  if(!validation.ok) return {outcome: 'invalid-manifest', reason: validation.reason};
  if(approvedManifest.schemaVersion !== 2) return {outcome: 'invalid-manifest', reason: 'signed updates require schemaVersion 2'};
  const freshness = validateManifestFreshness(approvedManifest.published);
  if(!freshness.ok) return {outcome: 'stale-manifest', reason: freshness.reason};

  if(approvedManifest.rotation) {
    const crossOk = await verifyCrossCert(approvedManifest.rotation, trustedPubkeyB64);
    if(!crossOk) return {outcome: 'rotation-cross-cert-invalid'};
  }

  const active = await getActiveVersion();
  const versionComparison = active ? compareVersions(approvedManifest.version, active.version) : 1;
  if(active && versionComparison === 0) {
    return {outcome: 'downgrade-rejected', reason: `${approvedManifest.version} is already active`};
  }
  if(active && versionComparison < 0 && !approvedManifest.securityRollback) {
    return {outcome: 'downgrade-rejected', reason: `${approvedManifest.version} < ${active.version}`};
  }

  const manifestDigest = await sha256Hex(manifestBytes);
  const targetName = preparedCacheName(approvedManifest.version, manifestDigest);
  const abortController = new AbortController();
  const abortFromCaller = () => abortController.abort(options.signal?.reason);
  if(options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, {once: true});

  let target: Cache;
  try {
    await caches.delete(targetName);
    target = await caches.open(targetName);
  } catch(e) {
    options.signal?.removeEventListener('abort', abortFromCaller);
    return {outcome: 'quota-exceeded', reason: String(e)};
  }

  let activeCache: Cache | null = null;
  if(active) {
    try {
      activeCache = await caches.open(activeShellCacheName(active));
    } catch{
      // Reuse is an optimization only. A missing/corrupt active cache must not
      // weaken verification; fall back to downloading and hashing every entry.
    }
  }
  const entries = Object.entries(approvedManifest.bundleHashes);
  const baseUrl = (self as any as ServiceWorkerGlobalScope).registration?.scope || self.location.href;
  const reporter = createProgressReporter(onProgress);
  let done = 0;
  let failure: ApprovedResult | null = null;

  const fail = (result: ApprovedResult) => {
    if(failure) return;
    failure = result;
    abortController.abort(result.reason || result.outcome);
  };

  await runBoundedWorkers(entries.length, SIGNED_UPDATE_CONCURRENCY, async(index) => {
    if(failure || abortController.signal.aborted) return;
    const [path, expectedHash] = entries[index];
    const url = manifestAssetUrl(path, baseUrl);
    try {
      let verifiedResponse: Response | null = null;
      if(activeCache) {
        try {
          const cached = await activeCache.match(url);
          if(cached) {
            const cachedBytes = await cached.arrayBuffer();
            if(await sha256Hex(cachedBytes) === expectedHash) {
              verifiedResponse = responseFromVerifiedBytes(cachedBytes, cached);
            }
          }
        } catch{}
      }

      if(!verifiedResponse) {
        const res = await fetch(url, {cache: 'no-cache', signal: abortController.signal});
        if(!res.ok) {
          fail({outcome: 'network-error', chunk: path, reason: `HTTP ${res.status}`});
          return;
        }
        const bytes = await res.arrayBuffer();
        const actual = await sha256Hex(bytes);
        if(actual !== expectedHash) {
          console.error('[update-sw] chunk-mismatch', {chunk: path, expected: expectedHash, actual, size: bytes.byteLength, fetched: done, total: entries.length});
          fail({outcome: 'chunk-mismatch', chunk: path, expected: expectedHash, actual});
          return;
        }
        verifiedResponse = responseFromVerifiedBytes(bytes, res);
      }

      if(failure || abortController.signal.aborted) return;
      await target.put(url, verifiedResponse);
      done++;
      reporter.report(done, entries.length);
    } catch(e) {
      if(failure) return;
      const isQuota = e instanceof DOMException && e.name === 'QuotaExceededError';
      const result: ApprovedResult = isQuota ?
        {outcome: 'quota-exceeded', chunk: path, reason: String(e)} :
        {outcome: 'network-error', chunk: path, reason: String(e)};
      console.error('[update-sw] network-error', {chunk: path, error: String(e), fetched: done, total: entries.length});
      fail(result);
    }
  }, () => !!failure || abortController.signal.aborted);

  options.signal?.removeEventListener('abort', abortFromCaller);
  if(!failure && abortController.signal.aborted) {
    failure = {outcome: 'network-error', reason: 'update cancelled'};
  }
  if(failure) {
    reporter.cancel();
    await caches.delete(targetName);
    return failure;
  }

  const newFingerprint = approvedManifest.rotation?.newFingerprint || approvedManifest.signingKeyFingerprint;
  const newInstalledPubkey = approvedManifest.rotation?.newPubkey || active?.installedPubkey;
  try {
    await commitPreparedShell(
      approvedManifest.version,
      newFingerprint,
      newInstalledPubkey,
      targetName,
      {manifestText: exactManifestText, signature: signatureB64, approvedByPubkey: trustedPubkeyB64, manifestDigest}
    );
  } catch(e) {
    reporter.cancel();
    await caches.delete(targetName);
    return {outcome: 'swap-failed', reason: String(e)};
  }
  reporter.finish(done, entries.length);
  return {outcome: 'applied'};
}
