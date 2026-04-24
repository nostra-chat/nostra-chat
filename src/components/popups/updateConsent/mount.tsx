import {render} from 'solid-js/web';
import {UpdateConsent} from './index';
import {acceptUpdate, declineUpdate} from '@lib/update/update-popup-controller';
import {getActiveVersion} from '@lib/serviceWorker/shell-cache';

export async function showUpdateConsentPopup(manifest: any, signature: string, manifestText?: string) {
  const active = await getActiveVersion();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center';
  document.body.appendChild(host);
  const dispose = render(() => (
    <UpdateConsent
      currentVersion={active?.version ?? 'unknown'}
      newManifest={manifest}
      installedFingerprint={active?.keyFingerprint ?? ''}
      onAccept={async() => {
        const res = await acceptUpdate(manifest, signature, manifestText);
        if(res.ok) {
          if(confirm('Aggiornamento applicato. Ricarica ora?')) location.reload();
          dispose();
          host.remove();
        } else {
          throw new Error(res.reason || 'unknown');
        }
      }}
      onDecline={() => {
        declineUpdate(manifest.version);
        dispose();
        host.remove();
      }}
    />
  ), host);
}
