import {JSX, createSignal, onMount, onCleanup} from 'solid-js';
import classNames from '@helpers/string/classNames';
import useNostraIdentity from '@stores/nostraIdentity';

export default function QRIdentity(props: {
  onBack?: () => void;
  class?: string;
}) {
  const {npub, displayName, nip05} = useNostraIdentity();
  const [copied, setCopied] = createSignal(false);
  const [shareSupported] = createSignal(typeof navigator.share === 'function');
  let qrContainer: HTMLDivElement | undefined;
  let qrInstance: any = null;
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  onMount(async() => {
    const currentNpub = npub();
    if(!currentNpub || !qrContainer) return;

    const {default: QRCodeStyling} = await import('qr-code-styling' as any);

    qrInstance = new QRCodeStyling({
      width: 280,
      height: 280,
      data: currentNpub,
      dotsOptions: {
        color: '#1a1a2e',
        type: 'rounded'
      },
      cornersSquareOptions: {
        type: 'extra-rounded'
      },
      backgroundOptions: {
        color: '#ffffff'
      },
      qrOptions: {
        errorCorrectionLevel: 'M'
      }
    });

    qrInstance.append(qrContainer);
  });

  onCleanup(() => {
    if(copiedTimeout) clearTimeout(copiedTimeout);
  });

  const handleCopy = async() => {
    const currentNpub = npub();
    if(!currentNpub) return;
    try {
      await navigator.clipboard.writeText(currentNpub);
      setCopied(true);
      copiedTimeout = setTimeout(() => setCopied(false), 2000);
    } catch(err) {
      console.warn('Failed to copy npub:', err);
    }
  };

  const handleShare = async() => {
    if(!qrInstance) return;
    try {
      if(shareSupported()) {
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
      // Fallback: download
      qrInstance.download({
        name: 'nostra-qr',
        extension: 'png'
      });
    } catch(err) {
      // User cancelled share or download fallback
      try {
        qrInstance.download({
          name: 'nostra-qr',
          extension: 'png'
        });
      } catch(_) {
        console.warn('Failed to share/download QR:', err);
      }
    }
  };

  const truncateNpub = (value: string): string => {
    if(value.length <= 16) return value;
    return value.slice(0, 10) + '...' + value.slice(-6);
  };

  return (
    <div class={classNames('nostra-qr-identity', props.class)}>
      <div class="nostra-qr-identity-header">
        {props.onBack && (
          <button
            class="nostra-qr-identity-back"
            onClick={props.onBack}
          >
            {'<'}
          </button>
        )}
        <h3 class="nostra-qr-identity-title">My QR Code</h3>
      </div>

      <div class="nostra-qr-identity-content">
        <div
          class="nostra-qr-identity-qr"
          ref={qrContainer}
        />

        <div class="nostra-qr-identity-info">
          <div class="nostra-qr-identity-name">
            {displayName() || truncateNpub(npub() || '')}
          </div>

          {nip05() && (
            <div class="nostra-qr-identity-nip05">
              <span class="nostra-qr-identity-nip05-check">&#10003;</span>
              <span>{nip05()}</span>
            </div>
          )}
        </div>

        <div class="nostra-qr-identity-actions">
          <button
            class={classNames('nostra-qr-identity-btn', copied() && 'copied')}
            onClick={handleCopy}
          >
            {copied() ? 'Copied!' : 'Copy npub'}
          </button>
          <button
            class="nostra-qr-identity-btn"
            onClick={handleShare}
          >
            Share QR
          </button>
        </div>
      </div>
    </div>
  );
}
