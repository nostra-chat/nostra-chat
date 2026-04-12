import {describe, it, expect} from 'vitest';
import {isEditMessage} from '@lib/nostra/chat-api-receive';

describe('isEditMessage', () => {
  it('returns null for undefined tags', () => {
    expect(isEditMessage(undefined)).toBeNull();
  });

  it('returns null for empty tags', () => {
    expect(isEditMessage([])).toBeNull();
  });

  it('returns null when no nostra-edit tag present', () => {
    expect(isEditMessage([
      ['p', 'abcd1234'],
      ['e', 'somehex', '', 'reply']
    ])).toBeNull();
  });

  it('detects a valid nostra-edit tag', () => {
    const result = isEditMessage([
      ['p', 'abcd1234'],
      ['nostra-edit', 'chat-1712345678901-1']
    ]);
    expect(result).toEqual({originalAppMessageId: 'chat-1712345678901-1'});
  });

  it('rejects a nostra-edit tag with non-app-id format', () => {
    expect(isEditMessage([
      ['nostra-edit', 'not-an-app-id']
    ])).toBeNull();
    expect(isEditMessage([
      ['nostra-edit', 'abc123']
    ])).toBeNull();
  });

  it('rejects a nostra-edit tag with missing value', () => {
    expect(isEditMessage([
      ['nostra-edit']
    ])).toBeNull();
  });

  it('rejects a nostra-edit tag with non-string value', () => {
    expect(isEditMessage([
      ['nostra-edit', null as any]
    ])).toBeNull();
  });

  it('finds the marker even when other tags surround it', () => {
    const result = isEditMessage([
      ['p', 'recipient'],
      ['e', 'a'.repeat(64), '', 'root'],
      ['nostra-edit', 'chat-99-7'],
      ['t', 'topic']
    ]);
    expect(result).toEqual({originalAppMessageId: 'chat-99-7'});
  });

  it('returns the first matching marker if duplicates appear', () => {
    const result = isEditMessage([
      ['nostra-edit', 'chat-1-1'],
      ['nostra-edit', 'chat-2-2']
    ]);
    expect(result).toEqual({originalAppMessageId: 'chat-1-1'});
  });
});
