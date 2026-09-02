import type { AuctionDetail } from '@atlas/shared';

/**
 * The one-tap bid amounts offered above the keypad.
 *
 * The ladder starts at the server's own `minimumNextBidCad` and climbs by the
 * same step, so every offered amount is one the API will accept. Nothing here
 * recomputes the minimum increment — that rule lives in the platform, and a
 * second copy on a phone would eventually disagree with it.
 */
export function quickBidLadder(auction: Pick<AuctionDetail, 'currentBidCad' | 'minimumNextBidCad'>): number[] {
  const step = auction.minimumNextBidCad - auction.currentBidCad;

  // A non-positive step would produce a ladder of identical or falling
  // amounts, every one of which the API would reject.
  if (step <= 0) return [auction.minimumNextBidCad];

  return [auction.minimumNextBidCad, auction.minimumNextBidCad + step, auction.minimumNextBidCad + step * 4];
}

/**
 * Whether a typed amount is worth sending. The API decides for real; this only
 * avoids a round trip that is certain to fail.
 */
export function isSubmittableBid(
  raw: string,
  auction: Pick<AuctionDetail, 'minimumNextBidCad'>,
): boolean {
  if (!/^\d+$/.test(raw)) return false;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= auction.minimumNextBidCad;
}
