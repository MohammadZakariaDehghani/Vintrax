'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Info, X } from 'lucide-react';
import {
  VIN_PATTERN,
  maxModelYear,
  vinCheckDigitMatches,
  type CarValueOption,
  type VinDecodeResult,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button, Input, Select } from '@/components/ui';
import { BLANK_DRAFT, draftFromDecode, type ListingDraft } from './listing-draft';

type Tab = 'vin' | 'model';

const YEARS = Array.from({ length: maxModelYear() - 1949 }, (_, index) =>
  String(maxModelYear() - index),
);

/**
 * The first step of adding a vehicle: a VIN, which fills in most of the form,
 * or a make and model for a vehicle without one. Either way the dealer can
 * skip straight to typing everything in.
 */
export function VinStart({ onNext }: { onNext: (draft: ListingDraft) => void }) {
  const [tab, setTab] = useState<Tab>('vin');

  // VIN tab
  const [vin, setVin] = useState('');
  const [style, setStyle] = useState('');
  const clean = vin.trim().toUpperCase();
  const complete = VIN_PATTERN.test(clean);
  const decode = useMutation({
    mutationFn: (value: string) => api.get<VinDecodeResult>(`/vin/${encodeURIComponent(value)}`),
    onSuccess: (decoded) => setStyle(decoded.style ?? ''),
  });
  const { mutate: runDecode, reset: resetDecode } = decode;
  // Decoded as soon as all seventeen characters are in.
  useEffect(() => {
    if (complete) runDecode(clean);
    else {
      resetDecode();
      setStyle('');
    }
  }, [clean, complete, runDecode, resetDecode]);
  const decoded = decode.data?.vin === clean ? decode.data : undefined;

  // Make & model tab
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const makes = useQuery({
    queryKey: ['car-value', 'makes'],
    queryFn: () => api.get<CarValueOption[]>('/car-value/makes'),
    staleTime: 10 * 60_000,
    enabled: tab === 'model',
  });
  const models = useQuery({
    queryKey: ['car-value', 'models', make.trim().toLowerCase()],
    queryFn: () =>
      api.get<CarValueOption[]>(`/car-value/models?make=${encodeURIComponent(make.trim())}`),
    enabled: tab === 'model' && make.trim().length > 0,
    staleTime: 10 * 60_000,
  });

  const vinMessage = useMemo(() => {
    if (!clean) return null;
    if (!complete) {
      return /[IOQ]/.test(clean)
        ? { tone: 'error', text: 'A VIN never contains the letters I, O or Q.' }
        : { tone: 'muted', text: `${clean.length}/17 characters` };
    }
    return vinCheckDigitMatches(clean)
      ? { tone: 'success', text: 'Your VIN is valid' }
      : { tone: 'warning', text: 'The check digit does not match. Look at the VIN again.' };
  }, [clean, complete]);

  function next(event: FormEvent) {
    event.preventDefault();
    if (tab === 'vin') {
      if (!complete) return;
      onNext(
        decoded ? draftFromDecode(BLANK_DRAFT, decoded, style) : { ...BLANK_DRAFT, vin: clean },
      );
    } else {
      if (!year || !make.trim() || !model.trim()) return;
      onNext({ ...BLANK_DRAFT, year, make: make.trim(), model: model.trim(), trim: trim.trim() });
    }
  }

  const canContinue =
    tab === 'vin' ? complete && !decode.isPending : Boolean(year && make.trim() && model.trim());

  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
      <h1 className="text-2xl font-bold tracking-tight">Add a vehicle</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Start with the VIN and we fill in the model, trim and drivetrain for you.
      </p>

      <div
        role="tablist"
        aria-label="How to find the vehicle"
        className="mt-6 grid grid-cols-2 border-b border-border"
      >
        {(
          [
            ['vin', 'VIN'],
            ['model', 'Make & Model'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              '-mb-px border-b-2 pb-3 text-sm font-medium transition-colors',
              tab === value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={next} className="mt-6 flex flex-col gap-5" noValidate>
        {tab === 'vin' ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-vin" className="text-sm font-medium">
                VIN<span className="text-primary">*</span>
              </label>
              <div className="relative">
                <Input
                  id="start-vin"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={17}
                  value={vin}
                  onChange={(event) =>
                    setVin(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  className="h-12 pr-10 font-mono text-base uppercase tracking-[0.2em]"
                  aria-describedby="start-vin-help"
                  aria-invalid={vinMessage?.tone === 'error' || undefined}
                />
                <span
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  title="The 17-character number on the dashboard by the windshield, the driver's door frame, and the ownership papers."
                >
                  <Info className="h-4 w-4" aria-hidden />
                </span>
              </div>
              <p
                id="start-vin-help"
                className={cn(
                  'text-xs',
                  vinMessage?.tone === 'success' && 'text-success',
                  vinMessage?.tone === 'warning' && 'text-warning',
                  vinMessage?.tone === 'error' && 'font-medium text-destructive',
                  (!vinMessage || vinMessage.tone === 'muted') && 'text-muted-foreground',
                )}
              >
                {vinMessage?.text ??
                  'On the dashboard by the windshield, the driver’s door frame, or the ownership.'}
              </p>
            </div>

            {complete ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="start-style" className="text-sm font-medium">
                  Style<span className="text-primary">*</span>
                </label>
                {decode.isPending ? (
                  <p className="rounded-md border border-border px-3 py-2.5 text-sm text-muted-foreground">
                    Reading the VIN…
                  </p>
                ) : decoded ? (
                  <div className="relative">
                    <Select
                      id="start-style"
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                      className="h-11 pr-16"
                    >
                      {decoded.style ? (
                        <option value={decoded.style}>{decoded.style}</option>
                      ) : null}
                      <option value="">Not listed — I will fill it in</option>
                    </Select>
                    {style ? (
                      <button
                        type="button"
                        aria-label="Clear the style"
                        onClick={() => setStyle('')}
                        className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground">
                    {decode.error instanceof Error
                      ? decode.error.message
                      : 'This VIN could not be read.'}{' '}
                    Continue and fill in the model yourself.
                  </p>
                )}
              </div>
            ) : null}

            {decoded ? (
              <p className="flex items-center gap-2.5 border-b-2 border-success bg-success/10 px-4 py-3 text-sm">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                <span>
                  You&apos;ve entered a{' '}
                  <strong>
                    {decoded.year} {decoded.make} {decoded.model}
                  </strong>
                </span>
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-year" className="text-sm font-medium">
                Model year<span className="text-primary">*</span>
              </label>
              <Select
                id="start-year"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className="h-11"
              >
                <option value="">Please select</option>
                {YEARS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-make" className="text-sm font-medium">
                Brand<span className="text-primary">*</span>
              </label>
              <Input
                id="start-make"
                list="start-makes"
                value={make}
                placeholder="e.g. Honda"
                onChange={(event) => {
                  setMake(event.target.value);
                  setModel('');
                }}
                className="h-11"
              />
              <datalist id="start-makes">
                {(makes.data ?? []).map((option) => (
                  <option key={option.value} value={option.value} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-model" className="text-sm font-medium">
                Model<span className="text-primary">*</span>
              </label>
              <Input
                id="start-model"
                list="start-models"
                value={model}
                placeholder="e.g. CR-V"
                onChange={(event) => setModel(event.target.value)}
                className="h-11"
              />
              <datalist id="start-models">
                {(models.data ?? []).map((option) => (
                  <option key={option.value} value={option.value} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="start-trim" className="text-sm font-medium">
                Trim
              </label>
              <Input
                id="start-trim"
                value={trim}
                placeholder="Optional, e.g. SE"
                onChange={(event) => setTrim(event.target.value)}
                className="h-11"
              />
            </div>
            {year && make.trim() && model.trim() ? (
              <p className="flex items-center gap-2.5 border-b-2 border-success bg-success/10 px-4 py-3 text-sm">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                <span>
                  You&apos;ve entered a{' '}
                  <strong>
                    {year} {make.trim()} {model.trim()}
                  </strong>
                </span>
              </p>
            ) : null}
          </div>
        )}

        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={!canContinue}>
          Next
        </Button>
      </form>

      <div className="mt-8 border-t border-border pt-6 text-center text-sm">
        <p>Vehicle not found?</p>
        <button
          type="button"
          onClick={() => onNext({ ...BLANK_DRAFT, vin: complete ? clean : '' })}
          className="mt-1 font-semibold text-primary hover:underline"
        >
          Add the car manually
        </button>
      </div>
    </div>
  );
}
