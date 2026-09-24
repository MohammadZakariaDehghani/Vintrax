import Link from 'next/link';
import { ArrowRight, ExternalLink } from 'lucide-react';
import type { HomeFeature } from '@vintrax/shared';
import { cn } from '@/lib/utils';

/** A site path goes through Next's router; a website opens in its own tab. */
function FeatureButton({
  feature,
  className,
}: {
  feature: HomeFeature & { buttonLabel: string; buttonUrl: string };
  className?: string;
}) {
  const classes = cn(
    'inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90',
    className,
  );
  if (feature.buttonUrl.startsWith('/')) {
    return (
      <Link href={feature.buttonUrl} className={classes}>
        {feature.buttonLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    );
  }
  return (
    <a href={feature.buttonUrl} target="_blank" rel="noopener noreferrer" className={classes}>
      {feature.buttonLabel}
      <ExternalLink className="h-4 w-4" aria-hidden />
    </a>
  );
}

const TEXT_ALIGN: Record<string, string> = {
  TEXT_LEFT: 'justify-start',
  TEXT_CENTER: 'justify-center',
  TEXT_RIGHT: 'justify-end',
};

/**
 * One feature block: the photograph beside the title and text, and the button
 * where the administrator put it — under the text (left, centred or right) or
 * over the photograph. Blocks alternate sides down the page so a stack of
 * them reads as a column of stories rather than a repeated card.
 */
export function HomeFeatureBlock({
  feature,
  flip = false,
}: {
  feature: HomeFeature;
  flip?: boolean;
}) {
  const hasButton = Boolean(feature.buttonLabel && feature.buttonUrl);
  const buttonFeature = feature as HomeFeature & { buttonLabel: string; buttonUrl: string };
  const onImage = hasButton && feature.buttonPlacement === 'ON_IMAGE' && feature.imageUrl;

  return (
    <article
      className={cn(
        'grid overflow-hidden rounded-lg border border-border bg-card md:grid-cols-2',
        !feature.imageUrl && 'md:grid-cols-1',
      )}
    >
      {feature.imageUrl ? (
        <div
          className={cn(
            'relative aspect-[16/9] w-full overflow-hidden bg-muted md:aspect-auto md:min-h-[16rem]',
            flip && 'md:order-2',
          )}
        >
          {/* An operator upload served from the API origin. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={feature.imageUrl}
            alt={feature.imageAlt ?? ''}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {onImage ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/60 to-transparent p-5 pt-12">
              <FeatureButton feature={buttonFeature} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col justify-center gap-3 p-6 md:p-8">
        <h3 className="text-2xl font-bold leading-tight tracking-tight">{feature.title}</h3>
        {feature.body ? (
          <div className="space-y-2 text-muted-foreground">
            {feature.body
              .split(/\n\s*\n/)
              .filter((paragraph) => paragraph.trim())
              .map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph.trim()}
                </p>
              ))}
          </div>
        ) : null}
        {hasButton && !onImage ? (
          <div className={cn('mt-2 flex', TEXT_ALIGN[feature.buttonPlacement] ?? 'justify-start')}>
            <FeatureButton feature={buttonFeature} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The feature blocks under "Recently listed", stacked one under another in
 * the order an administrator set under Admin → Home features. Not a
 * slideshow, and separate from the blog.
 */
export function HomeFeatures({ features }: { features: HomeFeature[] }) {
  if (features.length === 0) return null;
  return (
    <section aria-label="Featured" className="container flex flex-col gap-6 pb-12">
      {features.map((feature, index) => (
        <HomeFeatureBlock key={feature.id} feature={feature} flip={index % 2 === 1} />
      ))}
    </section>
  );
}
