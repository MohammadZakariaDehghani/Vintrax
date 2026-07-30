import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  PROVINCES,
  PROVINCE_LABELS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type SearchFacets,
} from '@atlas/shared';
import { formatEnum } from '../lib/format';
import {
  EMPTY_FILTERS,
  countActiveFilters,
  toggleInArray,
  type ListingFilters,
} from '../lib/search-params';

interface FilterPanelProps {
  filters: ListingFilters;
  facets?: SearchFacets;
  onChange: (next: ListingFilters) => void;
}

/** Multi-select group backed by checkboxes, with facet counts where available. */
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
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      {options.map((option) => {
        const count = counts?.get(option);
        return (
          <label className="checkbox-row" key={option}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => onToggle(option)}
            />
            <span>{formatEnum(option)}</span>
            {count !== undefined ? <span className="checkbox-count">{count}</span> : null}
          </label>
        );
      })}
    </fieldset>
  );
}

export function FilterPanel({ filters, facets, onChange }: FilterPanelProps) {
  // Changing any filter returns to page 1; staying on page 4 of a new result
  // set is almost always an empty page.
  const update = (patch: Partial<ListingFilters>) => onChange({ ...filters, ...patch, page: 1 });

  const bodyTypeCounts = new Map(facets?.bodyTypes.map((facet) => [facet.value, facet.count]));
  const activeCount = countActiveFilters(filters);

  return (
    <aside className="panel filter-panel" aria-label="Filter listings">
      <div className="panel-header">
        <h2 style={{ fontSize: '1.05rem' }}>Filters</h2>
        {activeCount > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}
          >
            Clear ({activeCount})
          </button>
        ) : null}
      </div>

      <fieldset className="filter-group">
        <legend>Make and model</legend>
        <div className="field">
          <label htmlFor="filter-make" className="visually-hidden">
            Make
          </label>
          <select
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
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-model" className="visually-hidden">
            Model
          </label>
          <input
            id="filter-model"
            type="text"
            placeholder="Model, e.g. Civic"
            value={filters.model ?? ''}
            onChange={(event) => update({ model: event.target.value || undefined })}
          />
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Price (CAD)</legend>
        <div className="range-row">
          <div>
            <label htmlFor="filter-min-price" className="visually-hidden">
              Minimum price
            </label>
            <input
              id="filter-min-price"
              type="number"
              min={0}
              placeholder="Min"
              value={filters.minPrice ?? ''}
              onChange={(event) => update({ minPrice: event.target.value || undefined })}
            />
          </div>
          <div>
            <label htmlFor="filter-max-price" className="visually-hidden">
              Maximum price
            </label>
            <input
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

      <fieldset className="filter-group">
        <legend>Year</legend>
        <div className="range-row">
          <div>
            <label htmlFor="filter-min-year" className="visually-hidden">
              Earliest year
            </label>
            <input
              id="filter-min-year"
              type="number"
              placeholder="From"
              value={filters.minYear ?? ''}
              onChange={(event) => update({ minYear: event.target.value || undefined })}
            />
          </div>
          <div>
            <label htmlFor="filter-max-year" className="visually-hidden">
              Latest year
            </label>
            <input
              id="filter-max-year"
              type="number"
              placeholder="To"
              value={filters.maxYear ?? ''}
              onChange={(event) => update({ maxYear: event.target.value || undefined })}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Maximum mileage</legend>
        <label htmlFor="filter-mileage" className="visually-hidden">
          Maximum mileage in kilometres
        </label>
        <input
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

      <fieldset className="filter-group">
        <legend>Location</legend>
        <div className="field">
          <label htmlFor="filter-province" className="visually-hidden">
            Province
          </label>
          <select
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
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-city" className="visually-hidden">
            City
          </label>
          <input
            id="filter-city"
            type="text"
            placeholder="City"
            value={filters.city ?? ''}
            onChange={(event) => update({ city: event.target.value || undefined })}
          />
        </div>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Seller</legend>
        <label htmlFor="filter-seller" className="visually-hidden">
          Seller type
        </label>
        <select
          id="filter-seller"
          value={filters.sellerType ?? ''}
          onChange={(event) => update({ sellerType: event.target.value || undefined })}
        >
          <option value="">Any seller</option>
          <option value="DEALER">Dealerships</option>
          <option value="PRIVATE_SELLER">Private sellers</option>
        </select>
      </fieldset>
    </aside>
  );
}
