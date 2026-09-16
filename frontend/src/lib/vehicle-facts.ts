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
 * What the timeline says about claims.
 *
 * A claim on the timeline is reported as such and marked adverse. Silence is
 * reported as silence — never as "none".
 */
function accidentsFact(events: VehicleHistoryEvent[]): VehicleFact {
  const claims = events.filter((event) => event.kind === 'CLAIM').length;
  if (claims > 0) {
    return {
      label: 'Accidents',
      value: `${claims} reported`,
      fromSeller: true,
      adverse: true,
    };
  }
  if (events.some((event) => event.kind === 'NO_CLAIMS')) {
    return { label: 'Accidents', value: 'None reported', fromSeller: true };
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
