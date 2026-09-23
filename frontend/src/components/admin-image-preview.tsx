'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * An admin-uploaded image (make logo, partner logo, body-type photo), with a
 * legible fallback when it 404s — a storage-routing gap in one deployment
 * target, a deleted file the record still points at — instead of the
 * browser's own broken-image glyph sitting in an otherwise-empty preview box.
 * The same failure `BrandLogo` guards against on the public side, but here
 * there is no maker's mark to fall back to, so the fallback just says so.
 */
export function AdminImagePreview({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-1 text-muted-foreground">
        <ImageOff className="h-6 w-6" aria-hidden />
        <span className="text-xs">Image failed to load</span>
      </div>
    );
  }

  return (
    // Same-origin uploads, already sized for their preview box; next/image
    // optimisation adds a hop without a benefit.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={cn(className)} onError={() => setFailed(true)} />
  );
}
