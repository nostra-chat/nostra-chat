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
  /update-manifest\.json$/
];
