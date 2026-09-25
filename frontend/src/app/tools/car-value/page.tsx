import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Spinner } from '@/components/ui';
import { CarValueTool } from './car-value-tool';

export const metadata: Metadata = {
  title: "What's my car worth?",
  description:
    'Check your car’s value instantly: an estimate from comparable cars listed and sold on Vintrax, adjusted for year and kilometres.',
};

export default function CarValuePage() {
  return (
    <div className="container max-w-5xl py-10">
      <h1 className="text-3xl font-bold tracking-tight">Check your car’s value instantly</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Tell us about your car and we’ll compare it with similar cars listed and sold on Vintrax,
        adjusted for year and kilometres. Free, and no account needed.
      </p>
      <Suspense fallback={<Spinner label="Loading" />}>
        <CarValueTool />
      </Suspense>
    </div>
  );
}
