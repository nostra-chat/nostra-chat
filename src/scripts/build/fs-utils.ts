/**
 * Shared filesystem utilities for Phase A build scripts.
 */

import {readdirSync, statSync} from 'fs';
import {join} from 'path';

export function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for(const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if(statSync(full).isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

export const DIST_EXCLUDE_PATTERNS: RegExp[] = [
  /\.map$/,
  /update-manifest\.json$/,
  // Changelog markdown files contain URL-reserved chars (e.g. `#` in category
  // filenames) that break client-side fetch + hash verify. They're not part of
  // the app shell — release notes are embedded in the manifest's `changelog`
  // field instead, so excluding the raw files from bundleHashes is safe.
  /\/changelogs\/.+\.md$/,
  // Cloudflare Pages config files live in `public/` and get copied to `dist/`
  // by Vite, but Cloudflare's build pipeline consumes them at deploy time and
  // never serves them to clients (always 404). Shipping them in bundleHashes
  // made the 0.16.0 fail-fast precache install throw on every fresh install —
  // boot hung on `navigator.serviceWorker.ready` → 120s splash safety timer →
  // white screen. Anchored on `/_(headers|redirects)$` so chunks like
  // `_commonjsHelpers-*.js` are not affected.
  /\/_headers$/,
  /\/_redirects$/
];
