import { Film } from 'lucide-react';
import type { MediaKind, MediaSource } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/** A small still of a picture or video for the admin: the image, or the video's poster. */
export function MediaThumb({
  kind,
  source,
  className,
}: {
  kind: MediaKind;
  source: Pick<MediaSource, 'url' | 'posterUrl'> | null;
  className?: string;
}) {
  const still = source ? (kind === 'VIDEO' ? source.posterUrl : source.url) : null;
  return (
    <div className={cn('relative overflow-hidden rounded bg-muted', className)}>
      {still ? (
        // eslint-disable-next-line @next/next/no-img-element -- an operator upload
        <img src={still} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : null}
      {kind === 'VIDEO' ? (
        <Film
          className="absolute bottom-1 right-1 h-4 w-4 text-white drop-shadow"
          aria-label="Video"
        />
      ) : null}
    </div>
  );
}
