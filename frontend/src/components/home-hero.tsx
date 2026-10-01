import type { CSSProperties } from 'react';
import type { HomeHero as HomeHeroContent, HomeHeroHeight } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { CtaLink } from '@/components/media/cta-link';
import { ResponsiveMedia } from '@/components/media/responsive-media';
import type { MediaVariant } from '@/components/media/media-style';

/**
 * Heights by screen, as a share of the *small* viewport height (`svh`), so a
 * phone's collapsing address bar never makes the band jump. Floors keep the
 * words from crowding on a short window; ceilings keep a 4K monitor from
 * turning the band into a wall.
 */
const HEIGHT: Record<HomeHeroHeight, string> = {
  MEDIUM: 'h-[58svh] min-h-[24rem] max-h-[40rem]',
  LARGE: 'h-[78svh] min-h-[28rem] max-h-[52rem]',
  FULL: 'h-[calc(100svh-4rem)] min-h-[30rem]',
};

export const HERO_PRIMARY_BUTTON =
  'pointer-events-auto inline-flex h-12 items-center justify-center gap-2 rounded-md bg-accent px-6 text-sm font-bold text-accent-foreground shadow-lg shadow-black/20 transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
export const HERO_SECONDARY_BUTTON =
  'pointer-events-auto inline-flex h-12 items-center justify-center gap-2 rounded-md border border-white/70 px-6 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-[hsl(0_12%_9%)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

/**
 * The home page hero: a full-width picture or silent looping video under a
 * headline and up to two buttons — all real text, never baked into the media.
 *
 * Above the fold, so its media is the page's largest paint: fetched eagerly,
 * a video's poster first. The words settle in on load in CSS (`hero-enter`),
 * before any script has run, and stay still for reduced motion. `className`
 * leaves room at the bottom for the search card that overlaps the band.
 *
 * `variant` forces the desktop or phone media, for the admin preview frames.
 */
export function HomeHero({
  hero,
  className,
  variant = 'auto',
  headingLevel = 'h1',
}: {
  hero: HomeHeroContent;
  className?: string;
  variant?: MediaVariant;
  headingLevel?: 'h1' | 'h2';
}) {
  const Heading = headingLevel;
  const centered = hero.align === 'CENTER';
  const delay = (ms: number) => ({ '--hero-delay': `${ms}ms` }) as CSSProperties;

  return (
    <section
      aria-labelledby="home-hero-title"
      className={cn(
        'relative isolate w-full overflow-hidden bg-[hsl(0_12%_9%)]',
        HEIGHT[hero.height],
        className,
      )}
    >
      {/* Media, shades and the video's pause button share one layer; the words
          sit above it and let clicks through except on their own buttons. */}
      <div className="hero-media-enter absolute inset-0">
        {hero.media ? (
          <ResponsiveMedia
            media={hero.media}
            sizes="100vw"
            priority
            controls
            // Top corner: the search card overlaps the band's bottom edge.
            controlsClassName="right-4 top-4"
            variant={variant}
            className="absolute inset-0 h-full w-full"
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-0 bg-[hsl(0_12%_9%)]"
          style={{ opacity: hero.overlayOpacity / 100 }}
        />
        {/* A second, directional shade where the words are, so a bright frame
            of video never washes them out. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0',
            centered
              ? 'bg-gradient-to-t from-[hsl(0_12%_9%)]/70 via-transparent to-transparent'
              : 'bg-gradient-to-r from-[hsl(0_12%_9%)]/75 via-[hsl(0_12%_9%)]/25 to-transparent',
          )}
        />
      </div>

      {/* The words sit in the band's lower part, anchored to the bottom: if
          the display font arrives late on a slow connection and the headline
          wraps differently, only the headline moves — the line under it and
          the buttons stay where the visitor is about to tap. */}
      <div
        className={cn(
          'container pointer-events-none relative flex h-full flex-col justify-end pb-10 pt-24 md:pb-16',
          centered && 'items-center text-center',
        )}
      >
        <div className={cn('max-w-2xl', centered && 'mx-auto')}>
          <Heading
            id="home-hero-title"
            className="hero-enter text-4xl font-bold uppercase leading-[1.05] tracking-tight text-white drop-shadow-sm sm:text-5xl md:text-6xl"
          >
            {hero.title}
          </Heading>
          {hero.subtitle ? (
            <p
              className="hero-enter mt-4 text-base leading-relaxed text-white/85 md:text-xl"
              style={delay(120)}
            >
              {hero.subtitle}
            </p>
          ) : null}
          {hero.primaryCtaUrl || hero.secondaryCtaUrl ? (
            <div
              className={cn(
                // Stacked on a phone rather than wrapping: whether two buttons
                // fit on one line would otherwise change as the web font
                // arrives, moving everything around them.
                'hero-enter mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center',
                centered && 'sm:justify-center',
              )}
              style={delay(240)}
            >
              {hero.primaryCtaLabel && hero.primaryCtaUrl ? (
                <CtaLink href={hero.primaryCtaUrl} className={HERO_PRIMARY_BUTTON}>
                  {hero.primaryCtaLabel}
                </CtaLink>
              ) : null}
              {hero.secondaryCtaLabel && hero.secondaryCtaUrl ? (
                <CtaLink href={hero.secondaryCtaUrl} className={HERO_SECONDARY_BUTTON} icon={false}>
                  {hero.secondaryCtaLabel}
                </CtaLink>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
