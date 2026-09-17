import { ChevronRight } from 'lucide-react';
import {
  CARFAX_HIGHLIGHT_LABELS,
  carfaxHighlightsFor,
  type CarfaxBadgeSource,
  type CarfaxHighlight,
} from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * A vehicle's CARFAX report, as one badge.
 *
 * One badge is the point, and is what issue-thread feedback asked for: a car
 * with a report and both highlights draws a single joined strip — the CARFAX
 * mark, then One Owner, then Low Kilometres — not three chips sitting next to
 * each other. Three chips read as three separate things a buyer has to weigh;
 * one strip reads as what it is, a single report saying three things. So the
 * segments share one border, one rounded outline and one link, and only the
 * outer edges are rounded. A car with nothing but a report draws the mark
 * alone, which is the same component with an empty highlight list.
 *
 * There is one chevron, at the end of the whole strip, rather than one per
 * segment as CARFAX prints them on separate badges. The strip is a single
 * link to a single report; a chevron between segments would advertise three
 * destinations and undo the joining.
 *
 * ── On the marks themselves ─────────────────────────────────────────────────
 *
 * These are CARFAX's registered marks, drawn here in CSS and inline SVG rather
 * than loaded from their brand assets, which Vintrax does not hold. That is a
 * licensing question for the owner, not a technical one, and it is recorded in
 * the decision log. Everything that draws them is in this file, so replacing
 * the recreation with official artwork is a change to one component.
 *
 * ── On what the badge asserts ───────────────────────────────────────────────
 *
 * The same thing it has always asserted: the seller supplied a report, and
 * here it is. Vintrax retrieves nothing from CARFAX and checks nothing — One
 * Owner and Low Kilometres are the seller's reading of their own report, the
 * way every line of the timeline is. What keeps that honest is that the badge
 * opens the report, so a buyer who doubts a segment can check it in the place
 * the claim came from; the API refuses a highlight with no link behind it for
 * exactly that reason.
 *
 * The URL is validated against the real CARFAX hosts before it is stored. A
 * badge carrying someone else's name pointed at an arbitrary address is a
 * phishing page wearing a brand the buyer already trusts.
 *
 * `rel="noopener noreferrer"` on a `_blank` link: without `noopener` the opened
 * page can reach back through `window.opener` and navigate this tab elsewhere.
 *
 * Deliberately a server component — no `'use client'`, and no event handler. It
 * is an anchor with a URL in it, so there is nothing for the client to do. It
 * briefly carried an `onClick` that called `stopPropagation`, which broke every
 * server-rendered listing outright (issue #37): a handler cannot be serialised
 * across that boundary. Where a card overlays this badge with a stretched link,
 * that is fixed where it lives, by giving the badge a stacking context above
 * the overlay — not by a handler that the click never reaches anyway.
 */
export function CarfaxBadge({
  vehicle,
  className,
  compact = false,
}: {
  vehicle: CarfaxBadgeSource;
  className?: string;
  compact?: boolean;
}) {
  const { carfaxUrl } = vehicle;
  if (!carfaxUrl) return null;

  const highlights = carfaxHighlightsFor(vehicle);

  return (
    <a
      href={carfaxUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={describe(highlights)}
      className={cn(
        // `overflow-hidden` is what makes the segments share the outline: each
        // one is a plain rectangle and the container clips the rounded corners.
        'inline-flex items-stretch overflow-hidden rounded-[3px] align-middle',
        // The mark ends in a white tile holding the maple leaf, and on a white
        // card that tile has no visible right edge — the badge appears to stop
        // at the X with the leaf floating beside it. The border closes it.
        // Inverted in dark mode, where a black hairline on a dark card is the
        // same problem the other way up.
        'border border-black/20 dark:border-white/20',
        'whitespace-nowrap leading-none transition-opacity hover:opacity-90',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        compact ? 'text-[9px]' : 'text-[11px]',
        className,
      )}
    >
      <CarfaxMark compact={compact} />

      {highlights.map((highlight) => (
        <span
          key={highlight}
          className={cn(
            'flex items-center font-semibold text-white',
            HIGHLIGHT_BACKGROUND[highlight],
            compact ? 'px-1.5' : 'px-2',
          )}
        >
          {CARFAX_HIGHLIGHT_LABELS[highlight]}
          <span aria-hidden className="ml-px align-super text-[0.7em]">
            &trade;
          </span>
        </span>
      ))}

      {/* One affordance for one link, at the end of the strip, and only when
          there is a highlight to end. CARFAX prints the chevron on the
          highlight badges and not on the mark itself, and a lone chevron after
          the white leaf tile reads as a second, detached button. */}
      {highlights.length > 0 ? (
        <span
          aria-hidden
          className={cn(
            'flex items-center pr-1 text-white',
            HIGHLIGHT_BACKGROUND[highlights[highlights.length - 1]!],
          )}
        >
          <ChevronRight className="h-[1em] w-[1em]" strokeWidth={2.5} />
        </span>
      ) : null}
    </a>
  );
}

/**
 * The CARFAX Canada mark: the wordmark on black, then the maple leaf on white.
 *
 * The letters sit in their own cells divided by hairlines, which is the plate
 * motif the real mark uses. Drawn as elements rather than as one image so it
 * stays sharp at any size and scales with the badge's own type scale.
 */
function CarfaxMark({ compact }: { compact: boolean }) {
  return (
    <span className="flex items-stretch bg-[#101010]">
      <span className="flex items-stretch">
        {['C', 'A', 'R', 'F', 'A', 'X'].map((letter, index) => (
          <span
            // Fixed content in a fixed order, so the index is the identity.
            key={index}
            className={cn(
              'flex items-center border-r border-white/25 font-extrabold tracking-tight text-white',
              compact ? 'px-[2px] py-[3px]' : 'px-[3px] py-1',
            )}
          >
            {letter}
          </span>
        ))}
      </span>

      <span className={cn('flex items-center bg-white', compact ? 'px-[2px]' : 'px-[3px]')}>
        {/* Sized in `em` so it tracks the badge's own type scale — at a fixed
            pixel size the leaf swims in the tile at the compact size and
            crowds it at the full one. */}
        <MapleLeaf className="h-[1.5em] w-[1.5em]" />
      </span>
    </span>
  );
}

/**
 * The Canadian maple leaf, as the flag draws it: eleven points, all straight
 * edges, symmetric about the centre. Drawn small — this is a few millimetres
 * wide in the badge — so the silhouette is what has to be right.
 */
function MapleLeaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="#e01b22" aria-hidden focusable="false">
      <path d="M50 6 L57 27 L72 20 L67 40 L88 36 L82 50 L95 58 L60 64 L64 82 L53 78 L53 96 L47 96 L47 78 L36 82 L40 64 L5 58 L18 50 L12 36 L33 40 L28 20 L43 27 Z" />
    </svg>
  );
}

/** CARFAX prints One Owner in green and Low Kilometres in purple. */
const HIGHLIGHT_BACKGROUND: Record<CarfaxHighlight, string> = {
  ONE_OWNER: 'bg-[#00854a]',
  LOW_KILOMETRES: 'bg-[#6c4c9c]',
};

/**
 * What a screen reader says.
 *
 * The visible strip is a wordmark and two short phrases, which read as a run of
 * disconnected words. This says the whole thing as one sentence, and says where
 * the link goes — the segments are claims from a report, and the label should
 * not present them as Vintrax's own findings.
 */
function describe(highlights: CarfaxHighlight[]): string {
  const claims = highlights.map((highlight) => CARFAX_HIGHLIGHT_LABELS[highlight].toLowerCase());

  const summary =
    claims.length > 0 ? `CARFAX report — seller reports ${claims.join(' and ')}` : 'CARFAX report';

  return `${summary}. Opens in a new tab.`;
}
