'use client';

import { useEffect, useRef, useState } from 'react';
import { Monitor, RotateCcw, Smartphone } from 'lucide-react';
import type { ArticleSummary, HomeFeature, HomeHero, PromoTile } from '@vintrax/shared';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

/** What a preview frame can draw: the same components the home page uses. */
export type PreviewPayload =
  | { kind: 'hero'; hero: HomeHero }
  | { kind: 'feature'; feature: HomeFeature }
  | { kind: 'boxes'; tiles: PromoTile[] }
  | { kind: 'article'; article: ArticleSummary };

export const PREVIEW_MESSAGE = 'vintrax:preview';
export const PREVIEW_READY = 'vintrax:preview-ready';

const DEVICES = {
  desktop: { width: 1280, height: 720, label: 'Computer', icon: Monitor },
  mobile: { width: 390, height: 720, label: 'Phone', icon: Smartphone },
} as const;
type Device = keyof typeof DEVICES;

/**
 * A live preview of unsaved content, at a computer's width and a phone's.
 *
 * The content is drawn in a same-origin frame (`/admin/preview`) that really
 * is 1280 or 390 pixels wide, then scaled to fit here — so breakpoints, the
 * phone media, crops and animations are the site's own, not an imitation.
 * The editor posts every change to the frame; nothing is saved by previewing.
 */
export function LivePreview({ payload }: { payload: PreviewPayload | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [replay, setReplay] = useState(0);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type === PREVIEW_READY) setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!ready || !payload) return;
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, payload, replay },
      window.location.origin,
    );
  }, [ready, payload, replay]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const size = DEVICES[device];
  const scale = available ? Math.min(1, available / size.width) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-md border border-border p-0.5"
          role="radiogroup"
          aria-label="Preview size"
        >
          {(Object.keys(DEVICES) as Device[]).map((option) => {
            const Icon = DEVICES[option].icon;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={device === option}
                onClick={() => setDevice(option)}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
                  device === option
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {DEVICES[option].label}
              </button>
            );
          })}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setReplay((n) => n + 1)}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Replay animation
        </Button>
      </div>

      <div ref={box} className="w-full">
        <div
          className="mx-auto overflow-hidden rounded-lg border border-border bg-background shadow-sm"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <iframe
            ref={frame}
            src="/admin/preview"
            title={`Preview at ${DEVICES[device].label.toLowerCase()} size`}
            className="origin-top-left border-0"
            style={{
              width: size.width,
              height: size.height,
              transform: `scale(${scale})`,
              visibility: scale ? 'visible' : 'hidden',
            }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A preview of your unsaved changes, drawn by the site itself. It is not public until you save
        it as active.
      </p>
    </div>
  );
}
