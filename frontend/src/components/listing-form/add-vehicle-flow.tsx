'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ListingForm } from './listing-form';
import { VinStart } from './vin-start';
import type { ListingDraft } from './listing-draft';

/** VIN or make and model first, then the full form with what that found filled in. */
export function AddVehicleFlow() {
  const [start, setStart] = useState<ListingDraft | null>(null);

  if (!start) {
    return (
      <div className="py-6 sm:py-10">
        <VinStart
          onNext={(draft) => {
            setStart(draft);
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setStart(null)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Start again with a different VIN
      </button>
      <ListingForm initial={start} />
    </>
  );
}
