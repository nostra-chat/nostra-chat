import {createSignal, onMount, onCleanup} from 'solid-js';
import classNames from '@helpers/string/classNames';

export default function QRScanner(props: {
  onScan: (data: string) => void;
  onClose: () => void;
  class?: string;
}) {
  const [mode, setMode] = createSignal<'camera' | 'gallery'>('camera');
  const [error, setError] = createSignal<string | null>(null);
  const [cameraActive, setCameraActive] = createSignal(false);

  let videoRef: HTMLVideoElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let stream: MediaStream | null = null;
  let animationFrameId: number | null = null;
  let jsQR: typeof import('jsqr').default | null = null;

  const stopCamera = () => {
    if(animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if(stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    setCameraActive(false);
  };

  const scanFrame = () => {
    if(!videoRef || !canvasRef || !jsQR || !cameraActive()) return;

    const ctx = canvasRef.getContext('2d');
    if(!ctx) return;

    if(videoRef.readyState === videoRef.HAVE_ENOUGH_DATA) {
      canvasRef.width = videoRef.videoWidth;
      canvasRef.height = videoRef.videoHeight;
      ctx.drawImage(videoRef, 0, 0, canvasRef.width, canvasRef.height);

      const imageData = ctx.getImageData(0, 0, canvasRef.width, canvasRef.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if(code && code.data) {
        stopCamera();
        props.onScan(code.data);
        return;
      }
    }

    animationFrameId = requestAnimationFrame(scanFrame);
  };

  const startCamera = async() => {
    setError(null);
    try {
      const jsQRModule = await import('jsqr');
      jsQR = jsQRModule.default;

      stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment'}
      });

      if(videoRef) {
        videoRef.srcObject = stream;
        await videoRef.play();
        setCameraActive(true);
        animationFrameId = requestAnimationFrame(scanFrame);
      }
    } catch(err) {
      console.warn('Camera access denied:', err);
      setError('Camera access denied');
      setMode('gallery');
    }
  };

  onMount(() => {
    startCamera();
  });

  onCleanup(() => {
    stopCamera();
  });

  const handleGalleryUpload = async(event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if(!file) return;

    setError(null);

    try {
      if(!jsQR) {
        const jsQRModule = await import('jsqr');
        jsQR = jsQRModule.default;
      }

      const img = new Image();
      const url = URL.createObjectURL(file);

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if(!ctx) {
        setError('Failed to process image');
        URL.revokeObjectURL(url);
        return;
      }

      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if(code && code.data) {
        stopCamera();
        props.onScan(code.data);
      } else {
        setError('No QR code found in image');
      }
    } catch(err) {
      setError('Failed to process image');
    }

    // Reset file input so same file can be re-selected
    if(fileInputRef) fileInputRef.value = '';
  };

  return (
    <div class={classNames('nostra-qr-scanner', props.class)}>
      <div class="nostra-qr-scanner-header">
        <button
          class="nostra-qr-scanner-close"
          onClick={props.onClose}
        >
          X
        </button>
        <h3 class="nostra-qr-scanner-title">Scan QR Code</h3>
      </div>

      <div class="nostra-qr-scanner-content">
        {mode() === 'camera' && (
          <div class="nostra-qr-scanner-camera">
            <video
              ref={videoRef}
              class="nostra-qr-scanner-video"
              playsinline
              muted
            />
            <canvas
              ref={canvasRef}
              class="nostra-qr-scanner-canvas"
              style={{display: 'none'}}
            />
            <div class="nostra-qr-scanner-overlay">
              <div class="nostra-qr-scanner-frame" />
            </div>
          </div>
        )}

        {error() && (
          <div class="nostra-qr-scanner-error">
            {error()}
          </div>
        )}

        <div class="nostra-qr-scanner-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{display: 'none'}}
            onChange={handleGalleryUpload}
          />
          <button
            class="nostra-qr-scanner-btn"
            onClick={() => fileInputRef?.click()}
          >
            Upload from Gallery
          </button>
        </div>
      </div>
    </div>
  );
}
