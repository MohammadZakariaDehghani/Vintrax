'use client';

import { useState } from 'react';
import type { VehicleImage } from '@vintrax/shared';
import { cn } from '@/lib/utils';

export function VehicleGallery({ images, title }: { images: VehicleImage[]; title: string }) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="grid aspect-[16/10] place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
        No photos provided
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)]!;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.alt ?? title}
          className="aspect-[16/10] w-full object-cover"
        />
      </div>

      {images.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              aria-current={index === active}
              aria-label={`View photo ${index + 1} of ${images.length}`}
              onClick={() => setActive(index)}
              className={cn(
                'h-16 w-24 overflow-hidden rounded-md border-2 transition-colors',
                index === active ? 'border-primary' : 'border-transparent hover:border-border',
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
