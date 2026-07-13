import {describe, expect, it} from 'vitest';
import {classifyIntegritySources} from '@lib/update/integrity-source-presentation';
import type {IntegritySourceDetail} from '@lib/update/update-baseline';

const source = (name: string, version: string, overrides: Partial<IntegritySourceDetail> = {}): IntegritySourceDetail => ({
  name,
  status: 'ok',
  version,
  gitSha: 'release-sha',
  swUrl: '/service-worker.js',
  swHash: 'release-hash',
  ...overrides
});

describe('classifyIntegritySources', () => {
  it('marks a valid but divergent mirror as a warning', () => {
    const details = [
      source('cdn', '0.26.0'),
      source('github-pages', '0.26.0'),
      source('ipfs', '0.24.1', {gitSha: 'old-sha', swHash: 'old-hash'})
    ];

    expect(classifyIntegritySources(details)).toEqual(['agreeing', 'agreeing', 'divergent']);
  });

  it('does not show green when two valid sources disagree', () => {
    expect(classifyIntegritySources([
      source('cdn', '0.26.0'),
      source('ipfs', '0.24.1')
    ])).toEqual(['divergent', 'divergent']);
  });

  it('marks matching valid sources as agreeing', () => {
    expect(classifyIntegritySources([
      source('cdn', '0.26.0'),
      source('github-pages', '0.26.0')
    ])).toEqual(['agreeing', 'agreeing']);
  });

  it('does not treat a single valid source as consensus', () => {
    expect(classifyIntegritySources([source('cdn', '0.26.0')])).toEqual(['divergent']);
  });

  it('detects a service-worker hash-only divergence', () => {
    expect(classifyIntegritySources([
      source('cdn', '0.26.0'),
      source('github-pages', '0.26.0'),
      source('ipfs', '0.26.0', {swHash: 'different-hash'})
    ])).toEqual(['agreeing', 'agreeing', 'divergent']);
  });

  it('keeps failed and stale sources distinct from valid manifests', () => {
    expect(classifyIntegritySources([
      source('cdn', '0.26.0'),
      {name: 'github-pages', status: 'error', error: 'HTTP 500'},
      {name: 'ipfs', status: 'stale'}
    ])).toEqual(['divergent', 'error', 'warning']);
  });
});
