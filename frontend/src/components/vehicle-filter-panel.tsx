'use client';

import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  PROVINCES,
  PROVINCE_LABELS,
  SALE_CHANNELS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type SearchFacets,
} from '@vintrax/shared';
import { formatEnum } from '@/lib/utils';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  toggleInArray,
  type VehicleFilters,
} from '@/lib/search-params';
import { Button, Input, Select } from '@/components/ui';

function CheckboxGroup({
  legend,
  options,
  selected,
  counts,
  onToggle,
}: {
  legend: string;
  options: readonly string[];
  selected: string[];
  counts?: Map<string, number>;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="border-t border-border pt-4">
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-col gap-1">
        {options.map((option) => {
          const count = counts?.get(option);
          return (
            <label key={option} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span>{formatEnum(option)}</span>
              {count !== undefined ? (
                <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function VehicleFilterPanel({
  filters,
  facets,
  onChange,
}: {
  filters: VehicleFilters;
  facets?: SearchFacets;
  onChange: (next: VehicleFilters) => void;
}) {
  // Changing any filter returns to page 1; staying on page 4 of a new result
  // set is almost always an empty page.
  const update = (patch: Partial<VehicleFilters>) => onChange({ ...filters, ...patch, page: 1 });

  const bodyTypeCounts = new Map(facets?.bodyTypes.map((facet) => [facet.value, facet.count]));
  const fuelTypeCounts = new Map(facets?.fuelTypes.map((facet) => [facet.value, facet.count]));
  const activeCount = countActiveFilters(filters);

  return (
    <aside
      className="max-h-[calc(100vh-7rem)] overflow-y-auto rounded-lg border border-border bg-card p-5"
      aria-label="Filter vehicles"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Filters</h2>
        {activeCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}
          >
            Clear ({activeCount})
          </Button>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">Make and model</legend>
        <label htmlFor="filter-make" className="sr-only">
          Make
        </label>
        <Select
          id="filter-make"
          value={filters.make ?? ''}
          onChange={(event) => update({ make: event.target.value || undefined })}
        >
          <option value="">Any make</option>
          {facets?.makes.map((facet) => (
            <option key={facet.value} value={facet.value}>
              {facet.value} ({facet.count})
            </option>
          ))}
        </Select>
        <label htmlFor="filter-model" className="sr-only">
          Model
        </label>
        <Input
          id="filter-model"
          placeholder="Model, e.g. Civic"
          value={filters.model ?? ''}
          onChange={(event) => update({ model: event.target.value || undefined })}
        />
      </fieldset>

      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-semibold">Price (CAD)</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="filter-min-price" className="sr-only">
              Minimum price
            </label>
            <Input
              id="filter-min-price"
              type="number"
              min={0}
              placeholder="Min"
              value={filters.minPrice ?? ''}
              onChange={(event) => update({ minPrice: event.target.value || undefined })}
            />
          </div>
          <div>
            <label htmlFor="filter-max-price" className="sr-only">
              Maximum price
            </label>
            <Input
              id="filter-max-price"
              type="number"
              min={0}
              placeholder="Max"
              value={filters.maxPrice ?? ''}
              onChange={(event) => update({ maxPrice: event.target.value || undefined })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-semibold">Year</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="filter-min-year" className="sr-only">
              Earliest year
            </label>
            <Input
              id="filter-min-year"
              type="number"
              placeholder="From"
              value={filters.minYear ?? ''}
              onChange={(event) => update({ minYear: event.target.value || undefined })}
            />
          </div>
          <div>
            <label htmlFor="filter-max-year" className="sr-only">
              Latest year
            </label>
            <Input
              id="filter-max-year"
              type="number"
              placeholder="To"
              value={filters.maxYear ?? ''}
              onChange={(event) => update({ maxYear: event.target.value || undefined })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-semibold">Maximum mileage</legend>
        <label htmlFor="filter-mileage" className="sr-only">
          Maximum mileage in kilometres
        </label>
        <Input
          id="filter-mileage"
          type="number"
          min={0}
          step={10000}
          placeholder="Any"
          value={filters.maxMileageKm ?? ''}
          onChange={(event) => update({ maxMileageKm: event.target.value || undefined })}
        />
      </fieldset>

      <CheckboxGroup
        legend="Body type"
        options={BODY_TYPES}
        selected={filters.bodyType}
        counts={bodyTypeCounts}
        onToggle={(value) => update({ bodyType: toggleInArray(filters.bodyType, value) })}
      />

      <CheckboxGroup
        legend="Fuel type"
        options={FUEL_TYPES}
        selected={filters.fuelType}
        counts={fuelTypeCounts}
        onToggle={(value) => update({ fuelType: toggleInArray(filters.fuelType, value) })}
      />

      <CheckboxGroup
        legend="Transmission"
        options={TRANSMISSIONS}
        selected={filters.transmission}
        onToggle={(value) => update({ transmission: toggleInArray(filters.transmission, value) })}
      />

      <CheckboxGroup
        legend="Drivetrain"
        options={DRIVETRAINS}
        selected={filters.drivetrain}
        onToggle={(value) => update({ drivetrain: toggleInArray(filters.drivetrain, value) })}
      />

      <CheckboxGroup
        legend="Condition"
        options={VEHICLE_CONDITIONS}
        selected={filters.condition}
        onToggle={(value) => update({ condition: toggleInArray(filters.condition, value) })}
      />

      <CheckboxGroup
        legend="How it sells"
        options={SALE_CHANNELS}
        selected={filters.saleChannel}
        onToggle={(value) => update({ saleChannel: toggleInArray(filters.saleChannel, value) })}
      />

      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-semibold">Location</legend>
        <label htmlFor="filter-province" className="sr-only">
          Province
        </label>
        <Select
          id="filter-province"
          value={filters.province ?? ''}
          onChange={(event) => update({ province: event.target.value || undefined })}
        >
          <option value="">All of Canada</option>
          {PROVINCES.map((province) => (
            <option key={province} value={province}>
              {PROVINCE_LABELS[province]}
            </option>
          ))}
        </Select>
        <label htmlFor="filter-city" className="sr-only">
          City
        </label>
        <Input
          id="filter-city"
          className="mt-2"
          placeholder="City"
          value={filters.city ?? ''}
          onChange={(event) => update({ city: event.target.value || undefined })}
        />
      </fieldset>

      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-semibold">Seller and condition report</legend>
        <label htmlFor="filter-seller" className="sr-only">
          Seller type
        </label>
        <Select
          id="filter-seller"
          value={filters.sellerType ?? ''}
          onChange={(event) => update({ sellerType: event.target.value || undefined })}
        >
          <option value="">Any seller</option>
          <option value="DEALER">Dealerships</option>
          <option value="SELLER">Private sellers</option>
        </Select>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.inspectedOnly === 'true'}
            onChange={(event) =>
              update({ inspectedOnly: event.target.checked ? 'true' : undefined })
            }
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
          Inspected vehicles only
        </label>
      </fieldset>
    </aside>
  );
}
