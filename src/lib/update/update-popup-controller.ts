import rootScope from '@lib/rootScope';
import type {IntegrityResult, Manifest} from '@lib/update/types';

let _lastIntegrity: IntegrityResult | undefined;
let _shownForVersion: string | undefined;

rootScope.addEventListener('update_integrity_check_completed', (result) => {
  _lastIntegrity = result;
});

rootScope.addEventListener('update_available', async(manifest: Manifest) => {
  if(_shownForVersion === manifest.version) return;
  if(!_lastIntegrity) return;
  _shownForVersion = manifest.version;
  const {default: UpdateAvailablePopup} = await import('@components/popups/updateAvailable');
  new UpdateAvailablePopup(manifest, _lastIntegrity).show();
});
