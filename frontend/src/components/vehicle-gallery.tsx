'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { VehicleImage } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * A listing's photographs.
 *
 * Laid out as a large frame with two stacked beside it, which is the shape a
 * dealer feed actually fills: an imported vehicle arrives with two dozen
 * photos, and a row of twenty-four thumbnails under the hero is a scrollbar
 * rather than a gallery. The second stacked frame carries the count of what is
 * not on screen, so the rest is one click away instead of hidden.
 *
 * The strip below stays, because it is how someone works through the set once
 * they have opened it — but it only appears past the three the layout shows.
 */
export function VehicleGallery({ images, title }: { images: VehicleImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);

  if (images.length === 0) {
    return (
      <div className="grid aspect-[16/10] place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
        No photos provided
      </div>
    );
  }

  const index = Math.min(active, images.length - 1);
  const current = images[index]!;

  // Wrapping rather than stopping at the ends. A gallery of two dozen imported
  // photos is browsed in a loop, and a next button that goes dead on the last
  // one reads as broken rather than as a boundary.
  const step = (by: number) => setActive((index + by + images.length) % images.length);
  // The two beside the hero are the next two, so they change with it rather
  // than sitting on the first three for the whole visit.
  const beside = [images[(index + 1) % images.length], images[(index + 2) % images.length]].filter(
    (image): image is VehicleImage => Boolean(image),
  );
  const remaining = Math.max(0, images.length - 3);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div
          className="relative overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          role="group"
          aria-label={`${title} photographs`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              step(-1);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              step(1);
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.url}
            alt={current.alt ?? title}
            className="aspect-[4/3] w-full object-cover"
          />
          <p className="absolute bottom-3 left-3 rounded-md bg-background/85 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            Photo {index + 1} / {images.length}
          </p>

          {/* On the photo itself, per issue #34. Arrow keys work too, because
              the frame is focusable — someone looking through two dozen photos
              should not have to aim at a button each time. */}
          {images.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous photo"
                onClick={() => step(-1)}
                className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Next photo"
                onClick={() => step(1)}
                className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <ChevronRight className="h-5 w-5" aria-hidden />
              </button>
            </>
          ) : null}
        </div>

        {images.length > 1 ? (
          <div className="grid grid-rows-2 gap-3">
            {beside.map((image, offset) => {
              const target = (index + offset + 1) % images.length;
              const isLast = offset === beside.length - 1 && remaining > 0;

              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => (isLast ? setExpanded(true) : setActive(target))}
                  aria-label={
                    isLast ? `Show all ${images.length} photos` : `View photo ${target + 1}`
                  }
                  className="relative overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {isLast ? (
                    <span className="absolute inset-0 grid place-items-center bg-background/70 text-sm font-medium">
                      +{remaining} photos
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {images.length > 3 && expanded ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((image, position) => (
            <button
              key={image.id}
              type="button"
              aria-current={position === index}
              aria-label={`View photo ${position + 1} of ${images.length}`}
              onClick={() => setActive(position)}
              className={cn(
                'h-16 w-24 overflow-hidden rounded-md border-2 transition-colors',
                position === index ? 'border-primary' : 'border-transparent hover:border-border',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
