import {render} from 'solid-js/web';
import {FirstInstallInfo} from './firstInstallInfo';

export function mountFirstInstallBanner(fingerprint: string, version: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => (
    <FirstInstallInfo
      fingerprint={fingerprint}
      version={version}
      onDismiss={() => {dispose(); host.remove();}}
    />
  ), host);
}
