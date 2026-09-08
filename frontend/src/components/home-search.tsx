'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { PROVINCES, PROVINCE_LABELS } from '@atlas/shared';
import { Button } from '@/components/ui';
import { useT } from '@/i18n/provider';

/** Round ceilings, which is how people actually describe a budget. */
const PRICE_CEILINGS = [10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 75_000, 100_000];

const field =
  'h-12 w-full rounded-md border border-transparent bg-background px-3 text-sm text-foreground ' +
  'focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40';

/**
 * The hero search.
 *
 * A single keyword box asks the visitor to invent a query. Marketplaces put
 * the shape of the decision on the page instead — make, model, budget, where —
 * because those are the four things a buyer already knows, and each one maps
 * to a filter the API supports. Nothing here is decorative: every field
 * narrows the search it submits.
 */
export function HomeSearch({ makes = [] }: { makes?: string[] }) {
  const t = useT();
  const router = useRouter();
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [province, setProvince] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const params = new URLSearchParams();
    if (make) params.set('make', make);
    if (model.trim()) params.set('model', model.trim());
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (province) params.set('province', province);

    const query = params.toString();
    router.push(query ? `/vehicles?${query}` : '/vehicles');
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className="mt-6 rounded-lg bg-white/10 p-3 backdrop-blur-sm"
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
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

        <div>
          <label htmlFor="hero-province" className="sr-only">
            {t.search.provinceLabel}
          </label>
          <select
            id="hero-province"
            className={field}
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
        </div>

        <Button type="submit" size="lg" variant="secondary" className="h-12 lg:px-8">
          <Search className="h-4 w-4" aria-hidden />
          {t.search.submit}
        </Button>
      </div>
    </form>
  );
}
