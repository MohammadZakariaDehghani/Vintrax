import { describe, expect, it } from 'vitest';
import type { VehicleDetail, VehicleHistoryEvent } from '@vintrax/shared';
import { vehicleFacts, vehicleSubtitle } from './vehicle-facts';

/**
 * The figures printed in large type at the top of a listing.
 *
 * The case that matters is the empty one. A buyer reading "Accidents — None
 * reported" will take it as a statement about the car, so it must not be what
 * appears when the truth is that nobody said anything either way. Silence is
 * reported as silence.
 */

function event(kind: VehicleHistoryEvent['kind'], suffix = ''): VehicleHistoryEvent {
  return {
    id: `${kind}${suffix}`,
    kind,
    source: 'SELLER',
    occurredOn: '2024-01-01',
    label: kind,
    detail: null,
  };
}

function vehicle(events: VehicleHistoryEvent[] = []): VehicleDetail {
  return {
    mileageKm: 48_900,
    transmission: 'AUTOMATIC',
    drivetrain: 'AWD',
    exteriorColour: 'Soul Red Crystal',
    vin: 'JM3KFBDM4N0123456',
    historyEvents: events,
  } as unknown as VehicleDetail;
}

describe('vehicleFacts', () => {
  it('never reads an empty timeline as good news', () => {
    // The whole point. "None reported" would be a claim about the car; this is
    // a fact about an empty form.
    const facts = vehicleFacts(vehicle([]));

    expect(facts.find((fact) => fact.label === 'Accidents')).toMatchObject({
      value: 'Not stated',
      fromSeller: false,
    });
  });

  it('reports no claims only when the seller actually said so', () => {
    const facts = vehicleFacts(vehicle([event('NO_CLAIMS')]));

    expect(facts.find((fact) => fact.label === 'Accidents')).toMatchObject({
      value: 'None reported',
      fromSeller: true,
    });
  });

  it('marks a claim as adverse, and counts it', () => {
    const facts = vehicleFacts(vehicle([event('CLAIM', '1'), event('CLAIM', '2')]));

    expect(facts.find((fact) => fact.label === 'Accidents')).toMatchObject({
      value: '2 reported',
      adverse: true,
    });
  });

  it('counts a damage record read off the report, not only an insurance claim', () => {
    // The bug this exists for: counting `CLAIM` alone was right while a seller
    // typing one was the only way anything reached the timeline, and became
    // wrong the moment the CARFAX reader started writing ACCIDENT_DAMAGE. A car
    // whose report shows two accidents read "Not stated".
    const facts = vehicleFacts(
      vehicle([event('ACCIDENT_DAMAGE', '1'), event('ACCIDENT_DAMAGE', '2')]),
    );

    expect(facts.find((fact) => fact.label === 'Accidents')).toMatchObject({
      value: '2 reported',
      adverse: true,
    });
  });

  it('treats a report that states no accidents as a clear result', () => {
    const facts = vehicleFacts(vehicle([event('NO_ACCIDENTS')]));

    expect(facts.find((fact) => fact.label === 'Accidents')?.value).toBe('None reported');
  });

  it('does not attribute the report\u2019s finding to the seller', () => {
    // `fromSeller` drives a "seller says" marker on the listing. A record the
    // server read off CARFAX is the report's account, not the dealer's.
    const fromReport: VehicleHistoryEvent = { ...event('ACCIDENT_DAMAGE'), source: 'CARFAX' };
    const facts = vehicleFacts(vehicle([fromReport]));

    expect(facts.find((fact) => fact.label === 'Accidents')?.fromSeller).toBe(false);
  });

  it('lets a claim outweigh a "no claims" entry sitting beside it', () => {
    // A seller who enters both does not get the kinder of the two.
    const facts = vehicleFacts(vehicle([event('NO_CLAIMS'), event('CLAIM')]));

    expect(facts.find((fact) => fact.label === 'Accidents')?.value).toBe('1 reported');
  });

  it('omits owners rather than printing zero', () => {
    expect(vehicleFacts(vehicle([])).some((fact) => fact.label === 'Owners')).toBe(false);
  });

  it('counts the entries where the car changed hands', () => {
    const facts = vehicleFacts(vehicle([event('REGISTERED'), event('SOLD'), event('SERVICE')]));

    expect(facts.find((fact) => fact.label === 'Owners')).toMatchObject({
      value: '2',
      fromSeller: true,
    });
  });

  it('marks which figures came from the seller and which from the listing', () => {
    const facts = vehicleFacts(vehicle([event('NO_CLAIMS')]));

    expect(facts.find((fact) => fact.label === 'Kilometres')?.fromSeller).toBe(false);
    expect(facts.find((fact) => fact.label === 'Transmission')?.fromSeller).toBe(false);
  });
});

describe('vehicleSubtitle', () => {
  it('reads as one line and carries the whole VIN', () => {
    // Masked for one release; issue #34 reversed it. A buyer running their own
    // history check needs the whole number.
    const line = vehicleSubtitle(vehicle());

    expect(line).toContain('48,900 km');
    expect(line).toContain('Soul Red Crystal');
    expect(line).toContain('VIN JM3KFBDM4N0123456');
    expect(line).not.toContain('•');
  });

  it('leaves out what the listing does not say', () => {
    const sparse = { ...vehicle(), exteriorColour: null, vin: null } as VehicleDetail;

    expect(vehicleSubtitle(sparse)).toBe('48,900 km · Automatic · AWD');
  });
});
