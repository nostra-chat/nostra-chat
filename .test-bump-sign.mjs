#!/usr/bin/env node
// Bump manifest version + resign, to simulate "update available" scenario for probe.
import {readFileSync, writeFileSync} from 'fs';
import * as ed from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';

ed.hashes.sha512 = sha512;

const manifest = JSON.parse(readFileSync('dist/update-manifest.json', 'utf8'));
manifest.version = '0.99.0';
manifest.published = new Date().toISOString();

const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
writeFileSync('dist/update-manifest.json', manifestBytes);

const priv = Uint8Array.from(Buffer.from(readFileSync('/tmp/test-priv.b64', 'utf8').trim(), 'base64'));
const sig = await ed.signAsync(manifestBytes, priv);
writeFileSync('dist/update-manifest.json.sig', Buffer.from(sig).toString('base64'));
console.log('Bumped to 0.99.0 + signed. Manifest bytes:', manifestBytes.length);
