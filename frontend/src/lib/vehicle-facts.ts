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
 * A VIN with its last six characters withheld.
 *
 * The last six are the serial number, which is what a VIN-cloning listing needs
 * and what a history-report reseller charges for. The first eleven already
 * identify the model, year, plant and engine, which is all a buyer needs to
 * check the listing describes the car it claims to. The full VIN is in the
 * documents, behind the same access rule as the rest of the paperwork.
 */
export function maskVin(vin: string | null): string | null {
  if (!vin) return null;
  if (vin.length <= 6) return '•'.repeat(vin.length);
  return `${vin.slice(0, vin.length - 6)}${'•'.repeat(6)}`;
}

/** The one-line summary under a listing's title. */
export function vehicleSubtitle(vehicle: VehicleDetail): string {
  return [
    formatKm(vehicle.mileageKm),
    formatEnum(vehicle.transmission),
    vehicle.drivetrain,
    vehicle.exteriorColour,
    maskVin(vehicle.vin) ? `VIN ${maskVin(vehicle.vin)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
