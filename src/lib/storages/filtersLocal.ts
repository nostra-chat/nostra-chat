import type {DialogFilter} from '@layer';
import type {MyDialogFilter} from '@lib/storages/filters';
import copy from '@helpers/object/copy';
import {
  FOLDER_ID_ALL,
  FOLDER_ID_ARCHIVE,
  FOLDER_ID_PERSONS,
  FOLDER_ID_GROUPS
} from '@appManagers/constants';

const LOCAL_FILTER_TEMPLATE: DialogFilter.dialogFilter = {
  _: 'dialogFilter',
  pFlags: {},
  id: 0,
  title: {_: 'textWithEntities', text: '', entities: []},
  exclude_peers: [],
  include_peers: [],
  pinned_peers: [],
  excludePeerIds: [],
  includePeerIds: [],
  pinnedPeerIds: []
};

/**
 * Sentinel prefix used inside `title.text` to mark the title as an i18n
 * langpack key (rather than a literal string to render). The folder render
 * site strips the prefix and passes the remainder to I18n at display time,
 * so the title stays reactive to locale changes without touching the
 * MyDialogFilter type (which is derived from @layer).
 */
export const LANGPACK_PREFIX = 'LANGPACK:';

export function langpackTitle(key: string): DialogFilter.dialogFilter['title'] {
  return {_: 'textWithEntities', text: LANGPACK_PREFIX + key, entities: []};
}

/**
 * Pure constructor for locally-seeded filters. Does NOT touch dialogsStorage —
 * the caller in FiltersStorage.generateLocalFilter is responsible for adding
 * pinnedPeerIds via getPinnedOrders(id).
 */
export function buildLocalFilter(id: number): MyDialogFilter {
  const filter: MyDialogFilter = {...copy(LOCAL_FILTER_TEMPLATE), id};

  if(id === FOLDER_ID_ALL) {
    filter.pFlags.exclude_archived = true;
  } else if(id === FOLDER_ID_ARCHIVE) {
    filter.pFlags.exclude_unarchived = true;
  } else if(id === FOLDER_ID_PERSONS) {
    filter.pFlags.contacts = true;
    filter.pFlags.non_contacts = true;
    filter.pFlags.exclude_archived = true;
    filter.title = langpackTitle('FilterContacts');
  } else if(id === FOLDER_ID_GROUPS) {
    filter.pFlags.groups = true;
    filter.pFlags.exclude_archived = true;
    filter.title = langpackTitle('FilterGroups');
  }

  return filter;
}
