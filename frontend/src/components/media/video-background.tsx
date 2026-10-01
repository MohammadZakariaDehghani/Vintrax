'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import type { MediaPresentation } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { MediaImage } from './media-image';
import { PHONE_QUERY, type MediaVariant } from './media-style';

/** How much of the video must be on screen before it plays, and below which it pauses. */
const PLAY_AT = 0.25;

/** Connections on which a moving background is not worth the data: the poster stays. */
function prefersLessData(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '');
}

/**
 * The file to play: the mobile video on a phone, else the desktop video's
 * phone-sized rendition (made at upload), else the desktop video itself.
 */
function chooseSource(media: MediaPresentation, phone: boolean): string {
  if (!phone) return media.desktop.url;
  return media.mobile?.url ?? media.desktop.smallUrl ?? media.desktop.url;
}

/**
 * A silent background video from the media system — the hero, a feature, a
 * home box — behaving like a moving photograph.
 *
 * - **Never downloads early.** `preload="none"`; it is only asked to play once
 *   a quarter of it is on screen, and pauses when it scrolls away or the tab
 *   is hidden.
 * - **Right-sized.** On a phone it plays the mobile video, or the desktop
 *   video's phone rendition; with Data Saver on, or on a 2G connection, it
 *   does not play by itself at all.
 * - **Never a blank box.** The poster is drawn underneath as a responsive
 *   picture (the page's largest paint, for the hero), so it shows while the
 *   video loads, if it fails, and for visitors who asked for reduced motion.
 * - **No browser chrome.** No controls, no download or picture-in-picture
 *   menu, no casting, no context menu. That deters casual saving only; see
 *   documentation/media-system.md for what it cannot do.
 * - **Pausable.** With `controls`, a small button pauses and resumes it —
 *   moving content longer than five seconds needs one (WCAG 2.2.2). Off for a
 *   home box, which is itself a link a button cannot sit inside.
 */
export function VideoBackground({
  media,
  className,
  style,
  sizes = '100vw',
  priority = false,
  controls = false,
  controlsClassName = 'bottom-4 right-4',
  suspended = false,
  variant = 'auto',
}: {
  media: MediaPresentation;
  /** Applied to the poster and the video alike: both fill the caller's box. */
  className: string;
  style?: CSSProperties;
  sizes?: string;
  priority?: boolean;
  controls?: boolean;
  /** Where the pause button sits, when something overlaps the default corner. */
  controlsClassName?: string;
  /** Held paused whatever else is true — a slideshow's hidden slides. */
  suspended?: boolean;
  variant?: MediaVariant;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState(() => chooseSource(media, variant === 'mobile'));
  const [failed, setFailed] = useState(false);
  /** Whether it may start by itself: autoplay on, motion allowed, data not scarce. */
  const [mayAutoplay, setMayAutoplay] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** A visitor's pause wins over scrolling back into view. */
  const userPaused = useRef(false);
  const visible = useRef(false);

  // Pick the file for this screen, and whether it may play by itself.
  useEffect(() => {
    const phoneQuery = window.matchMedia?.(PHONE_QUERY);
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      const phone = variant === 'mobile' || (variant === 'auto' && Boolean(phoneQuery?.matches));
      setSrc(chooseSource(media, phone));
      setMayAutoplay(media.autoplay && !motionQuery?.matches && !prefersLessData());
    };
    update();
    phoneQuery?.addEventListener?.('change', update);
    motionQuery?.addEventListener?.('change', update);
    return () => {
      phoneQuery?.removeEventListener?.('change', update);
      motionQuery?.removeEventListener?.('change', update);
    };
  }, [media, variant]);

  // Play while on screen and the tab is visible; pause otherwise.
  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;
    // Set as a property too: some browsers only let a muted video start on
    // its own when the property, not just the attribute, is true.
    video.muted = true;

    const sync = () => {
      const shouldPlay =
        !suspended &&
        visible.current &&
        !document.hidden &&
        !userPaused.current &&
        (mayAutoplay || playing);
      if (shouldPlay && video.paused) {
        // A refused play (a power-saving mode, say) leaves the poster showing.
        void video.play().catch(() => undefined);
      } else if (!shouldPlay && !video.paused) {
        video.pause();
      }
    };

    if (typeof IntersectionObserver === 'undefined') {
      visible.current = true;
      sync();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible.current = Boolean(entry && entry.intersectionRatio >= PLAY_AT);
        sync();
      },
      { threshold: [0, PLAY_AT, 0.5, 1] },
    );
    observer.observe(video);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [failed, mayAutoplay, playing, src, suspended]);

  const poster = media.desktop.posterUrl
    ? {
        desktop: { ...media.desktop, url: media.desktop.posterUrl, image: null },
        mobile: media.mobile?.posterUrl
          ? { ...media.mobile, url: media.mobile.posterUrl, image: null }
          : null,
      }
    : null;

  const toggle = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) {
      userPaused.current = false;
      setPlaying(true);
      void video.play().catch(() => undefined);
    } else {
      userPaused.current = true;
      setPlaying(false);
      video.pause();
    }
  };

  return (
    <>
      {poster ? (
        <MediaImage
          desktop={poster.desktop}
          mobile={poster.mobile}
          alt=""
          sizes={sizes}
          priority={priority}
          variant={variant}
          className={className}
          style={style}
        />
      ) : null}
      {failed ? null : (
        <video
          ref={ref}
          src={src}
          muted
          loop={media.loop}
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
          aria-hidden
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          className={className}
          style={style}
        />
      )}
      {controls && !failed ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause the background video' : 'Play the background video'}
          className={cn(
            'absolute z-20 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-opacity hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
            controlsClassName,
            !playing && mayAutoplay && 'opacity-80',
          )}
        >
          {playing ? (
            <Pause className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="h-4 w-4 translate-x-px" aria-hidden />
          )}
        </button>
      ) : null}
    </>
  );
}
