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
