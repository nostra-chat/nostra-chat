import {describe, expect, it} from 'vitest';
import type {LangPackString} from '@layer';
import {mergeLocalAndRemoteLangStrings} from '@lib/lang-pack-merge';

const local = (key: string, value: string): LangPackString => ({
  _: 'langPackString',
  key,
  value
} as LangPackString);

describe('mergeLocalAndRemoteLangStrings', () => {
  it('does not let a remote tombstone erase a bundled Nostra string', () => {
    const merged = mergeLocalAndRemoteLangStrings(
      [local('Update.Consent.Title', 'Update available')],
      [{_: 'langPackStringDeleted', key: 'Update.Consent.Title'} as LangPackString]
    );

    expect(merged).toEqual([local('Update.Consent.Title', 'Update available')]);
  });

  it('keeps a real remote translation after the bundled fallback', () => {
    const merged = mergeLocalAndRemoteLangStrings(
      [local('Update.Consent.Title', 'Update available')],
      [local('Update.Consent.Title', 'Aggiornamento disponibile')]
    );

    expect(merged.at(-1)).toEqual(local('Update.Consent.Title', 'Aggiornamento disponibile'));
  });
});
