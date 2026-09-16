import { ExternalLink, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A link to a vehicle's CARFAX report.
 *
 * Two things this deliberately is not.
 *
 * It is not the CARFAX logo. That artwork is a registered mark and reproducing
 * it needs their brand assets and their permission; setting their name in our
 * own type is a reference to the report, which is allowed, rather than an
 * imitation of their identity, which is not. Swap in the real mark once the
 * licence is in hand — the shape here leaves room for it.
 *
 * And it is not a claim by Vintrax. The link is the seller's; what the badge
 * asserts is "the seller supplied a report", which is true, and clicking it
 * takes the buyer to CARFAX where the report speaks for itself. The URL is
 * validated against the real CARFAX hosts before it is stored, because a badge
 * carrying someone else's name pointed at an arbitrary address is a phishing
 * page wearing a brand the buyer already trusts.
 *
 * `rel="noopener noreferrer"` on a `_blank` link: without `noopener` the opened
 * page can reach back through `window.opener` and navigate this tab somewhere
 * else.
 */
export function CarfaxBadge({
  url,
  className,
  compact = false,
}: {
  url: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // Stops the click reaching a card that is itself a link to the listing.
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-card font-semibold transition-colors hover:border-primary hover:text-primary',
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1.5 text-xs',
        className,
      )}
      aria-label="Open this vehicle's CARFAX report in a new tab"
    >
      <FileText className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      <span className="tracking-wide">CARFAX</span>
      {compact ? null : (
        <>
          <span className="font-normal text-muted-foreground">report</span>
          <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
        </>
      )}
    </a>
  );
}
