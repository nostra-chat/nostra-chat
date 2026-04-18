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

  it('normalises timing prefixes so the same logical warning collapses to one sig', () => {
    const a = computeSignature({invariantId: 'INV-x', message: '[warning] %s [0.044] [IDB-tweb-common] performing idb upgrade from 0 to 8'});
    const b = computeSignature({invariantId: 'INV-x', message: '[warning] %s [0.047] [IDB-tweb-common] performing idb upgrade from 0 to 8'});
    const c = computeSignature({invariantId: 'INV-x', message: '[warning] %s [12.031] [IDB-tweb-common] performing idb upgrade from 0 to 8'});
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('normalises npub + hex ids + mid + boot durations', () => {
    const a = computeSignature({invariantId: 'INV-x', message: 'avatar DOM src != cache on userA (npub1nla4z48mw5qxt6e…)'});
    const b = computeSignature({invariantId: 'INV-x', message: 'avatar DOM src != cache on userA (npub17nud3gwqgabc…)'});
    expect(a).toBe(b);

    const c = computeSignature({invariantId: 'INV-x', message: 'bubble mid=1712345678 state sent but tracker delivered'});
    const d = computeSignature({invariantId: 'INV-x', message: 'bubble mid=1712345999 state sent but tracker delivered'});
    expect(c).toBe(d);

    const e = computeSignature({invariantId: 'INV-x', message: 'boot done in 67.2s after 2 retries'});
    const f = computeSignature({invariantId: 'INV-x', message: 'boot done in 82.1s after 2 retries'});
    expect(e).toBe(f);
  });

  it('does NOT collapse distinct errors (conservative normalisation)', () => {
    const a = computeSignature({invariantId: 'INV-x', message: 'duplicate mid in DOM'});
    const b = computeSignature({invariantId: 'INV-x', message: 'bubble not chronological'});
    expect(a).not.toBe(b);
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
