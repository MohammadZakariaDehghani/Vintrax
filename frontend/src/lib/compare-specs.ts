import { TITLE_STATUS_LABELS, type VehicleDetail } from '@vintrax/shared';
import { formatEnum, formatKm, formatPrice } from '@/lib/utils';

const NOT_STATED = 'Not stated';

/** One row of the specification comparison table. */
export interface CompareSpecRow {
  label: string;
  /** One value per vehicle, in the same order as the vehicles passed in. */
  values: string[];
  /** True when the vehicles do not all agree — what the table highlights. */
  differs: boolean;
}

/**
 * Builds the specification table from real `VehicleDetail` fields — the same
 * set the single-vehicle detail page already prints as its own "Vehicle
 * details" card, in the same order, so a shopper who has looked at one
 * listing recognises the other's shape immediately.
 *
 * A blank field prints as "Not stated" rather than being left empty or the
 * row being dropped: a seller who never answered a question and one who
 * would answer "none" both deserve to be told apart from a rendering glitch,
 * the same reasoning the CARFAX highlights and the title-status column
 * already use elsewhere in this app.
 */
export function buildCompareSpecs(vehicles: VehicleDetail[]): CompareSpecRow[] {
  const rows: Array<{ label: string; values: string[] }> = [
    { label: 'Year', values: vehicles.map((vehicle) => String(vehicle.year)) },
    { label: 'Make', values: vehicles.map((vehicle) => vehicle.make) },
    { label: 'Model', values: vehicles.map((vehicle) => vehicle.model) },
    { label: 'Trim', values: vehicles.map((vehicle) => vehicle.trim ?? NOT_STATED) },
    { label: 'Price', values: vehicles.map((vehicle) => formatPrice(vehicle.priceCad)) },
    { label: 'Mileage', values: vehicles.map((vehicle) => formatKm(vehicle.mileageKm)) },
    { label: 'Condition', values: vehicles.map((vehicle) => formatEnum(vehicle.condition)) },
    { label: 'Body type', values: vehicles.map((vehicle) => formatEnum(vehicle.bodyType)) },
    { label: 'Transmission', values: vehicles.map((vehicle) => formatEnum(vehicle.transmission)) },
    { label: 'Drivetrain', values: vehicles.map((vehicle) => formatEnum(vehicle.drivetrain)) },
    { label: 'Fuel type', values: vehicles.map((vehicle) => formatEnum(vehicle.fuelType)) },
    { label: 'Engine', values: vehicles.map((vehicle) => vehicle.engine ?? NOT_STATED) },
    {
      label: 'Cylinders',
      values: vehicles.map((vehicle) => (vehicle.cylinders ? String(vehicle.cylinders) : NOT_STATED)),
    },
    { label: 'Doors', values: vehicles.map((vehicle) => (vehicle.doors ? String(vehicle.doors) : NOT_STATED)) },
    { label: 'Seats', values: vehicles.map((vehicle) => (vehicle.seats ? String(vehicle.seats) : NOT_STATED)) },
    { label: 'Exterior colour', values: vehicles.map((vehicle) => vehicle.exteriorColour ?? NOT_STATED) },
    { label: 'Interior colour', values: vehicles.map((vehicle) => vehicle.interiorColour ?? NOT_STATED) },
    {
      label: 'Title',
      values: vehicles.map((vehicle) =>
        vehicle.titleStatus ? TITLE_STATUS_LABELS[vehicle.titleStatus] : NOT_STATED,
      ),
    },
    { label: 'Stock #', values: vehicles.map((vehicle) => vehicle.stockNumber ?? NOT_STATED) },
  ];

  return rows.map((row) => ({
    ...row,
    differs: new Set(row.values).size > 1,
  }));
}
