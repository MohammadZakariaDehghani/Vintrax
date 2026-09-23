'use client';

import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import type { VehicleImage } from '@vintrax/shared';
import { cn } from '@/lib/format';
import { OptimizedImage } from '@/components/optimized-image';

/**
 * Swipeable photo gallery.
 *
 * Native scroll-snap rather than a carousel library: it is the interaction the
 * platform already implements, so it is smooth on a low-end phone and works
 * with the browser's own momentum scrolling.
 */
export function Gallery({ images, title }: { images: VehicleImage[]; title: string }) {
  const [index, setIndex] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground">
        <Camera aria-hidden className="h-10 w-10" />
        <span className="sr-only">No photos for this vehicle</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={railRef}
        className="no-scrollbar snap-rail flex aspect-[4/3] overflow-x-auto"
        onScroll={(event) => {
          const { scrollLeft, clientWidth } = event.currentTarget;
          setIndex(Math.round(scrollLeft / clientWidth));
        }}
        role="group"
        aria-roledescription="carousel"
        aria-label={`Photos of ${title}`}
      >
        {images.map((image, position) => (
          <div key={image.id} className="relative h-full w-full shrink-0">
            <OptimizedImage
              image={image.optimized}
              src={image.url}
              alt={image.alt ?? `${title}, photo ${position + 1} of ${images.length}`}
              sizes="(max-width: 512px) 100vw, 512px"
              className="object-cover"
              // The first photo is the largest thing above the fold, so it is
              // the one worth prioritising.
              priority={position === 0}
            />
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <div
          className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5"
          aria-hidden
        >
          {images.map((image, position) => (
            <span
              key={image.id}
              className={cn(
                'h-1.5 rounded-full bg-white/60 transition-all',
                position === index ? 'w-4 bg-white' : 'w-1.5',
              )}
            />
          ))}
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        Photo {index + 1} of {images.length}
      </span>
    </div>
  );
}
