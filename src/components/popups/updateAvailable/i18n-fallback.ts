import I18n, {type LangPackKey} from '@lib/langPack';

// English fallbacks for every key the update popup reads. Used when I18n.strings
// does not contain the key — e.g. when the popup renders during the boot-order
// window before getCacheLangPackAndApply() completes, or when the running bundle
// is older than the lang.ts that introduced these keys. Keep in sync with the
// 'Update.Popup.*' / 'Update.Badge.*' entries in src/lang.ts.
export const UPDATE_POPUP_FALLBACKS: Record<string, string> = {
  'Update.Popup.Title': 'Update available',
  'Update.Popup.Version': 'version %1$s',
  'Update.Popup.Changelog': 'What\'s new in this version',
  'Update.Popup.Downloading': 'Downloading…',
  'Update.Popup.Later': 'Later',
  'Update.Popup.Now': 'Update now',
  'Update.Badge.Verified': '✅ Verified by %1$d sources: %2$s',
  'Update.Badge.VerifiedPartial': '⚠️ Partially verified (%1$d of %2$d)',
  'Update.Badge.Conflict': '❌ Conflict detected across sources'
};

function interpolate(template: string, args?: ReadonlyArray<string | number>): string {
  if(!args || !args.length) return template;
  return template.replace(/%(\d+)\$[sd]/g, (_, idx) => {
    const v = args[+idx - 1];
    return v === undefined ? '' : String(v);
  });
}

// Resolve an update-popup key against I18n.strings first, falling back to the
// hardcoded English copy if the key is absent. I18n.format() returns the raw
// key on miss, which is what caused the "Update.Popup.Title" literal to leak
// into the UI — so we check Map membership explicitly instead.
export function tUpdatePopup(key: keyof typeof UPDATE_POPUP_FALLBACKS, args?: ReadonlyArray<string | number>): string {
  if(I18n.strings.has(key as LangPackKey)) {
    return I18n.format(key as LangPackKey, true, args as any);
  }
  return interpolate(UPDATE_POPUP_FALLBACKS[key], args);
}
