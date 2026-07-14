import type {LangPackString} from '@layer';

/**
 * Keep bundled strings as the fallback for Nostra-only keys.
 *
 * Telegram's remote language packs can return `langPackStringDeleted` for
 * keys they do not know. Those tombstones must not overwrite strings shipped
 * in our local bundle, while real remote translations should still win.
 */
export function mergeLocalAndRemoteLangStrings(
  localStrings: LangPackString[],
  remoteStrings: LangPackString[]
): LangPackString[] {
  const localKeys = new Set(localStrings.map((entry) => entry.key));
  return localStrings.concat(remoteStrings.filter((entry) =>
    entry._ !== 'langPackStringDeleted' || !localKeys.has(entry.key)
  ));
}
