import {createSignal, onMount, onCleanup, Show} from 'solid-js';
import classNames from '@helpers/string/classNames';
import useNostraIdentity from '@stores/nostraIdentity';
import {getAvatarForQR} from '@lib/nostra/avatar-for-qr';
import styles from './key-exchange.module.scss';

export interface KeyExchangeProps {
  class?: string;
  onScanClick?: () => void;
}

export default function KeyExchange(props: KeyExchangeProps) {
  const {npub, displayName, nip05, picture} = useNostraIdentity();
  const [copied, setCopied] = createSignal(false);
  let qrContainer: HTMLDivElement | undefined;
  let qrInstance: any = null;
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  onMount(async() => {
    const currentNpub = npub();
    if(!currentNpub || !qrContainer) return;

    const avatarURL = await getAvatarForQR(currentNpub, picture());

    const {default: QRCodeStyling} = await import('qr-code-styling' as any);
    qrInstance = new QRCodeStyling({
      width: 280,
      height: 280,
      data: 'nostr:' + currentNpub,
      image: avatarURL,
      imageOptions: {
        crossOrigin: 'anonymous',
        margin: 6,
        imageSize: 0.25,
        hideBackgroundDots: true
      },
      qrOptions: {
        errorCorrectionLevel: 'H'
      },
      dotsOptions: {
        color: '#1a1a2e',
        type: 'rounded'
      },
      cornersSquareOptions: {
        type: 'extra-rounded'
      },
      backgroundOptions: {
        color: '#ffffff'
      }
    });

    qrInstance.append(qrContainer);
  });

  onCleanup(() => {
    if(copiedTimeout) clearTimeout(copiedTimeout);
    if(qrContainer) qrContainer.innerHTML = '';
  });

  const handleCopy = async() => {
    const currentNpub = npub();
    if(!currentNpub) return;
    try {
      await navigator.clipboard.writeText(currentNpub);
      setCopied(true);
      copiedTimeout = setTimeout(() => setCopied(false), 2000);
    } catch(err) {
      console.warn('[KeyExchange] copy failed', err);
    }
  };

  const handleShare = async() => {
    if(!qrInstance) return;
    try {
      if(typeof navigator.share === 'function') {
        const blob = await qrInstance.getRawData('png');
        if(blob) {
          const file = new File([blob], 'nostra-qr.png', {type: 'image/png'});
          await navigator.share({
            title: 'My Nostra.chat QR',
            text: npub() || '',
            files: [file]
          });
          return;
        }
      }
      qrInstance.download({name: 'nostra-qr', extension: 'png'});
    } catch(err) {
      try {
        qrInstance.download({name: 'nostra-qr', extension: 'png'});
      } catch(fallbackErr) {
        console.warn('[KeyExchange] share/download failed', err, fallbackErr);
      }
    }
  };

  const truncateNpub = (value: string): string => {
    if(value.length <= 16) return value;
    return value.slice(0, 10) + '...' + value.slice(-6);
  };

  return (
    <div class={classNames(styles.wrap, props.class)}>
      <div class={styles.qr} ref={qrContainer} data-testid="qr-container" />

      <div class={styles.info}>
        <div class={styles.name}>
          {displayName() || truncateNpub(npub() || '')}
        </div>
        <Show when={nip05()}>
          <div class={styles.nip05}>
            <span>&#10003;</span>
            <span>{nip05()}</span>
          </div>
        </Show>
      </div>

      <div class={styles.actions}>
        <button onClick={handleCopy}>
          {copied() ? 'Copied!' : 'Copy npub'}
        </button>
        <button onClick={handleShare}>Share QR</button>
      </div>

      <div class={styles.divider}>or scan</div>

      <button
        class={styles.scanBtn}
        data-testid="scan-btn"
        onClick={() => props.onScanClick?.()}
      >
        Scan QR
      </button>
    </div>
  );
}
