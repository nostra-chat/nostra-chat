import {verifyDetachedSignature} from '@lib/update/signing/verify';
import {verifyCrossCert} from '@lib/update/signing/trusted-keys';
import {pendingCacheName, atomicSwap, getActiveVersion} from './shell-cache';

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
  | 'rotation-cross-cert-invalid'
  | 'chunk-mismatch'
  | 'network-error'
  | 'quota-exceeded'
  | 'swap-failed';

export interface ApprovedResult {
  outcome: ApprovedOutcome;
  reason?: string;
  chunk?: string;
}

async function sha256b64(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const d = await crypto.subtle.digest('SHA-256', buf as any);
  let hex = '';
  for(const b of new Uint8Array(d)) hex += b.toString(16).padStart(2, '0');
  return 'sha256-' + hex;
}

export async function handleUpdateApproved(
  manifest: Manifest,
  signatureB64: string,
  trustedPubkeyB64: string,
  onProgress?: (done: number, total: number) => void,
  manifestText?: string
): Promise<ApprovedResult> {
  // Verify signature over the ORIGINAL bytes fetched from the server, not over
  // a re-serialized object (JSON.stringify key order differs from server output).
  const manifestBytes = new TextEncoder().encode(manifestText ?? JSON.stringify(manifest));
  const sigOk = await verifyDetachedSignature(manifestBytes, signatureB64, trustedPubkeyB64);
  if(!sigOk) return {outcome: 'invalid-signature'};

  if(manifest.rotation) {
    const crossOk = await verifyCrossCert(manifest.rotation, trustedPubkeyB64);
    if(!crossOk) return {outcome: 'rotation-cross-cert-invalid'};
  }

  const pendingName = pendingCacheName(manifest.version);
  let pending: Cache;
  try {
    pending = await caches.open(pendingName);
  } catch(e) {
    return {outcome: 'quota-exceeded', reason: String(e)};
  }

  const entries = Object.entries(manifest.bundleHashes);
  let done = 0;
  for(const [path, expectedHash] of entries) {
    try {
      // Manifest paths can contain URL-reserved characters. `#` is especially
      // problematic — fetch treats it as a fragment separator and strips it.
      // Pre-encode reserved chars before resolving against the SW location.
      const encodedPath = path.replace(/#/g, '%23').replace(/\?/g, '%3F');
      const url = new URL(encodedPath, self.location.href).href;
      const res = await fetch(url, {cache: 'no-cache'});
      if(!res.ok) {
        await caches.delete(pendingName);
        return {outcome: 'network-error', chunk: path, reason: `HTTP ${res.status}`};
      }
      const ab = await res.arrayBuffer();
      const actual = await sha256b64(ab);
      if(actual !== expectedHash) {
        await caches.delete(pendingName);
        return {outcome: 'chunk-mismatch', chunk: path};
      }
      await pending.put(path, new Response(ab));
      done++;
      onProgress?.(done, entries.length);
    } catch(e) {
      await caches.delete(pendingName);
      return {outcome: 'network-error', chunk: path, reason: String(e)};
    }
  }

  const active = await getActiveVersion();
  const newFingerprint = manifest.rotation?.newFingerprint || manifest.signingKeyFingerprint;
  const newInstalledPubkey = manifest.rotation?.newPubkey || active?.installedPubkey;
  try {
    await atomicSwap(active?.version ?? '', manifest.version, newFingerprint, newInstalledPubkey);
  } catch(e) {
    await caches.delete(pendingName);
    return {outcome: 'swap-failed', reason: String(e)};
  }
  return {outcome: 'applied'};
}
