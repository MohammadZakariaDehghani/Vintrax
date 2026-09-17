import { ACCIDENT_HISTORY_EVENT_KINDS, type VehicleHistoryEvent } from '@vintrax/shared';

/**
 * What a listing can say about accident and damage, and why it is three states
 * rather than two.
 *
 * `reported` and `none` are both things the seller's report says. `unstated` is
 * the absence of either, and keeping it separate is the whole point of this
 * type: an empty timeline means nobody typed anything, and collapsing that into
 * `none` would turn missing data into a clean bill of health on the one field
 * where that lie is worth the most money.
 */
export type AccidentRecord =
  | { state: 'reported'; accidents: VehicleHistoryEvent[] }
  | { state: 'none' }
  | { state: 'unstated' };

/**
 * Reads a seller's timeline for what it says about accidents and damage.
 *
 * A pure function rather than logic inside the component because it encodes a
 * rule worth testing on its own: what happens when a seller enters both an
 * accident and a "no accidents reported" line. The accident wins. A report
 * cannot say both, so one of the two is a mistake, and of the two ways to be
 * wrong, showing a clean badge on a car with a recorded collision is the one
 * that costs a buyer money.
 */
export function summariseAccidentRecord(events: VehicleHistoryEvent[]): AccidentRecord {
  const accidents = events.filter((event) => ACCIDENT_HISTORY_EVENT_KINDS.includes(event.kind));
  if (accidents.length > 0) return { state: 'reported', accidents };

  if (events.some((event) => event.kind === 'NO_ACCIDENTS')) return { state: 'none' };

  return { state: 'unstated' };
}
