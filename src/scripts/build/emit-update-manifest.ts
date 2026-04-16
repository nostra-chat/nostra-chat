#!/usr/bin/env tsx
/**
 * Emits dist/update-manifest.json for Phase A controlled updates.
 * Input: dist/ directory (post-build), CHANGELOG.md, package.json
 * Output: dist/update-manifest.json
 */

import {readFileSync, writeFileSync} from 'fs';
import {createHash} from 'crypto';
import {join, relative} from 'path';
import {execSync} from 'child_process';
import {walkFiles, DIST_EXCLUDE_PATTERNS} from './fs-utils';

const DIST_DIR = 'dist';
const PKG = JSON.parse(readFileSync('package.json', 'utf8'));
const VERSION: string = PKG.version;
const GIT_SHA: string = process.env.GITHUB_SHA || execSync('git rev-parse HEAD').toString().trim();

function sha256File(path: string): string {
  const h = createHash('sha256');
  // Buffer is runtime-compatible with Uint8Array but TS typings disagree without @types/node.
  h.update(readFileSync(path) as unknown as Uint8Array);
  return 'sha256-' + h.digest('hex');
}

function extractChangelog(version: string): string {
  const raw = readFileSync('CHANGELOG.md', 'utf8');
  const regex = new RegExp(`##\\s*\\[${version.replace(/\./g, '\\.')}\\][\\s\\S]*?(?=\\n##\\s*\\[|$)`);
  const match = raw.match(regex);
  if(!match) return '';
  return match[0].replace(/^##\s*\[[^\]]+\][^\n]*\n+/, '').trim();
}

function main() {
  const files = walkFiles(DIST_DIR);
  const bundleHashes: Record<string, string> = {};
  const swCandidates: string[] = [];

  for(const f of files) {
    if(DIST_EXCLUDE_PATTERNS.some(p => p.test(f))) continue;
    const rel = './' + relative(DIST_DIR, f).replace(/\\/g, '/');
    bundleHashes[rel] = sha256File(f);
    if(/^\.\/sw-[a-zA-Z0-9_-]+\.js$/.test(rel)) {
      swCandidates.push(rel);
    }
  }

  if(swCandidates.length === 0) {
    throw new Error('SW file not found in dist/ (expected ./sw-<hash>.js)');
  }
  if(swCandidates.length > 1) {
    throw new Error(`Multiple SW candidates found in dist/: ${swCandidates.join(', ')} — only one expected`);
  }
  const swUrl = swCandidates[0];

  const manifest = {
    schemaVersion: 1,
    version: VERSION,
    gitSha: GIT_SHA,
    published: new Date().toISOString(),
    swUrl,
    bundleHashes,
    changelog: extractChangelog(VERSION),
    alternateSources: {}
  };

  const outPath = join(DIST_DIR, 'update-manifest.json');
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`Emitted ${outPath} for v${VERSION} (${Object.keys(bundleHashes).length} files, swUrl=${swUrl})`);
}

main();
