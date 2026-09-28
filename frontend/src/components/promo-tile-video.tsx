'use client';

import { useEffect, useRef, useState } from 'react';

/** How much of the tile must be on screen before it plays, and below which it pauses. */
const PLAY_AT = 0.25;

/**
 * A promo tile's video: the media only. The tile around it — its width,
 * height, grid span, order, rounded corners and how it scales — belongs to
 * `PromoTileRow` and is the same one an image tile gets, so the video fills
 * exactly the box the photo would have.
 *
 * It behaves like a moving photograph: muted, looping, inline, with no
 * controls of any kind. It downloads nothing until the tile is near the
 * screen (`preload="none"` with a poster), plays while at least a quarter of
 * it is visible, and pauses when it scrolls away. A visitor who asked for
 * reduced motion gets the poster and no video at all. If the video cannot
 * load, the poster — or failing that the tile's photo — takes its place, so
 * the box is never empty.
 */
export function PromoTileVideo({
  src,
  poster,
  fallbackImageUrl,
  className,
}: {
  src: string;
  poster: string | null;
  fallbackImageUrl: string | null;
  className: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const video = ref.current;
    if (!video || reducedMotion || failed) return;
    // Set as a property as well as the attribute: some browsers only allow a
    // muted video to start without a gesture if the property is true.
    video.muted = true;

    if (typeof IntersectionObserver === 'undefined') {
      void video.play().catch(() => undefined);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= PLAY_AT) {
          // A refused play (a power-saving mode, say) leaves the poster showing.
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: [0, PLAY_AT, 0.5, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [reducedMotion, failed, src]);

  const still = poster ?? fallbackImageUrl;

  if (failed || reducedMotion) {
    return still ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={still} alt="" loading="lazy" className={className} />
    ) : null;
  }

  return (
    <video
      ref={ref}
      src={src}
      poster={still ?? undefined}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      disableRemotePlayback
      controls={false}
      aria-hidden
      tabIndex={-1}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
