import { ACCIDENT_HISTORY_EVENT_KINDS } from '@vintrax/shared';
import type { VehicleDetail, VehicleHistoryEvent } from '@vintrax/shared';
import { formatEnum, formatKm } from '@/lib/utils';

/**
 * The four figures at the top of a listing.
 *
 * Two of them — owners and accidents — can only come from the seller's history
 * timeline, and that is the whole difficulty. "None reported" is a strong claim
 * to print in large type next to a car, and it must not be the thing shown when
 * the truth is that nobody said anything either way. So absence is never read
 * as good news:
 *
 *   - Accidents reads "None reported" only when the seller actually entered a
 *     NO_CLAIMS entry. An empty timeline reads "Not stated".
 *   - Owners is a count of the entries that record a change of hands, and is
 *     omitted entirely when there are none rather than displayed as zero.
 *
 * Every value carries where it came from, so the strip can attribute the
 * seller-supplied ones rather than presenting them as facts Vintrax checked.
 */
export interface VehicleFact {
  label: string;
  value: string;
  /** True when this came from the seller's timeline rather than the listing. */
  fromSeller: boolean;
  /** Set when the value is bad news, so the strip can mark it. */
  adverse?: boolean;
}

export function vehicleFacts(vehicle: VehicleDetail): VehicleFact[] {
  const events = vehicle.historyEvents;

  return [
    { label: 'Kilometres', value: formatKm(vehicle.mileageKm), fromSeller: false },
    ownersFact(events),
    accidentsFact(events),
    { label: 'Transmission', value: formatEnum(vehicle.transmission), fromSeller: false },
  ].filter((fact): fact is VehicleFact => fact !== null);
}

/**
 * How many times the timeline records the car changing hands.
 *
 * Omitted rather than shown as zero when the timeline says nothing: "0 owners"
 * is not a fact about a car, it is a fact about an empty form.
 */
function ownersFact(events: VehicleHistoryEvent[]): VehicleFact | null {
  const changes = events.filter(
    (event) => event.kind === 'SOLD' || event.kind === 'REGISTERED',
  ).length;
  if (changes === 0) return null;
  return { label: 'Owners', value: String(changes), fromSeller: true };
}

/**
 * What the timeline says about accidents.
 *
 * Counts damage records as well as insurance claims. It used to count only
 * claims, which was right when a seller typing "Insurance claim" was the only
 * way anything got onto the timeline — and became wrong the moment the CARFAX
 * reader started writing `ACCIDENT_DAMAGE` rows. A car whose report shows two
 * accidents would have read "Not stated", on the one field where a buyer least
 * forgives it.
 *
 * `fromSeller` is now only true for entries the seller typed. A CARFAX-sourced
 * record is the report's account, not theirs, and the listing should not
 * attribute it to them.
 *
 * Silence is still reported as silence — never as "none".
 */
function accidentsFact(events: VehicleHistoryEvent[]): VehicleFact {
  const accidents = events.filter((event) => ACCIDENT_HISTORY_EVENT_KINDS.includes(event.kind));
  if (accidents.length > 0) {
    return {
      label: 'Accidents',
      value: `${accidents.length} reported`,
      fromSeller: accidents.every((event) => event.source === 'SELLER'),
      adverse: true,
    };
  }

  const clear = events.filter(
    (event) => event.kind === 'NO_ACCIDENTS' || event.kind === 'NO_CLAIMS',
  );
  if (clear.length > 0) {
    return {
      label: 'Accidents',
      value: 'None reported',
      fromSeller: clear.every((event) => event.source === 'SELLER'),
    };
  }

  return { label: 'Accidents', value: 'Not stated', fromSeller: false };
}

/**
 * The one-line summary under a listing's title.
 *
 * The VIN is shown in full. It was masked to its last six characters for one
 * release, on the reasoning that the serial is what a cloned listing needs;
 * issue #34 reversed that at the owner's instruction, and the reasoning the
 * other way is sound — a buyer running their own history check needs the whole
 * number, every other Canadian marketplace prints it, and a masked VIN reads as
 * something being withheld. See D-032, whose masking clause is superseded.
 */
export function vehicleSubtitle(vehicle: VehicleDetail): string {
  return [
    formatKm(vehicle.mileageKm),
    formatEnum(vehicle.transmission),
    vehicle.drivetrain,
    vehicle.exteriorColour,
    vehicle.vin ? `VIN ${vehicle.vin}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
