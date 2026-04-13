import {LANGPACK_PREFIX} from '@lib/storages/filtersLocal';
import {i18n, LangPackKey} from '@lib/langPack';
import type {DialogFilter} from '@layer';

/**
 * Resolves a folder title for display.
 *
 * If the title uses the LANGPACK: sentinel, returns a reactive i18n element
 * that updates on locale change. Otherwise returns the literal text (custom
 * folders the user created or renamed).
 *
 * Caller handles appending the return value into the DOM — for TSX use
 * {resolveFolderTitle(filter.title)}, for imperative DOM use appendChild
 * with a wrapping Text node if the result is a string.
 */
export function resolveFolderTitle(title: DialogFilter.dialogFilter['title']): HTMLElement | string {
  const text = title?.text ?? '';
  if(text.startsWith(LANGPACK_PREFIX)) {
    const key = text.slice(LANGPACK_PREFIX.length) as LangPackKey;
    return i18n(key);
  }
  return text;
}

/**
 * Returns true if the title is a LANGPACK sentinel (vs a user-renamed literal).
 * Useful when you want to know whether to display the key name in rename UI
 * vs the resolved localized text.
 */
export function isLangpackTitle(title: DialogFilter.dialogFilter['title']): boolean {
  return (title?.text ?? '').startsWith(LANGPACK_PREFIX);
}
