import {describe, expect, it, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {computeSignature, recordSighting, loadStore, type Sighting} from '../../../scripts/explorer/signature';

describe('explorer signature', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'exp-sig-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, {recursive: true, force: true});
  });

  it('computeSignature returns a stable string for identical inputs', () => {
    const sig1 = computeSignature({area: 'messaging', intent: 'send_text_message', oracle: 'A:console_error', hash: 'deadbeef'});
    const sig2 = computeSignature({area: 'messaging', intent: 'send_text_message', oracle: 'A:console_error', hash: 'deadbeef'});
    expect(sig1).toBe(sig2);
    expect(sig1).toBe('messaging:send_text_message:A:console_error:deadbeef');
  });

  it('recordSighting creates the store on first call', async() => {
    const storePath = join(tmpRoot, 'seen-signatures.json');
    const sighting: Sighting = {
      signature: 'messaging:send_text_message:A:console_error:abc12345',
      findId: 'FIND-12345678',
      timestamp: '2026-04-29T14:00:00Z'
    };
    const result = await recordSighting(storePath, sighting);
    expect(result.isNew).toBe(true);
    expect(result.entry.occurrences).toBe(1);
    expect(existsSync(storePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(storePath, 'utf8'));
    expect(parsed[sighting.signature]).toMatchObject({
      find_id: 'FIND-12345678',
      occurrences: 1,
      status: 'open'
    });
  });

  it('recordSighting bumps occurrences on duplicate signature', async() => {
    const storePath = join(tmpRoot, 'seen-signatures.json');
    const sig = 'messaging:send_text_message:A:console_error:abc12345';
    await recordSighting(storePath, {signature: sig, findId: 'FIND-1', timestamp: '2026-04-29T14:00:00Z'});
    const result = await recordSighting(storePath, {signature: sig, findId: 'FIND-2', timestamp: '2026-04-29T14:05:00Z'});
    expect(result.isNew).toBe(false);
    expect(result.entry.occurrences).toBe(2);
    expect(result.entry.first_seen).toBe('2026-04-29T14:00:00Z');
    expect(result.entry.last_seen).toBe('2026-04-29T14:05:00Z');
  });

  it('loadStore returns {} when the file does not exist', async() => {
    const storePath = join(tmpRoot, 'missing.json');
    const store = await loadStore(storePath);
    expect(store).toEqual({});
  });

  it('recordSighting flags REGRESSION when signature has status=fixed', async() => {
    const storePath = join(tmpRoot, 'seen-signatures.json');
    const sig = 'messaging:send_text_message:A:console_error:abc12345';
    writeFileSync(storePath, JSON.stringify({
      [sig]: {find_id: 'FIND-old', occurrences: 1, first_seen: 't0', last_seen: 't0', status: 'fixed'}
    }));
    const result = await recordSighting(storePath, {signature: sig, findId: 'FIND-new', timestamp: 't1'});
    expect(result.isNew).toBe(false);
    expect(result.regression).toBe(true);
    expect(result.entry.status).toBe('fixed');
  });
});
