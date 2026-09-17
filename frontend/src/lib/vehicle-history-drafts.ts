import type { VehicleHistoryEvent } from '@vintrax/shared';

/**
 * The events a seller's own timeline editor may load as editable rows.
 *
 * `GET /vehicles/:id` returns both `SELLER` and `CARFAX` events to the vehicle
 * owner — deliberately, so they can review a CARFAX reading before approving
 * it. The timeline editor is not that review screen; it is where the seller
 * types their own entries, and `PUT /vehicles/:id/history` only ever deletes
 * and rewrites `SELLER` rows.
 *
 * Loading the unfiltered list into the editor's rows was a real bug: opening
 * the editor, then saving without touching anything, resubmitted every
 * CARFAX-sourced record's kind, label and date as a brand-new `SELLER` row —
 * the delete only ever targeted the old `SELLER` rows, so the CARFAX original
 * survived alongside a duplicate with the same content. The "Accidents"
 * figure on the listing counts both sources, so a car with two real accidents
 * read four after one unrelated save. This is the one place that filter has
 * to happen, because the editor is the only thing that turns "what the API
 * returned" back into "what gets written."
 */
export function sellerHistoryDrafts(events: VehicleHistoryEvent[]): VehicleHistoryEvent[] {
  return events.filter((event) => event.source === 'SELLER');
}

/**
 * What a buyer may see in the vehicle history section of a listing.
 *
 * The seller's own rows show unconditionally — typing one and saving it
 * through the editor already is the seller publishing it, the same act it has
 * always been. A CARFAX-sourced row shows only once `carfaxHistoryApproved` is
 * true, because reading a report and publishing what it says are deliberately
 * two separate acts.
 *
 * A short-lived version of the buyer-facing block called this with CARFAX
 * entries only, on the reasoning that once a report is read automatically the
 * seller's own notes were no longer what the block was "for". That silently
 * broke a feature with nothing to do with CARFAX and that had worked since
 * before it existed: a seller whose report cannot currently be read, or who
 * has never linked one, still has an editor that says "these are published as
 * your account of it" — and they were not being published anywhere a buyer
 * could see them.
 *
 * Not re-sorted: `GET /vehicles/:id` already returns events in `position`
 * order, seller rows first (they start at 0) and CARFAX rows after (they
 * start at 1000), and filtering preserves that order.
 */
export function visibleHistoryTimeline(
  events: VehicleHistoryEvent[],
  carfaxHistoryApproved: boolean | undefined,
): VehicleHistoryEvent[] {
  return events.filter((event) => event.source === 'SELLER' || carfaxHistoryApproved === true);
}
