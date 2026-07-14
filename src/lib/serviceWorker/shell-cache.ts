const DB_NAME = 'nostra-update-state';
const DB_VERSION = 1;
const STORE = 'active';

export interface ApprovedShellRecord {
  manifestText: string;
  signature: string;
  approvedByPubkey: string;
  manifestDigest: string;
}

export interface ActiveVersion {
  version: string;
  keyFingerprint: string;
  installedPubkey?: string;
  cacheName?: string;
  approval?: ApprovedShellRecord;
  at: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function shellCacheName(version: string): string {
  return `shell-v${version}`;
}

export function pendingCacheName(version: string): string {
  return `shell-v${version}-pending`;
}

export function preparedCacheName(version: string, manifestDigest: string): string {
  const digest = manifestDigest.replace(/^sha256-/, '');
  return `shell-v${version}--${digest}`;
}

export function activeShellCacheName(active: ActiveVersion): string {
  return active.cacheName || shellCacheName(active.version);
}

export async function getActiveVersion(): Promise<ActiveVersion | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('current');
    req.onsuccess = () => resolve((req.result as ActiveVersion) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setActiveVersion(
  version: string,
  keyFingerprint: string,
  installedPubkey?: string,
  cacheName = shellCacheName(version),
  approval?: ApprovedShellRecord
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const rec: ActiveVersion = {version, keyFingerprint, installedPubkey, cacheName, approval, at: Date.now()};
    tx.objectStore(STORE).put(rec, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function commitPreparedShell(
  newVersion: string,
  keyFingerprint: string,
  installedPubkey: string | undefined,
  cacheName: string,
  approval: ApprovedShellRecord
): Promise<void> {
  if(!(await caches.has(cacheName))) throw new Error(`prepared cache missing: ${cacheName}`);
  const previous = await getActiveVersion();
  await setActiveVersion(newVersion, keyFingerprint, installedPubkey, cacheName, approval);
  const previousCacheName = previous ? activeShellCacheName(previous) : '';
  if(previousCacheName && previousCacheName !== cacheName) {
    try { await caches.delete(previousCacheName); } catch{}
  }
}

export async function gcOrphans(): Promise<void> {
  const active = await getActiveVersion();
  if(!active) return;
  const names = await caches.keys();
  for(const n of names) {
    if(!n.startsWith('shell-v')) continue;
    if(n === activeShellCacheName(active)) continue;
    await caches.delete(n);
  }
}
