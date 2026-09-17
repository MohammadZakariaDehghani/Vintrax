import { describe, expect, it } from 'vitest';
import type { VehicleHistoryEvent } from '@vintrax/shared';
import { sellerHistoryDrafts, visibleHistoryTimeline } from '@/lib/vehicle-history-drafts';

/**
 * What the seller's timeline editor is allowed to load as an editable row.
 *
 * The property this protects: opening the editor and saving without changing
 * anything must never resubmit a CARFAX-sourced record as a new seller entry.
 * `PUT /vehicles/:id/history` deletes and rewrites only `SELLER` rows, so a
 * CARFAX record that slipped into the editor's draft would come back as a
 * second, duplicate row alongside the original — content-identical, but
 * counted twice by anything that reads the timeline.
 */

function event(overrides: Partial<VehicleHistoryEvent> = {}): VehicleHistoryEvent {
  return {
    id: 'e1',
    kind: 'SERVICE',
    source: 'SELLER',
    occurredOn: null,
    label: 'Entry',
    detail: null,
    ...overrides,
  };
}

describe('sellerHistoryDrafts', () => {
  it('keeps entries the seller typed', () => {
    const seller = event({ id: 's1', source: 'SELLER', label: 'Sold new' });

    expect(sellerHistoryDrafts([seller])).toEqual([seller]);
  });

  it('drops entries read off the CARFAX report', () => {
    // The bug this exists for: including this in the editor's rows meant
    // saving would clone it into a second, SELLER-sourced entry.
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(sellerHistoryDrafts([carfax])).toEqual([]);
  });

  it('keeps the seller rows and drops the CARFAX rows from a mixed list', () => {
    const seller = event({ id: 's1', source: 'SELLER' });
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(sellerHistoryDrafts([carfax, seller, carfax])).toEqual([seller]);
  });

  it('returns nothing for an empty timeline, rather than throwing', () => {
    expect(sellerHistoryDrafts([])).toEqual([]);
  });
});

/**
 * What a buyer may see in the vehicle history section of a listing.
 *
 * The regression this guards against: a version of the buyer-facing block
 * showed CARFAX entries only, which meant a seller's own typed timeline —
 * unrelated to CARFAX, working since before it existed — stopped reaching
 * buyers at all. A seller with no CARFAX link, or whose report currently
 * cannot be read, still needs their own entries to show.
 */
describe('visibleHistoryTimeline', () => {
  it('shows the seller’s own entries whether or not a report is approved', () => {
    const seller = event({ id: 's1', source: 'SELLER', label: 'Sold new' });

    expect(visibleHistoryTimeline([seller], true)).toEqual([seller]);
    expect(visibleHistoryTimeline([seller], false)).toEqual([seller]);
    expect(visibleHistoryTimeline([seller], undefined)).toEqual([seller]);
  });

  it('withholds a CARFAX entry until its reading is approved', () => {
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(visibleHistoryTimeline([carfax], false)).toEqual([]);
    expect(visibleHistoryTimeline([carfax], undefined)).toEqual([]);
  });

  it('shows a CARFAX entry once approved', () => {
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(visibleHistoryTimeline([carfax], true)).toEqual([carfax]);
  });

  it('shows both sources together, seller entries first, once approved', () => {
    // The order the API already returns them in — seller rows start at
    // position 0, CARFAX rows at 1000 — so this asserts the filter preserves
    // that order rather than re-sorting.
    const seller = event({ id: 's1', source: 'SELLER', label: 'Sold new' });
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(visibleHistoryTimeline([seller, carfax], true)).toEqual([seller, carfax]);
  });

  it('shows only the seller entries when the CARFAX reading is not approved', () => {
    const seller = event({ id: 's1', source: 'SELLER', label: 'Sold new' });
    const carfax = event({ id: 'c1', source: 'CARFAX', kind: 'ACCIDENT_DAMAGE' });

    expect(visibleHistoryTimeline([seller, carfax], false)).toEqual([seller]);
  });

  it('returns nothing for an empty timeline, rather than throwing', () => {
    expect(visibleHistoryTimeline([], true)).toEqual([]);
  });
});
