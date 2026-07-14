import {validateUpdateManifest} from '@lib/update/manifest-validation';
import {verifyDetachedSignature} from '@lib/update/signing/verify';
import type {Manifest} from './signed-update-sw';
import {activeShellCacheName, getActiveVersion} from './shell-cache';
import {manifestAssetUrl, runBoundedWorkers, sha256Hex, SIGNED_UPDATE_CONCURRENCY} from './update-asset-utils';

/**
 * Revalidate a shell prepared by the previously trusted Service Worker.
 *
 * Returning false means this is a first/legacy install and the normal TOFU
 * precache path must run. Once an approval record exists, every inconsistency
 * fails closed instead of falling back to unverified network downloads.
 */
export async function reuseApprovedShellForInstall(currentScriptUrl: string): Promise<boolean> {
  const active = await getActiveVersion();
  if(!active?.approval) return false;

  const {manifestText, signature, approvedByPubkey, manifestDigest} = active.approval;
  const manifestBytes = new TextEncoder().encode(manifestText);
  if(await sha256Hex(manifestBytes) !== manifestDigest) {
    throw new Error('approved shell manifest digest mismatch');
  }
  if(!(await verifyDetachedSignature(manifestBytes, signature, approvedByPubkey))) {
    throw new Error('approved shell manifest signature mismatch');
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch(err) {
    throw new Error(`approved shell manifest JSON is invalid: ${String(err)}`);
  }
  const validation = validateUpdateManifest(manifest);
  if(!validation.ok || manifest.schemaVersion !== 2) {
    throw new Error(`approved shell manifest is invalid: ${validation.reason || 'unsupported schema'}`);
  }
  if(manifest.version !== active.version) throw new Error('approved shell version mismatch');

  const scopeUrl = (self as any as ServiceWorkerGlobalScope).registration?.scope || currentScriptUrl;
  const expectedScriptUrl = manifestAssetUrl(manifest.swUrl, scopeUrl);
  if(new URL(expectedScriptUrl).href !== new URL(currentScriptUrl).href) {
    throw new Error(`approved shell worker mismatch: expected ${expectedScriptUrl}, got ${currentScriptUrl}`);
  }

  const cacheName = activeShellCacheName(active);
  if(!(await caches.has(cacheName))) throw new Error(`approved shell cache missing: ${cacheName}`);
  const cache = await caches.open(cacheName);
  const entries = Object.entries(manifest.bundleHashes);
  let failure: Error | null = null;

  await runBoundedWorkers(entries.length, SIGNED_UPDATE_CONCURRENCY, async(index) => {
    if(failure) return;
    const [path, expectedHash] = entries[index];
    const url = manifestAssetUrl(path, scopeUrl);
    try {
      const response = await cache.match(url);
      if(!response) throw new Error(`approved shell chunk missing: ${path}`);
      const bytes = await response.arrayBuffer();
      const actual = await sha256Hex(bytes);
      if(actual !== expectedHash) throw new Error(`approved shell chunk mismatch: ${path}`);
    } catch(err) {
      if(!failure) failure = err instanceof Error ? err : new Error(String(err));
    }
  }, () => !!failure);

  if(failure) throw failure;
  return true;
}
