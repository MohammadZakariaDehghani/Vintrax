'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Photo capture for a listing.
 *
 * Two paths on purpose. `getUserMedia` gives an in-page viewfinder with a
 * framing guide, which is what makes a set of listing photos consistent. But
 * it is not universally available — iOS refuses it inside an in-app browser,
 * any browser refuses it on an insecure origin, and a user can simply decline
 * the permission — so a plain file input with `capture` is always offered
 * alongside it. That fallback opens the system camera app, which works
 * everywhere, and it is the only path when the stream is unavailable.
 *
 * Nothing is uploaded here. The caller decides what to do with the file, so
 * this component never touches the network.
 */

type Status = 'idle' | 'starting' | 'streaming' | 'denied' | 'unsupported' | 'error';

export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }

    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // `environment` asks for the rear camera. It is a hint, not a
        // guarantee — a laptop has only one — so nothing here depends on it.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // iOS will not autoplay an inline video without this being set before
        // play() is called.
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus('streaming');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  // A revoked object URL leaks memory on a device that has little of it.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setPreview({ url: URL.createObjectURL(file), file });
        stop();
      },
      'image/jpeg',
      // Enough for a listing photo; higher costs upload time on cellular for
      // detail nobody sees on a phone screen.
      0.85,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <header
        className="flex items-center justify-between px-3 py-2 text-white"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <h2 className="text-base font-semibold">Add a photo</h2>
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label="Close camera"
          className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg active:bg-white/20"
        >
          <X aria-hidden className="h-6 w-6" />
        </button>
      </header>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from the camera, not a remote asset
          <img src={preview.url} alt="Photo just taken" className="max-h-full max-w-full" />
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
              aria-label="Camera viewfinder"
            />
            {status === 'streaming' ? (
              // A framing guide, so photos across a listing are composed alike.
              <div
                aria-hidden
                className="pointer-events-none absolute inset-6 rounded-xl border-2 border-white/70"
              />
            ) : null}
          </>
        )}

        {status !== 'streaming' && !preview ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <Camera aria-hidden className="h-10 w-10 opacity-80" />
            <p className="text-sm">{message(status)}</p>
          </div>
        ) : null}
      </div>

      <footer
        className="space-y-3 p-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {preview ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="large"
              className="border-white/40 text-white"
              onClick={() => {
                URL.revokeObjectURL(preview.url);
                setPreview(null);
                void start();
              }}
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
              Retake
            </Button>
            <Button
              size="large"
              fullWidth
              onClick={() => {
                onCapture(preview.file);
                onClose();
              }}
            >
              Use photo
            </Button>
          </div>
        ) : (
          <>
            {status === 'streaming' ? (
              <button
                type="button"
                onClick={capture}
                aria-label="Take photo"
                className="mx-auto flex h-18 w-18 items-center justify-center rounded-full border-4 border-white active:scale-95"
                style={{ height: '4.5rem', width: '4.5rem' }}
              >
                <span aria-hidden className="h-14 w-14 rounded-full bg-white" />
              </button>
            ) : null}

            {/* Always available: the system camera app works where the stream
                does not, and some people simply prefer their own gallery. */}
            <label className="flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/40 px-4 text-sm font-medium text-white">
              <ImagePlus aria-hidden className="h-4 w-4" />
              {status === 'streaming' ? 'Choose from library' : 'Use the system camera'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  stop();
                  onCapture(file);
                  onClose();
                }}
              />
            </label>
          </>
        )}
      </footer>
    </div>
  );
}

function message(status: Status): string {
  switch (status) {
    case 'starting':
      return 'Starting the camera…';
    case 'denied':
      return 'Camera access was declined. You can allow it in your browser settings, or use the system camera below.';
    case 'unsupported':
      return 'This browser cannot open a camera in the page. Use the system camera below.';
    case 'error':
      return 'The camera could not be started. Use the system camera below.';
    default:
      return 'Preparing…';
  }
}
