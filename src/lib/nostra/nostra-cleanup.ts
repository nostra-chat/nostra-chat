/**
 * Centralized cleanup of all Nostra data for logout.
 * Runs in the main thread where DB connections are held.
 */

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
  'nostra-folders-last-modified'
];

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
      // Open with a very high version to trigger versionchange on all connections
      const req = indexedDB.open(name, 999999);
      req.onupgradeneeded = () => {
        // Abort the upgrade — we don't want to modify the schema, just trigger versionchange
        req.transaction.abort();
      };
      req.onsuccess = () => {
        try { req.result.close(); } catch{}
        resolve();
      };
      req.onerror = () => resolve(); // Expected after abort
      req.onblocked = () => resolve(); // Can't force-close, move on
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

/**
 * Close all open Nostra DB connections, delete all databases, clear localStorage.
 * Returns list of database names that failed to delete.
 */
export async function clearAllNostraData(): Promise<string[]> {
  // 1. Close open DB connections held by singletons
  const closes: Promise<void>[] = [];
  try {
    const {getMessageStore} = await import('./message-store');
    const store = getMessageStore();
    closes.push(store.destroy());
  } catch{}
  try {
    const {getMessageRequestStore} = await import('./message-requests');
    const store = getMessageRequestStore();
    closes.push(store.destroy());
  } catch{}
  try {
    const {getVirtualPeersDB} = await import('./virtual-peers-db');
    const db = getVirtualPeersDB();
    closes.push(db.destroy());
  } catch{}
  try {
    const {getGroupStore} = await import('./group-store');
    const store = getGroupStore();
    closes.push(store.destroy());
  } catch{}
  await Promise.allSettled(closes);

  // 2. Force-close any remaining connections (key-storage, identity open DB on-demand)
  await Promise.allSettled(NOSTRA_DB_NAMES.map((name) => forceCloseDB(name)));

  // 3. Delete all Nostra IndexedDB databases
  const results = await Promise.all(
    NOSTRA_DB_NAMES.map(async(name) => ({name, ok: await deleteDB(name)}))
  );
  const failed = results.filter((r) => !r.ok).map((r) => r.name);

  // 4. Clear localStorage keys
  for(const key of NOSTRA_LS_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch{}
  }

  return failed;
}
