import {describe, it, expect} from 'vitest';
import type {DialogFilter} from '@layer';
import {
  FOLDER_ID_ALL,
  FOLDER_ID_ARCHIVE,
  FOLDER_ID_PERSONS,
  FOLDER_ID_GROUPS
} from '@appManagers/constants';
import {buildLocalFilter, LANGPACK_PREFIX, langpackTitle} from '@lib/storages/filtersLocal';

describe('buildLocalFilter', () => {
  it('builds All Chats with exclude_archived flag', () => {
    const f = buildLocalFilter(FOLDER_ID_ALL) as DialogFilter.dialogFilter;
    expect(f.id).toBe(FOLDER_ID_ALL);
    expect(f.pFlags.exclude_archived).toBe(true);
    expect(f.pFlags.contacts).toBeFalsy();
    expect(f.pFlags.groups).toBeFalsy();
  });

  it('builds Archive with exclude_unarchived flag', () => {
    const f = buildLocalFilter(FOLDER_ID_ARCHIVE) as DialogFilter.dialogFilter;
    expect(f.id).toBe(FOLDER_ID_ARCHIVE);
    expect(f.pFlags.exclude_unarchived).toBe(true);
  });

  it('builds Persons with contacts + non_contacts + exclude_archived', () => {
    const f = buildLocalFilter(FOLDER_ID_PERSONS) as DialogFilter.dialogFilter;
    expect(f.id).toBe(FOLDER_ID_PERSONS);
    expect(f.pFlags.contacts).toBe(true);
    expect(f.pFlags.non_contacts).toBe(true);
    expect(f.pFlags.exclude_archived).toBe(true);
    expect(f.pFlags.groups).toBeFalsy();
    expect(f.pFlags.broadcasts).toBeFalsy();
  });

  it('builds Groups with groups + exclude_archived', () => {
    const f = buildLocalFilter(FOLDER_ID_GROUPS) as DialogFilter.dialogFilter;
    expect(f.id).toBe(FOLDER_ID_GROUPS);
    expect(f.pFlags.groups).toBe(true);
    expect(f.pFlags.exclude_archived).toBe(true);
    expect(f.pFlags.contacts).toBeFalsy();
  });

  it('uses LANGPACK: sentinel for Persons and Groups titles', () => {
    expect(buildLocalFilter(FOLDER_ID_PERSONS).title.text).toBe('LANGPACK:FilterContacts');
    expect(buildLocalFilter(FOLDER_ID_GROUPS).title.text).toBe('LANGPACK:FilterGroups');
  });

  it('langpackTitle helper returns a textWithEntities with the prefix', () => {
    const t = langpackTitle('SomeKey');
    expect(t._).toBe('textWithEntities');
    expect(t.text).toBe('LANGPACK:SomeKey');
    expect(t.entities).toEqual([]);
  });

  it('LANGPACK_PREFIX constant is exported as "LANGPACK:"', () => {
    expect(LANGPACK_PREFIX).toBe('LANGPACK:');
  });
});

import findAndSplice from '@helpers/array/findAndSplice';

// Minimal re-implementation of FiltersStorage.prependFilters core logic,
// without dialogsStorage access — so we can unit-test the ordering invariants.
function prependForTest(existing: DialogFilter[]): DialogFilter[] {
  const filters: any[] = existing.slice();
  const allIdx = filters.findIndex((f: any) => f.id === FOLDER_ID_ALL);
  if(allIdx === -1) filters.unshift(buildLocalFilter(FOLDER_ID_ALL));
  const ensure = (id: number, index: number) => {
    findAndSplice(filters, (f: any) => f.id === id);
    filters.splice(index, 0, buildLocalFilter(id));
  };
  ensure(FOLDER_ID_PERSONS, 1);
  ensure(FOLDER_ID_GROUPS, 2);
  ensure(FOLDER_ID_ARCHIVE, 3);
  return filters;
}

describe('prependFilters seed ordering', () => {
  it('seeds all 4 system folders for an empty array', () => {
    const out = prependForTest([]);
    expect(out.map((f: any) => f.id)).toEqual([0, 2, 3, 1]);
  });

  it('inserts Persons and Groups for users with [ALL, ARCHIVE] only', () => {
    const existing = [buildLocalFilter(FOLDER_ID_ALL), buildLocalFilter(FOLDER_ID_ARCHIVE)];
    const out = prependForTest(existing);
    expect(out.map((f: any) => f.id)).toEqual([0, 2, 3, 1]);
  });

  it('preserves user custom folders at the tail', () => {
    const custom = {
      ...buildLocalFilter(FOLDER_ID_ALL),
      id: 42,
      title: {_: 'textWithEntities' as const, text: 'Work', entities: [] as never[]}
    };
    const existing = [
      buildLocalFilter(FOLDER_ID_ALL),
      buildLocalFilter(FOLDER_ID_ARCHIVE),
      custom as any
    ];
    const out = prependForTest(existing);
    expect(out.map((f: any) => f.id)).toEqual([0, 2, 3, 1, 42]);
    expect((out[4] as any).title.text).toBe('Work');
  });
});
