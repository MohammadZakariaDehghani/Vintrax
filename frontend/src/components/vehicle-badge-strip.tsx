import { ExternalLink } from 'lucide-react';
import {
  VEHICLE_BADGE_LABELS,
  activeVehicleBadges,
  type VehicleBadgeKey,
  type VehicleBadges,
} from '@vintrax/shared';
import { cn } from '@/lib/utils';

/**
 * A vehicle's badges, drawn from the one source of truth every location in
 * the app reads (`vehicle.badges`) — the card, the row, the detail page,
 * search results and comparison all render from this same component (issue
 * #67). Each badge is a claim the dealer set directly and independently of
 * the others; unlike this component's earlier CARFAX-report-derived design,
 * there is no single report the whole strip is "about", so each badge is its
 * own small chip rather than one forced-together link.
 *
 * CARFAX keeps its own mark (the wordmark-and-leaf tile CARFAX Canada prints)
 * since it is a recognizable third-party brand, and is a link to
 * `carfaxUrl` only when the dealer has also given one — the badge and the
 * link are independent settings, so a dealer can tick CARFAX without a link
 * on file, or hold a link without ticking the badge. The other four badges
 * are plain, non-interactive labels: dealer claims with nothing external to
 * open.
 */
export function VehicleBadgeStrip({
  vehicle,
  className,
  compact = false,
}: {
  vehicle: { carfaxUrl?: string | null; badges: VehicleBadges };
  className?: string;
  compact?: boolean;
}) {
  const active = activeVehicleBadges(vehicle.badges);
  if (active.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {active.map((key) =>
        key === 'carfax' ? (
          <CarfaxChip key={key} url={vehicle.carfaxUrl ?? null} compact={compact} />
        ) : (
          <PlainChip key={key} badgeKey={key} compact={compact} />
        ),
      )}
    </div>
  );
}

const CHIP_BASE =
  'inline-flex items-center whitespace-nowrap rounded-[3px] border font-semibold leading-none';

function PlainChip({ badgeKey, compact }: { badgeKey: VehicleBadgeKey; compact: boolean }) {
  return (
    <span
      className={cn(
        CHIP_BASE,
        'border-border bg-secondary text-secondary-foreground',
        compact ? 'px-1.5 py-1 text-[9px]' : 'px-2 py-1 text-[11px]',
      )}
    >
      {VEHICLE_BADGE_LABELS[badgeKey]}
    </span>
  );
}

/**
 * The CARFAX Canada mark: the wordmark on black, then the maple leaf on
 * white. A link to `url` when there is one, otherwise a plain tile — the
 * badge and the report link are independent settings (issue #67), unlike
 * this design's earlier version where the badge was only ever drawn because a
 * report had been read.
 */
function CarfaxChip({ url, compact }: { url: string | null; compact: boolean }) {
  const content = (
    <>
      <span className="flex items-stretch bg-[#101010]">
        <span className="flex items-stretch">
          {['C', 'A', 'R', 'F', 'A', 'X'].map((letter, index) => (
            <span
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
          <MapleLeaf className="h-[1.5em] w-[1.5em]" />
        </span>
      </span>
      {url ? (
        <span className="flex items-center bg-[#101010] pr-1 text-white">
          <ExternalLink className="h-[1em] w-[1em]" strokeWidth={2.5} aria-hidden />
        </span>
      ) : null}
    </>
  );

  const shared = cn(
    CHIP_BASE,
    'overflow-hidden border-black/20 dark:border-white/20',
    compact ? 'text-[9px]' : 'text-[11px]',
  );

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="CARFAX report. Opens in a new tab."
        className={cn(shared, 'transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring')}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={shared} aria-label="CARFAX">
      {content}
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
