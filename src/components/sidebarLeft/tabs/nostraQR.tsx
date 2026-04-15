/*
 * Nostra.chat — My QR Code sub-tab
 *
 * Thin SliderSuperTab wrapper that imperatively mounts the
 * <KeyExchange /> Solid component into its scrollable container
 * and disposes it on tab close.
 */

import {SliderSuperTab} from '@components/slider';
import {render} from 'solid-js/web';
import KeyExchange from '@components/nostra/KeyExchange';

export default class AppNostraQRTab extends SliderSuperTab {
  private dispose?: () => void;

  public init() {
    this.container.classList.add('nostra-qr-tab');
    this.setTitle('My QR Code' as any);

    const mountPoint = document.createElement('div');
    this.scrollable.append(mountPoint);

    this.dispose = render(() => <KeyExchange />, mountPoint);
  }

  protected onCloseAfterTimeout() {
    if(this.dispose) {
      this.dispose();
      this.dispose = undefined;
    }
    return super.onCloseAfterTimeout();
  }
}
