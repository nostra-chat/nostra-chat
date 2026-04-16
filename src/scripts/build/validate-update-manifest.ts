#!/usr/bin/env tsx
/**
 * Validates a generated update-manifest.json. Used in CI to fail-fast
 * on malformed manifests before publish.
 */

import {readFileSync, readdirSync, statSync} from 'fs';
import {join, relative} from 'path';

const PKG = JSON.parse(readFileSync('package.json', 'utf8'));

function die(msg: string): never {
  console.error(`validate-update-manifest: ${msg}`);
  process.exit(1);
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for(const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if(statSync(full).isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

const manifestPath = process.argv[2];
if(!manifestPath) die('usage: validate-update-manifest.ts <path-to-manifest.json>');

const m = JSON.parse(readFileSync(manifestPath, 'utf8'));

for(const k of ['schemaVersion', 'version', 'gitSha', 'published', 'swUrl', 'bundleHashes', 'changelog']) {
  if(!(k in m)) die(`missing required field: ${k}`);
}

if(m.schemaVersion !== 1) die(`unexpected schemaVersion: ${m.schemaVersion}`);
if(m.version !== PKG.version) die(`version mismatch: manifest=${m.version} package.json=${PKG.version}`);
if(process.env.GITHUB_SHA && m.gitSha !== process.env.GITHUB_SHA) {
  die(`gitSha mismatch: manifest=${m.gitSha} GITHUB_SHA=${process.env.GITHUB_SHA}`);
}

if(!m.bundleHashes[m.swUrl]) die(`swUrl ${m.swUrl} not found in bundleHashes`);

const distDir = 'dist';
const files = walkFiles(distDir);
const covered = new Set(Object.keys(m.bundleHashes));
const EXCLUDED = [/\.map$/, /update-manifest\.json$/];

const missing: string[] = [];
for(const f of files) {
  if(EXCLUDED.some(p => p.test(f))) continue;
  const rel = './' + relative(distDir, f).replace(/\\/g, '/');
  if(!covered.has(rel)) missing.push(rel);
}

if(missing.length > 0) {
  die(`files in dist/ not covered by bundleHashes:\n${missing.map(f => '  - ' + f).join('\n')}`);
}

for(const [k, v] of Object.entries(m.bundleHashes as Record<string, string>)) {
  if(!/^sha256-[a-f0-9]{64}$/.test(v)) die(`invalid hash format for ${k}: ${v}`);
}

if(!m.changelog || m.changelog.trim().length === 0) {
  console.warn(`validate-update-manifest: WARNING changelog is empty for v${m.version}`);
}

console.log(`validate-update-manifest: OK (v${m.version}, ${Object.keys(m.bundleHashes).length} files covered)`);
