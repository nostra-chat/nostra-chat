#!/usr/bin/env tsx
/**
 * Validates a generated update-manifest.json. Used in CI to fail-fast
 * on malformed manifests before publish.
 */

import {readFileSync} from 'fs';
import {createHash} from 'crypto';
import {join, relative} from 'path';
import {walkFiles, DIST_EXCLUDE_PATTERNS} from './fs-utils';
import {validateUpdateManifest} from '../../lib/update/manifest-validation';

const PKG = JSON.parse(readFileSync('package.json', 'utf8'));

function die(msg: string): never {
  console.error(`validate-update-manifest: ${msg}`);
  process.exit(1);
}

const manifestPath = process.argv[2];
if(!manifestPath) die('usage: validate-update-manifest.ts <path-to-manifest.json>');

const m = JSON.parse(readFileSync(manifestPath, 'utf8'));

const shape = validateUpdateManifest(m);
if(!shape.ok) die(shape.reason || 'invalid manifest');

for(const k of ['schemaVersion', 'version', 'gitSha', 'published', 'swUrl', 'bundleHashes', 'changelog']) {
  if(!(k in m)) die(`missing required field: ${k}`);
}

if(m.schemaVersion !== 1 && m.schemaVersion !== 2) {
  throw new Error(`Unsupported schemaVersion ${m.schemaVersion}`);
}
if(m.schemaVersion === 2) {
  if(typeof m.signingKeyFingerprint !== 'string' || !m.signingKeyFingerprint.startsWith('ed25519:')) {
    throw new Error('schemaVersion 2 requires signingKeyFingerprint starting with "ed25519:"');
  }
  if(typeof m.securityRelease !== 'boolean') {
    throw new Error('schemaVersion 2 requires boolean securityRelease');
  }
  if(typeof m.securityRollback !== 'boolean') {
    throw new Error('schemaVersion 2 requires boolean securityRollback');
  }
  if(m.rotation !== null && typeof m.rotation !== 'object') {
    throw new Error('rotation must be null or an object with {newPubkey, newFingerprint, crossCertSig}');
  }
}
if(m.version !== PKG.version) die(`version mismatch: manifest=${m.version} package.json=${PKG.version}`);
if(process.env.GITHUB_SHA && m.gitSha !== process.env.GITHUB_SHA) {
  die(`gitSha mismatch: manifest=${m.gitSha} GITHUB_SHA=${process.env.GITHUB_SHA}`);
}

if(!m.bundleHashes[m.swUrl]) die(`swUrl ${m.swUrl} not found in bundleHashes`);

const distDir = 'dist';
const files = walkFiles(distDir);
const covered = new Set(Object.keys(m.bundleHashes));

const missing: string[] = [];
for(const f of files) {
  if(DIST_EXCLUDE_PATTERNS.some(p => p.test(f))) continue;
  const rel = './' + relative(distDir, f).replace(/\\/g, '/');
  if(!covered.has(rel)) missing.push(rel);
}

if(missing.length > 0) {
  die(`files in dist/ not covered by bundleHashes:\n${missing.map(f => '  - ' + f).join('\n')}`);
}

for(const [k, v] of Object.entries(m.bundleHashes as Record<string, string>)) {
  if(!/^sha256-[a-f0-9]{64}$/.test(v)) die(`invalid hash format for ${k}: ${v}`);
  const filePath = join(distDir, k.slice(2));
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(filePath) as unknown as Uint8Array;
  } catch(err) {
    die(`manifest entry does not resolve to a dist file: ${k} (${String(err)})`);
  }
  const actual = 'sha256-' + createHash('sha256').update(bytes).digest('hex');
  if(actual !== v) die(`hash mismatch for ${k}: expected=${v} actual=${actual}`);
}

if(!m.changelog || m.changelog.trim().length === 0) {
  console.warn(`validate-update-manifest: WARNING changelog is empty for v${m.version}`);
}

console.log(`validate-update-manifest: OK (v${m.version}, ${Object.keys(m.bundleHashes).length} files covered)`);
