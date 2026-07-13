import type {Manifest} from '@lib/update/types';
import {UpdateFlowError} from '@lib/update/types';
import {updateTransport} from '@lib/update/update-transport';
import {PromisePool} from '@lib/update/promise-pool';
import {setFlowState} from '@lib/update/update-state-machine';
import {isSafeManifestPath, validateUpdateManifest} from './manifest-validation';

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return 'sha256-' + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function downloadAndVerify(
  manifest: Manifest,
  opts: {signal?: AbortSignal; onProgress?: (done: number, total: number) => void} = {}
): Promise<Map<string, ArrayBuffer>> {
  const files = new Map<string, ArrayBuffer>();
  const entries = Object.entries(manifest.bundleHashes);
  for(const [path] of entries) {
    if(!isSafeManifestPath(path)) {
      throw new UpdateFlowError({type: 'network-error', err: `unsafe manifest path: ${path}`});
    }
  }
  const pool = new PromisePool(6);
  let completed = 0;

  await Promise.all(entries.map(([path, expectedHash]) => pool.run(async() => {
    const url = new URL(path, location.origin).href;
    const res = await updateTransport.fetch(url, {cache: 'no-store', signal: opts.signal});
    if(!res.ok) {
      throw new UpdateFlowError({type: 'network-error', err: `HTTP ${res.status} for ${path}`});
    }
    const buf = await res.arrayBuffer();
    const actualHash = await sha256Hex(buf);
    if(actualHash !== expectedHash) {
      throw new UpdateFlowError({type: 'hash-mismatch', path, expected: expectedHash, actual: actualHash});
    }
    files.set(path, buf);
    completed++;
    opts.onProgress?.(completed, entries.length);
  })));

  return files;
}

async function registerNewSw(manifest: Manifest): Promise<ServiceWorkerRegistration> {
  localStorage.setItem('nostra.update.pendingFinalization', '1');
  localStorage.setItem('nostra.update.pendingManifest', JSON.stringify(manifest));

  const swUrl = new URL(manifest.swUrl, location.origin).href;
  setFlowState({kind: 'registering', target: manifest});

  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(swUrl, {
      type: 'module',
      scope: './',
      updateViaCache: 'all'
    });
  } catch(err) {
    localStorage.removeItem('nostra.update.pendingFinalization');
    localStorage.removeItem('nostra.update.pendingManifest');
    throw new UpdateFlowError({type: 'register-failed', err: String(err)});
  }

  const newSw = reg.installing || reg.waiting || reg.active;
  if(!newSw) throw new UpdateFlowError({type: 'register-failed', err: 'no worker after register'});

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpdateFlowError({type: 'install-timeout'})), 60000);
    const check = () => {
      if(newSw.state === 'installed') { clearTimeout(timer); resolve(); return; }
      if(newSw.state === 'redundant') { clearTimeout(timer); reject(new UpdateFlowError({type: 'install-redundant'})); return; }
    };
    check();
    newSw.addEventListener('statechange', check);
  });

  return reg;
}

async function activateAndReload(manifest: Manifest): Promise<void> {
  setFlowState({kind: 'finalizing', target: manifest});

  const reg = await navigator.serviceWorker.getRegistration();
  const waiting = reg?.waiting;
  if(!waiting) {
    window.location.reload();
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  }, {once: true});

  waiting.postMessage({type: 'SKIP_WAITING'});

  setTimeout(() => window.location.reload(), 10000);
}

export async function startUpdate(manifest: Manifest, abortController?: AbortController): Promise<void> {
  try {
    setFlowState({
      kind: 'downloading',
      target: manifest,
      completed: 0,
      total: Object.keys(manifest.bundleHashes).length
    });

    await downloadAndVerify(manifest, {
      signal: abortController?.signal,
      onProgress: (done, total) => {
        setFlowState({kind: 'downloading', target: manifest, completed: done, total});
      }
    });

    setFlowState({kind: 'verifying', target: manifest});

    await registerNewSw(manifest);
    await activateAndReload(manifest);
  } catch(err) {
    if(err instanceof UpdateFlowError) {
      setFlowState({kind: 'failed', reason: err.reason, target: manifest});
    } else {
      setFlowState({kind: 'failed', reason: {type: 'network-error', err: String(err)}, target: manifest});
    }
    throw err;
  }
}

export interface SignedUpdateResult {
  ok: boolean;
  outcome?: string;
  reason?: string;
  chunk?: string;
  expected?: string;
  actual?: string;
}

export interface SignedUpdateOptions {
  onProgress?: (done: number, total: number) => void;
}

async function promoteApprovedServiceWorker(manifest: Manifest): Promise<void> {
  localStorage.setItem('nostra.update.pendingFinalization', '1');
  localStorage.setItem('nostra.update.pendingManifest', JSON.stringify(manifest));
  try {
    const swUrl = new URL(manifest.swUrl, location.origin).href;
    const registration = await navigator.serviceWorker.register(swUrl, {
      type: 'module',
      scope: './',
      updateViaCache: 'none'
    });
    const worker = registration.installing || registration.waiting || registration.active;
    if(!worker) throw new Error('no service worker after approved registration');
    if(worker.state !== 'installed' && worker.state !== 'activated') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('approved service worker install timed out')), 60_000);
        const check = () => {
          if(worker.state === 'installed' || worker.state === 'activated') {
            clearTimeout(timer);
            resolve();
          } else if(worker.state === 'redundant') {
            clearTimeout(timer);
            reject(new Error('approved service worker became redundant'));
          }
        };
        worker.addEventListener('statechange', check);
        check();
      });
    }
    const waiting = registration.waiting;
    if(waiting) waiting.postMessage({type: 'SKIP_WAITING'});
  } catch(err) {
    localStorage.removeItem('nostra.update.pendingFinalization');
    localStorage.removeItem('nostra.update.pendingManifest');
    throw err;
  }
}

async function startUpdateSignedUnlocked(
  manifest: any,
  signature: string,
  manifestText?: string,
  opts: SignedUpdateOptions = {}
): Promise<SignedUpdateResult> {
  const validation = validateUpdateManifest(manifest);
  if(!validation.ok || manifest.schemaVersion !== 2) {
    return {ok: false, outcome: 'invalid-manifest', reason: validation.reason || 'signed updates require schemaVersion 2'};
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if(!reg || !reg.active) return {ok: false, outcome: 'no-active-sw', reason: 'no-active-sw'};

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve({ok: false, outcome: 'update-timeout', reason: 'service worker did not finish within 120 seconds'});
    }, 120_000);
    channel.port1.onmessage = async(ev) => {
      if(ev.data?.type === 'UPDATE_PROGRESS') {
        opts.onProgress?.(ev.data.done, ev.data.total);
        return;
      }
      if(ev.data?.type === 'UPDATE_RESULT') {
        clearTimeout(timer);
        channel.port1.close();
        const d = ev.data;
        if(d.outcome === 'applied') {
          try {
            await promoteApprovedServiceWorker(manifest);
          } catch(err) {
            resolve({ok: false, outcome: 'register-failed', reason: String(err)});
            return;
          }
        }
        resolve({
          ok: d.outcome === 'applied',
          outcome: d.outcome,
          reason: d.reason,
          chunk: d.chunk,
          expected: d.expected,
          actual: d.actual
        });
      }
    };
    reg.active!.postMessage({type: 'UPDATE_APPROVED', manifest, signature, manifestText}, [channel.port2]);
  });
}

export async function startUpdateSigned(
  manifest: any,
  signature: string,
  manifestText?: string,
  opts: SignedUpdateOptions = {}
): Promise<SignedUpdateResult> {
  const lockManager = (navigator as Navigator & {locks?: {
    request<T>(name: string, options: {ifAvailable: boolean; mode: 'exclusive'}, callback: (lock: unknown | null) => Promise<T>): Promise<T>;
  }}).locks;
  if(!lockManager) return startUpdateSignedUnlocked(manifest, signature, manifestText, opts);
  return lockManager.request('nostra-pwa-update', {ifAvailable: true, mode: 'exclusive'}, async(lock) => {
    if(!lock) return {ok: false, outcome: 'update-in-progress', reason: 'another tab is applying this update'};
    return startUpdateSignedUnlocked(manifest, signature, manifestText, opts);
  });
}
