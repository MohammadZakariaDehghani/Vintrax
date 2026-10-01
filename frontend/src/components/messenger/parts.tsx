'use client';

import { Car } from 'lucide-react';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/messenger';
import { IMAGE_SIZES, OptimizedImage } from '@/components/optimized-image';

/** A few calm tints, picked from the person's id so they keep their colour. */
const TINTS = [
  'bg-primary/15 text-primary',
  'bg-accent/15 text-accent',
  'bg-success/15 text-success',
  'bg-warning/20 text-warning',
  'bg-destructive/12 text-destructive',
];

function tintFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

/** A person's round avatar: their initials on a colour of their own. */
export function Avatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-xs font-bold',
        tintFor(id),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** The car's photo, cropped to fill; a car icon when the listing has none. */
export function CarPhoto({ src, className }: { src: string | null; className?: string }) {
  return (
    <span className={cn('block shrink-0 overflow-hidden bg-muted', className)}>
      {src ? (
        <OptimizedImage
          image={null}
          src={src}
          alt=""
          sizes={IMAGE_SIZES.thumb}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-muted-foreground">
          <Car className="h-1/2 w-1/2" aria-hidden />
        </span>
      )}
    </span>
  );
}
