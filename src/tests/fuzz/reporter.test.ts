import {describe, it, expect} from 'vitest';
import {computeSignature, parseFindingsMarkdown, renderFindingsMarkdown} from './reporter';
import type {ReportEntry} from './types';

describe('signature', () => {
  it('is stable for same invariant + message + frame', () => {
    const a = computeSignature({invariantId: 'INV-foo', message: 'bar', stackTopFrame: 'at thing:123'});
    const b = computeSignature({invariantId: 'INV-foo', message: 'bar', stackTopFrame: 'at thing:123'});
    expect(a).toBe(b);
  });
  it('differs across invariants', () => {
    const a = computeSignature({invariantId: 'INV-foo', message: 'x'});
    const b = computeSignature({invariantId: 'INV-bar', message: 'x'});
    expect(a).not.toBe(b);
  });
  it('is 8 hex chars', () => {
    const s = computeSignature({invariantId: 'INV-a', message: 'm'});
    expect(s).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('markdown round-trip', () => {
  it('renders + parses an entry', () => {
    const entry: ReportEntry = {
      signature: 'abcd1234',
      invariantId: 'INV-delivery-ui-matches-tracker',
      tier: 'cheap',
      assertion: 'bubble is sent but tracker says delivered',
      occurrences: 42,
      firstSeen: '2026-04-17 22:30',
      lastSeen: '2026-04-17 23:15',
      seed: 1744924508331,
      minimalTrace: [{name: 'sendText', args: {from: 'userA', text: 'hi'}}],
      status: 'open'
    };
    const md = renderFindingsMarkdown([entry]);
    const parsed = parseFindingsMarkdown(md);
    expect(parsed.length).toBe(1);
    expect(parsed[0].signature).toBe('abcd1234');
    expect(parsed[0].occurrences).toBe(42);
    expect(parsed[0].invariantId).toBe('INV-delivery-ui-matches-tracker');
  });
});
