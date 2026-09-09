'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  BODY_TYPES,
  BODY_TYPE_PLURAL_LABELS,
  PROVINCES,
  PROVINCE_LABELS,
  type BodyType,
  type VehicleSearchResponse,
} from '@atlas/shared';
import { api } from '@/lib/api-client';
import { cn, formatNumber } from '@/lib/utils';
import { BodyTypeIcon } from '@/components/body-type-icon';
import type { BodyTypeShortcut } from '@/lib/body-type-shortcuts';
import { useT } from '@/i18n/provider';

/**
 * The tabs across the top.
 *
 * The site this pattern comes from uses them for vehicle categories — boats,
 * RVs, snowmobiles. Atlas sells cars, so those would be tabs leading nowhere.
 * These are the four cuts Atlas actually has, and each one is a filter the API
 * already supports.
 */
const TABS = [
  { key: 'all', label: 'All vehicles', params: {} as Record<string, string> },
  { key: 'buy', label: 'Buy now', params: { saleChannel: 'FIXED_PRICE' } },
  { key: 'auctions', label: 'Auctions', params: { saleChannel: 'AUCTION' } },
  { key: 'inspected', label: 'Inspected', params: { inspectedOnly: 'true' } },
] as const;

const PRICE_CEILINGS = [10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000];

const field =
  'h-12 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ' +
  'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40';

export function HomeSearch({
  makes = [],
  bodyTypes = [],
}: {
  makes?: string[];
  bodyTypes?: BodyTypeShortcut[];
}) {
  const t = useT();
  const router = useRouter();

  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [province, setProvince] = useState('');

  const active = TABS.find((entry) => entry.key === tab) ?? TABS[0];
  const byBodyType = new Map(bodyTypes.map((entry) => [entry.bodyType, entry]));

  const params = new URLSearchParams(active.params);
  if (make) params.set('make', make);
  if (model.trim()) params.set('model', model.trim());
  if (maxPrice) params.set('maxPrice', maxPrice);
  if (province) params.set('province', province);
  const query = params.toString();

  /**
   * The count on the button.
   *
   * Showing what a search will return before it is run is the difference
   * between guessing and choosing: narrow it to nothing and the button says so
   * rather than delivering an empty page. `pageSize=1` because only `total` is
   * wanted, and the previous count stays on screen while the next resolves so
   * the button does not flicker between digits on every keystroke.
   */
  const count = useQuery({
    queryKey: ['vehicles', 'count', query],
    queryFn: () =>
      api.get<VehicleSearchResponse>(`/vehicles?${query ? `${query}&` : ''}page=1&pageSize=1`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    router.push(query ? `/vehicles?${query}` : '/vehicles');
  }

  const total = count.data?.total;
  const hasLocation = province !== '';

  return (
    <div className="rounded-lg bg-card shadow-lg ring-1 ring-border">
      {/* `overflow-x-auto` alone computes the cross axis to `auto` as well, so
          a fraction of a pixel of vertical overflow put a full scrollbar —
          steppers and all — down the right edge of the card. The tabs never
          need to scroll vertically, so that axis is clipped explicitly. */}
      <div
        className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-3 sm:px-5"
        role="tablist"
      >
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={entry.key === tab}
            onClick={() => setTab(entry.key)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold transition-colors',
              entry.key === tab
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} role="search" className="p-3 sm:p-5">
        <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <div>
            <label htmlFor="hero-make" className="sr-only">
              {t.search.makeLabel}
            </label>
            <select
              id="hero-make"
              className={field}
              value={make}
              onChange={(event) => setMake(event.target.value)}
            >
              <option value="">{t.search.anyMake}</option>
              {makes.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="hero-model" className="sr-only">
              {t.search.modelLabel}
            </label>
            <input
              id="hero-model"
              className={field}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={t.search.modelPlaceholder}
            />
          </div>

          <div>
            <label htmlFor="hero-price" className="sr-only">
              {t.search.maxPriceLabel}
            </label>
            <select
              id="hero-price"
              className={field}
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
            >
              <option value="">{t.search.anyPrice}</option>
              {PRICE_CEILINGS.map((ceiling) => (
                <option key={ceiling} value={ceiling}>
                  {`Under $${ceiling.toLocaleString('en-CA')}`}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <label htmlFor="hero-province" className="sr-only">
              {t.search.provinceLabel}
            </label>
            <select
              id="hero-province"
              className={cn(field, hasLocation && 'pr-9')}
              value={province}
              onChange={(event) => setProvince(event.target.value)}
            >
              <option value="">{t.search.anyProvince}</option>
              {PROVINCES.map((code) => (
                <option key={code} value={code}>
                  {PROVINCE_LABELS[code]}
                </option>
              ))}
            </select>
            {hasLocation ? (
              <button
                type="button"
                onClick={() => setProvince('')}
                aria-label={t.search.anyProvince}
                className="absolute right-7 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>

          <button
            type="submit"
            className="tabular h-12 whitespace-nowrap rounded-md bg-primary px-6 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
            disabled={total === 0}
          >
            {total === undefined
              ? t.search.submit
              : total === 0
                ? t.search.noResults
                : `${formatNumber(total)} ${total === 1 ? t.search.resultsOne : t.search.resultsOther}`}
          </button>
        </div>
      </form>

      {/* Shortcuts by shape, each showing a photograph of that shape — the one
          an administrator chose, or failing that one from a live listing.

          The picture is contained rather than cropped, on a plain ground: a
          body type is a silhouette, and cropping a side profile to fill a box
          cuts off the nose or the tail, which is precisely the part that tells
          a wagon from a hatchback. */}
      <div className="border-t border-border px-3 pb-5 pt-4 sm:px-5">
        <h2 className="mb-3 text-sm font-semibold">{t.home.shopByType}</h2>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {BODY_TYPES.map((bodyType: BodyType) => {
            const shortcut = byBodyType.get(bodyType);
            return (
              <li key={bodyType}>
                <Link
                  href={`/vehicles?bodyType=${bodyType}`}
                  className="group flex flex-col items-center gap-1.5 rounded-md p-1 text-center transition-colors hover:bg-secondary"
                >
                  <span className="relative block aspect-[3/2] w-full overflow-hidden rounded">
                    {shortcut?.imageUrl ? (
                      // Uploads and listing photos are served from the API
                      // origin, and the placeholders among them are SVG;
                      // next/image optimisation helps with neither.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={shortcut.imageUrl}
                        alt={shortcut.alt ?? ''}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      // No photo set and nothing of this shape listed with one.
                      <span className="grid h-full w-full place-items-center text-foreground/70">
                        <BodyTypeIcon bodyType={bodyType} className="h-9 w-auto" />
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold leading-tight">
                    {BODY_TYPE_PLURAL_LABELS[bodyType]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
