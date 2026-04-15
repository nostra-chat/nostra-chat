import {createSignal, onCleanup, onMount, Show} from 'solid-js';
import {render} from 'solid-js/web';
import {parseQRPayload} from '@lib/nostra/qr-payload';
import {toast} from '@components/toast';
import styles from './key-exchange.module.scss';

export interface QRScannerProps {
  onDetected: (npub: string) => void;
  onClose?: () => void;
}

type ScannerState =
  | {kind: 'loading'}
  | {kind: 'scanning'}
  | {kind: 'denied'}
  | {kind: 'nocamera'};

function QRScannerComponent(props: QRScannerProps) {
  const [state, setState] = createSignal<ScannerState>({kind: 'loading'});
  const [errorFlash, setErrorFlash] = createSignal(false);
  let videoEl: HTMLVideoElement | undefined;
  let canvasEl: HTMLCanvasElement | undefined;
  let stream: MediaStream | null = null;
  let rafId: number | null = null;
  let detected = false;
  let flashTimeout: ReturnType<typeof setTimeout> | undefined;
  let unmounted = false;

  const stopTracks = () => {
    if(stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  };

  const cleanup = () => {
    unmounted = true;
    if(rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    stopTracks();
    if(flashTimeout) clearTimeout(flashTimeout);
  };

  const close = () => {
    cleanup();
    props.onClose?.();
  };

  const flashError = () => {
    setErrorFlash(true);
    if(flashTimeout) clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => setErrorFlash(false), 400);
  };

  onMount(async() => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment'}
      });
    } catch(err: any) {
      if(err?.name === 'NotAllowedError') {
        setState({kind: 'denied'});
        return;
      }
      if(err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        // Retry without facingMode constraint
        try {
          stream = await navigator.mediaDevices.getUserMedia({video: true});
        } catch(_) {
          setState({kind: 'nocamera'});
          return;
        }
      } else {
        setState({kind: 'nocamera'});
        return;
      }
    }

    if(unmounted || !stream || !videoEl) {
      stopTracks();
      return;
    }
    videoEl.srcObject = stream;
    try {
      await videoEl.play();
    } catch(_) {}
    if(unmounted) {
      stopTracks();
      return;
    }
    setState({kind: 'scanning'});

    const {default: jsQR} = await import('jsqr');
    if(unmounted) return;

    const tick = () => {
      if(detected || unmounted || !videoEl || !canvasEl) return;
      if(videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        const ctx = canvasEl.getContext('2d', {willReadFrequently: true});
        if(!ctx) return;
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        if(code) {
          const result = parseQRPayload(code.data);
          if('npub' in result) {
            detected = true;
            cleanup();
            props.onDetected(result.npub);
            props.onClose?.();
            return;
          }
          if(result.error === 'self') {
            toast("That's your own QR");
            flashError();
          } else if(result.error === 'unsupported') {
            toast('Hex pubkeys are not supported — scan an npub QR');
            flashError();
          } else {
            toast('Not a Nostr QR code');
            flashError();
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });

  onCleanup(cleanup);

  return (
    <div class={styles.scannerOverlay} data-testid="qr-scanner-overlay">
      <button class={styles.scannerClose} onClick={close} aria-label="Close scanner">✕</button>

      <Show when={state().kind === 'scanning'}>
        <video ref={videoEl} class={styles.scannerVideo} autoplay playsinline muted />
        <canvas ref={canvasEl} style="display:none" />
        <div classList={{[styles.scannerViewfinder]: true, [styles.scannerViewfinderError]: errorFlash()}} />
        <div class={styles.scannerHint}>Point camera at QR code</div>
      </Show>

      <Show when={state().kind === 'denied'}>
        <div class={styles.scannerError}>
          <div>Camera access denied</div>
          <div style="font-size:13px;opacity:0.7;margin-top:8px;">Enable camera permission in your browser settings and try again.</div>
          <button onClick={close}>Close</button>
        </div>
      </Show>

      <Show when={state().kind === 'nocamera'}>
        <div class={styles.scannerError}>
          <div>No camera found</div>
          <button onClick={close}>Close</button>
        </div>
      </Show>

      <Show when={state().kind === 'loading'}>
        <div class={styles.scannerError}>
          <div>Starting camera…</div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Imperatively launch the QR scanner overlay. Returns a disposer that
 * unmounts it. The scanner also unmounts itself on detection or close.
 */
export function launchQRScanner(props: QRScannerProps): () => void {
  const host = document.createElement('div');
  document.body.append(host);

  let disposed = false;
  const dispose = render(
    () => (
      <QRScannerComponent
        onDetected={props.onDetected}
        onClose={() => {
          props.onClose?.();
          if(disposed) return;
          disposed = true;
          dispose();
          host.remove();
        }}
      />
    ),
    host
  );

  return () => {
    if(disposed) return;
    disposed = true;
    dispose();
    host.remove();
  };
}

export default QRScannerComponent;
