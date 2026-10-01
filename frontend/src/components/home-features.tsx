import { homeFeatureMedia, type HomeFeature } from '@vintrax/shared';
import { cn } from '@/lib/utils';
import { CtaLink } from '@/components/media/cta-link';
import { ResponsiveMedia } from '@/components/media/responsive-media';
import { SECTION_REVEAL, revealProps, type MediaVariant } from '@/components/media/media-style';

const BUTTON =
  'inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90';

const TEXT_ALIGN: Record<string, string> = {
  TEXT_LEFT: 'justify-start',
  TEXT_CENTER: 'justify-center',
  TEXT_RIGHT: 'justify-end',
};

/** Blank lines separate paragraphs; nothing is read as markup. */
function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {text
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph.trim()}
          </p>
        ))}
    </div>
  );
}

function hasButton(
  feature: HomeFeature,
): feature is HomeFeature & { buttonLabel: string; buttonUrl: string } {
  return Boolean(feature.buttonLabel && feature.buttonUrl);
}

/**
 * The full-width cinematic layout: the picture or video edge to edge, with
 * the words — real text — over a shade at the bottom, aligned where the
 * button placement says.
 */
function FullBleedFeature({ feature, variant }: { feature: HomeFeature; variant: MediaVariant }) {
  const media = homeFeatureMedia(feature);
  const align = feature.buttonPlacement;
  const centered = align === 'TEXT_CENTER' || align === 'ON_IMAGE';
  const right = align === 'TEXT_RIGHT';

  return (
    <article
      aria-label={feature.title}
      className="relative isolate flex h-[78svh] min-h-[26rem] max-h-[46rem] w-full items-end overflow-hidden bg-[hsl(0_12%_9%)]"
    >
      <div className="absolute inset-0" {...revealProps(media?.animation ?? { type: 'FADE' })}>
        {media ? (
          <ResponsiveMedia
            media={media}
            sizes="100vw"
            controls
            variant={variant}
            className="absolute inset-0 h-full w-full"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[hsl(0_12%_9%)]/85 via-[hsl(0_12%_9%)]/30 to-transparent" />
      </div>

      <div
        className={cn(
          'container pointer-events-none relative pb-12 pt-24 md:pb-16 [&_a]:pointer-events-auto',
          centered && 'text-center',
          right && 'text-right',
        )}
      >
        <div className={cn('max-w-2xl', centered && 'mx-auto', right && 'ml-auto')}>
          {feature.subtitle ? (
            <p
              className="text-sm font-semibold uppercase tracking-[0.18em] text-white/75"
              {...revealProps(SECTION_REVEAL, { index: 0 })}
            >
              {feature.subtitle}
            </p>
          ) : null}
          <h3
            className="mt-2 text-3xl font-bold leading-[1.05] tracking-tight text-white sm:text-4xl md:text-5xl"
            {...revealProps(SECTION_REVEAL, { index: 1 })}
          >
            {feature.title}
          </h3>
          {feature.body ? (
            <div {...revealProps(SECTION_REVEAL, { index: 2 })}>
              <Paragraphs text={feature.body} className="mt-4 text-white/85 md:text-lg" />
            </div>
          ) : null}
          {hasButton(feature) ? (
            <div
              className={cn('mt-6 flex', centered && 'justify-center', right && 'justify-end')}
              {...revealProps(SECTION_REVEAL, { index: 3 })}
            >
              <CtaLink href={feature.buttonUrl} className={BUTTON}>
                {feature.buttonLabel}
              </CtaLink>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * One feature block beside its picture or video, with the button where the
 * administrator put it — under the text (left, centred or right) or over the
 * media. Blocks alternate sides down the page so a stack of them reads as a
 * column of stories rather than a repeated card.
 */
export function HomeFeatureBlock({
  feature,
  flip = false,
  variant = 'auto',
}: {
  feature: HomeFeature;
  flip?: boolean;
  /** Forces the desktop or phone media, for the admin preview frames. */
  variant?: MediaVariant;
}) {
  if (feature.layout === 'FULL_BLEED')
    return <FullBleedFeature feature={feature} variant={variant} />;

  const media = homeFeatureMedia(feature);
  const onImage = hasButton(feature) && feature.buttonPlacement === 'ON_IMAGE' && media;

  return (
    <article
      className={cn(
        'grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2',
        !media && 'md:grid-cols-1',
      )}
    >
      {media ? (
        <div
          className={cn(
            'relative aspect-[16/9] w-full overflow-hidden bg-muted md:aspect-auto md:min-h-[18rem]',
            flip && 'md:order-2',
          )}
          {...revealProps(media.animation)}
        >
          <ResponsiveMedia
            media={media}
            sizes="(min-width: 768px) 50vw, 100vw"
            controls={!onImage}
            variant={variant}
            className="absolute inset-0 h-full w-full"
          />
          {onImage ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/60 to-transparent p-5 pt-12">
              <CtaLink href={feature.buttonUrl!} className={BUTTON}>
                {feature.buttonLabel}
              </CtaLink>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col justify-center gap-3 p-6 md:p-10">
        {feature.subtitle ? (
          <p
            className="text-xs font-semibold uppercase tracking-[0.16em] text-primary"
            {...revealProps(SECTION_REVEAL, { index: 0 })}
          >
            {feature.subtitle}
          </p>
        ) : null}
        <h3
          className="text-2xl font-bold leading-tight tracking-tight md:text-3xl"
          {...revealProps(SECTION_REVEAL, { index: 1 })}
        >
          {feature.title}
        </h3>
        {feature.body ? (
          <div {...revealProps(SECTION_REVEAL, { index: 2 })}>
            <Paragraphs text={feature.body} className="text-muted-foreground" />
          </div>
        ) : null}
        {hasButton(feature) && !onImage ? (
          <div
            className={cn('mt-2 flex', TEXT_ALIGN[feature.buttonPlacement] ?? 'justify-start')}
            {...revealProps(SECTION_REVEAL, { index: 3 })}
          >
            <CtaLink href={feature.buttonUrl} className={BUTTON}>
              {feature.buttonLabel}
            </CtaLink>
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The feature blocks under "Recently listed", in the order an administrator
 * set under Admin → Home features: beside-the-text blocks inside the page's
 * column, full-width ones edge to edge. Not a slideshow, and separate from
 * the blog.
 */
export function HomeFeatures({ features }: { features: HomeFeature[] }) {
  if (features.length === 0) return null;
  let split = 0;
  return (
    <section aria-label="Featured" className="flex flex-col gap-8 pb-12">
      {features.map((feature) =>
        feature.layout === 'FULL_BLEED' ? (
          <HomeFeatureBlock key={feature.id} feature={feature} />
        ) : (
          <div key={feature.id} className="container">
            <HomeFeatureBlock feature={feature} flip={split++ % 2 === 1} />
          </div>
        ),
      )}
    </section>
  );
}
