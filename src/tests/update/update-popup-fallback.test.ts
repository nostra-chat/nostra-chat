import {describe, it, expect, beforeEach} from 'vitest';
import I18n from '@lib/langPack';
import {tUpdatePopup, UPDATE_POPUP_FALLBACKS} from '@components/popups/updateAvailable/i18n-fallback';

describe('update popup i18n fallback', () => {
  beforeEach(() => {
    I18n.strings.clear();
  });

  it('returns the English fallback when the key is not in I18n.strings', () => {
    // This reproduces the original bug: the popup rendered before the lang
    // pack was applied, and I18n.format() leaked the raw key 'Update.Popup.Title'
    // into the DOM. The fallback path must now return human-readable English.
    expect(tUpdatePopup('Update.Popup.Title')).toBe('Update available');
    expect(tUpdatePopup('Update.Popup.Changelog')).toBe('What\'s new in this version');
    expect(tUpdatePopup('Update.Popup.Later')).toBe('Later');
    expect(tUpdatePopup('Update.Popup.Now')).toBe('Update now');
    expect(tUpdatePopup('Update.Popup.Downloading')).toBe('Downloading…');
  });

  it('interpolates %1$s / %1$d arguments in the fallback', () => {
    expect(tUpdatePopup('Update.Popup.Version', ['1.2.3'])).toBe('version 1.2.3');
    expect(tUpdatePopup('Update.Badge.VerifiedPartial', [2, 3])).toBe('⚠️ Partially verified (2 of 3)');
    expect(tUpdatePopup('Update.Badge.Verified', [3, 'cdn, ipfs, github'])).toBe('✅ Verified by 3 sources: cdn, ipfs, github');
  });

  it('uses I18n.strings when the key is present (lang pack wins)', () => {
    I18n.strings.set('Update.Popup.Title' as any, {
      _: 'langPackString',
      key: 'Update.Popup.Title',
      value: 'Custom translated title'
    });
    expect(tUpdatePopup('Update.Popup.Title')).toBe('Custom translated title');
  });

  it('covers every key the update popup reads', () => {
    // Guard: if a future change adds a new I18n.format(...) call in the popup,
    // this list must be extended. Keep in sync with index.tsx usage sites.
    const requiredKeys = [
      'Update.Popup.Title',
      'Update.Popup.Version',
      'Update.Popup.Changelog',
      'Update.Popup.Downloading',
      'Update.Popup.Later',
      'Update.Popup.Now',
      'Update.Badge.Verified',
      'Update.Badge.VerifiedPartial',
      'Update.Badge.Conflict'
    ];
    for(const k of requiredKeys) {
      expect(UPDATE_POPUP_FALLBACKS[k], `missing fallback for ${k}`).toBeTruthy();
    }
  });
});
