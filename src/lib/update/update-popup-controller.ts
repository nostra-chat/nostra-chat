import rootScope from '@lib/rootScope';
import type {IntegrityResult, Manifest} from '@lib/update/types';

const SKIP_LS_KEY = 'nostra.update.skippedVersion';
const SKIP_TTL_MS = 24 * 60 * 60 * 1000; // 24h — re-prompt next day

let _lastIntegrity: IntegrityResult | undefined;
let _shownForVersion: string | undefined;

function isVersionSkipped(version: string): boolean {
  try {
    const raw = localStorage.getItem(SKIP_LS_KEY);
    if(!raw) return false;
    const parsed = JSON.parse(raw) as {version: string; skippedAt: number};
    if(parsed.version !== version) return false;
    if(Date.now() - parsed.skippedAt > SKIP_TTL_MS) {
      localStorage.removeItem(SKIP_LS_KEY);
      return false;
    }
    return true;
  } catch{
    return false;
  }
}

export function skipVersion(version: string): void {
  try {
    localStorage.setItem(SKIP_LS_KEY, JSON.stringify({version, skippedAt: Date.now()}));
  } catch{}
}

rootScope.addEventListener('update_integrity_check_completed', (result) => {
  _lastIntegrity = result;
});

rootScope.addEventListener('update_available', async(manifest: Manifest) => {
  if(_shownForVersion === manifest.version) return;
  if(isVersionSkipped(manifest.version)) return;
  if(!_lastIntegrity) return;
  _shownForVersion = manifest.version;
  const {default: UpdateAvailablePopup} = await import('@components/popups/updateAvailable');
  new UpdateAvailablePopup(manifest, _lastIntegrity).show();
});
