import {describe, expect, it} from 'vitest';
import {isSafeManifestPath, validateUpdateManifest} from '@lib/update/manifest-validation';

function validManifest() {
  return {
    schemaVersion: 2,
    version: '1.2.3',
    gitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    published: '2026-07-12T12:00:00.000Z',
    swUrl: './sw.js',
    bundleHashes: {'./sw.js': `sha256-${'a'.repeat(64)}`},
    changelog: ''
  };
}

describe('update manifest path validation', () => {
  it.each([
    '../escape.js',
    './a/../escape.js',
    'https://attacker.invalid/sw.js',
    '//attacker.invalid/sw.js',
    './encoded%2fescape.js',
    '.\\windows.js'
  ])('rejects unsafe path %s', (path) => {
    expect(isSafeManifestPath(path)).toBe(false);
  });

  it('accepts URL-reserved filename characters without allowing traversal', () => {
    expect(isSafeManifestPath('./assets/chunk#one?.js')).toBe(true);
  });

  it('rejects a signed worker URL that is not covered by the bundle', () => {
    const manifest = validManifest();
    manifest.swUrl = './other-sw.js';
    expect(validateUpdateManifest(manifest)).toMatchObject({ok: false, reason: 'swUrl is not covered'});
  });
});
