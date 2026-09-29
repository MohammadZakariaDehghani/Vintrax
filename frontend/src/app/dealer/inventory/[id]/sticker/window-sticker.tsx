'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_ITEMS,
  VEHICLE_AVAILABILITY_LABELS,
  ownerCountLabel,
  type VehicleDetail,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Button, ErrorAlert, Spinner } from '@/components/ui';

/**
 * Only the sticker prints: everything else on the page — the site header,
 * footer and help button — is hidden from the printer.
 */
const PRINT_ONLY_STICKER = `
@media print {
  @page { margin: 12mm; }
  body * { visibility: hidden !important; }
  #window-sticker, #window-sticker * { visibility: visible !important; }
  #window-sticker { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none; border: 0; }
}`;

/** A printable window sticker for one vehicle, from what its listing holds. */
export function WindowSticker({ vehicleId }: { vehicleId: string }) {
  const vehicle = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
  });

  if (vehicle.isPending) return <Spinner label="Loading vehicle" />;
  if (vehicle.error) return <ErrorAlert error={vehicle.error} />;
  const car = vehicle.data;

  const specs: Array<[string, string | null]> = [
    ['Mileage', formatKm(car.mileageKm)],
    ['Condition', formatEnum(car.condition)],
    ['Body style', formatEnum(car.bodyType)],
    ['Transmission', formatEnum(car.transmission)],
    ['Drivetrain', car.drivetrain === 'FOUR_WHEEL_DRIVE' ? '4x4' : formatEnum(car.drivetrain)],
    ['Fuel', formatEnum(car.fuelType)],
    ['Engine', car.engine],
    ['Power', car.horsepower ? `${car.horsepower} hp` : null],
    ['Exterior', car.manufacturerColour ?? car.exteriorColour],
    ['Interior', car.interiorColour],
    ['Doors', car.doors ? String(car.doors) : null],
    ['Seats', car.seats ? String(car.seats) : null],
    ['Owners', car.ownerCount ? ownerCountLabel(car.ownerCount) : null],
    ['Availability', car.availability ? VEHICLE_AVAILABILITY_LABELS[car.availability] : null],
  ];
  const groups = EQUIPMENT_GROUPS.map((group) => ({
    name: group.name,
    items: group.items.filter((item) => car.features.includes(item)),
  })).filter((group) => group.items.length > 0);
  const other = car.features.filter((feature) => !EQUIPMENT_ITEMS.has(feature));

  return (
    <>
      <style>{PRINT_ONLY_STICKER}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
      </div>
      <article
        id="window-sticker"
        className="mx-auto max-w-3xl rounded-xl border-4 border-foreground bg-white p-8 text-black shadow-lg"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-4 border-black pb-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest">
              {car.seller.dealer?.name ?? 'Vintrax'}
            </p>
            <h1 className="mt-1 text-3xl font-black leading-tight">
              {car.year} {car.make} {car.model}
            </h1>
            {car.trim ? <p className="text-lg font-semibold">{car.trim}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-widest">Our price</p>
            <p className="text-4xl font-black">{formatPrice(car.priceCad)}</p>
            {car.extendedWarranty ? (
              <p className="text-xs font-semibold">Includes additional warranty</p>
            ) : null}
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {specs
            .filter((spec): spec is [string, string] => Boolean(spec[1]))
            .map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-black/20 py-1">
                <dt className="font-semibold">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
        </dl>

        {groups.length > 0 || other.length > 0 ? (
          <section className="mt-6">
            <h2 className="border-b-2 border-black pb-1 text-sm font-black uppercase tracking-widest">
              Equipment
            </h2>
            <div className="mt-3 columns-2 gap-8 text-sm sm:columns-3">
              {groups.map((group) => (
                <div key={group.name} className="mb-3 break-inside-avoid">
                  <p className="font-bold">{group.name}</p>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>✓ {item}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {other.length > 0 ? (
                <div className="mb-3 break-inside-avoid">
                  <p className="font-bold">Also</p>
                  <ul>
                    {other.map((item) => (
                      <li key={item}>✓ {item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <footer className="mt-6 flex flex-wrap justify-between gap-3 border-t-4 border-black pt-3 text-xs">
          <span>
            <strong>VIN</strong> <span className="font-mono">{car.vin ?? '—'}</span>
          </span>
          <span>
            <strong>Stock #</strong> {car.stockNumber ?? '—'}
          </span>
          <span>vintrax.ca/vehicles/{car.slug}</span>
        </footer>
      </article>
    </>
  );
}
