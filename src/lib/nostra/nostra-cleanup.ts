/**
 * Centralized cleanup of all Nostra data.
 * Runs in the main thread where DB connections are held.
 *
 * Two modes:
 *   clearAllNostraData()  — full wipe (logout)
 *   clearAllExceptSeed()  — wipe everything EXCEPT the encrypted identity
 *                           (`Nostra.chat` IndexedDB + `nostra_identity` LS key)
 */

import {clearPeerProfileCache} from './peer-profile-cache';

// All Nostra IndexedDB database names
const NOSTRA_DB_NAMES = [
  'nostra-messages',
  'nostra-message-requests',
  'nostra-virtual-peers',
  'nostra-groups',
  'NostraPool',
  'Nostra.chat'
];

// All Nostra localStorage keys
const NOSTRA_LS_KEYS = [
  'nostra_identity',
  'nostra-relay-config',
  'nostra-last-seen-timestamp',
  'nostra:read-receipts-enabled',
  'nostra-folders-last-published',
  'nostra-folders-last-modified',
  'nostra-profile-cache'
];

// The seed lives here — kept by `clearAllExceptSeed()`
const SEED_DB_NAME = 'Nostra.chat';
const SEED_LS_KEY = 'nostra_identity';

/**
 * Force-close all open connections to a database by triggering a version upgrade.
 * When we open with a higher version, the browser sends `versionchange` to all
 * existing connections. We hook `onversionchange` on our own connection to close it,
 * and other well-behaved connections will close too. Connections that don't handle
 * `versionchange` will be force-closed by the browser when we abort the upgrade.
 */
function forceCloseDB(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name, 999999);
      req.onupgradeneeded = () => {
        req.transaction.abort();
      };
      req.onsuccess = () => {
        try { req.result.close(); } catch{}
        resolve();
      };
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch{
      resolve();
    }
  });
}

function deleteDB(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch{
      resolve(false);
    }
  });
}

async function clearNostraData(opts: {keepSeed: boolean}): Promise<string[]> {
  const dbNames = opts.keepSeed ?
    NOSTRA_DB_NAMES.filter((n) => n !== SEED_DB_NAME) :
    NOSTRA_DB_NAMES;
  const lsKeys = opts.keepSeed ?
    NOSTRA_LS_KEYS.filter((k) => k !== SEED_LS_KEY) :
    NOSTRA_LS_KEYS;

  // 1. Close open DB connections held by singletons (none of these touch Nostra.chat)
  const closes: Promise<void>[] = [];
  try {
    const {getMessageStore} = await import('./message-store');
    closes.push(getMessageStore().destroy());
  } catch{}
  try {
    const {getMessageRequestStore} = await import('./message-requests');
    closes.push(getMessageRequestStore().destroy());
  } catch{}
  try {
    const {getVirtualPeersDB} = await import('./virtual-peers-db');
    closes.push(getVirtualPeersDB().destroy());
  } catch{}
  try {
    const {getGroupStore} = await import('./group-store');
    closes.push(getGroupStore().destroy());
  } catch{}
  await Promise.allSettled(closes);

  // 2. Force-close any remaining connections
  await Promise.allSettled(dbNames.map((name) => forceCloseDB(name)));

  // 3. Delete databases
  const results = await Promise.all(
    dbNames.map(async(name) => ({name, ok: await deleteDB(name)}))
  );
  const failed = results.filter((r) => !r.ok).map((r) => r.name);

  // 4. Clear localStorage keys
  for(const key of lsKeys) {
    try {
      localStorage.removeItem(key);
    } catch{}
  }
  clearPeerProfileCache();

  return failed;
}

/**
 * Close all open Nostra DB connections, delete all databases, clear localStorage.
 * Returns list of database names that failed to delete.
 */
export function clearAllNostraData(): Promise<string[]> {
  return clearNostraData({keepSeed: false});
}

/**
 * Same as `clearAllNostraData()` but preserves the encrypted identity:
 * keeps the `Nostra.chat` IndexedDB database and the `nostra_identity`
 * localStorage key. Used by the "Reset Local Data" flow so the user can
 * re-enter the app with the same seed.
 */
export function clearAllExceptSeed(): Promise<string[]> {
  return clearNostraData({keepSeed: true});
}
