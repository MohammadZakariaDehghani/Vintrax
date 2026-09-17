import { describe, expect, it } from 'vitest';
import type { VehicleHistoryEvent } from '@vintrax/shared';
import { sellerHistoryDrafts } from '@/lib/vehicle-history-drafts';

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
