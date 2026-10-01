'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Image as ImageIcon,
  Info,
  ListChecks,
  Loader2,
  Sparkles,
  Upload,
  X,
  Youtube,
} from 'lucide-react';
import {
  BODY_TYPES,
  DRIVETRAINS,
  EQUIPMENT_GROUPS,
  EXTERIOR_COLOURS,
  FUEL_TYPES,
  INTERIOR_COLOURS,
  MAX_LISTING_IMAGES,
  OWNER_COUNT_OPTIONS,
  PROVINCES,
  PROVINCE_LABELS,
  TITLE_STATUSES,
  TITLE_STATUS_LABELS,
  TRANSMISSIONS,
  VEHICLE_AVAILABILITIES,
  VEHICLE_AVAILABILITY_LABELS,
  VEHICLE_CONDITIONS,
  maxModelYear,
  ownerCountLabel,
  vinCheckDigitMatches,
  youTubeVideoId,
  type CarValueOption,
  type ColourSwatch,
  type ListingQualityArea,
  type ListingStatus,
  type TitleStatus,
  type UploadedVehicleImage,
  type VehicleDetail,
  type VinDecodeResult,
} from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { cn, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Button, ErrorAlert, Input, Select, Textarea } from '@/components/ui';
import { PhotoOrganizer } from '@/components/photo-organizer';
import { useUser } from '@/store/auth-store';
import {
  BLANK_DRAFT,
  LISTING_SECTIONS,
  autoTitle,
  draftFromDecode,
  draftQuality,
  sectionState,
  toPayload,
  validateDraft,
  type DraftErrors,
  type DraftField,
  type ListingDraft,
  type SectionState,
} from './listing-draft';
import { ListingTimeline } from './listing-timeline';

// --- Small inputs --------------------------------------------------------------

/** A labelled field whose error appears under it once the dealer has been there. */
function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  counter,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  counter?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required ? <span className="text-primary">*</span> : null}
        </label>
      ) : (
        <p className="text-sm font-medium">
          {label}
          {required ? <span className="text-primary">*</span> : null}
        </p>
      )}
      {children}
      {error || hint || counter ? (
        <div className="flex items-start justify-between gap-3 text-xs">
          {error ? (
            <p className="font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-muted-foreground">{hint}</p>
          )}
          {counter ? <span className="shrink-0 text-muted-foreground">{counter}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A text input with a unit or currency sign inside its right edge. */
function AffixInput({
  suffix,
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { suffix: string; invalid?: boolean }) {
  return (
    <div className="relative">
      <Input
        {...props}
        aria-invalid={invalid || undefined}
        className={cn(
          'pr-12',
          invalid && 'border-destructive focus-visible:ring-destructive/40',
          className,
        )}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

function SwatchGroup({
  name,
  label,
  swatches,
  value,
  onChange,
}: {
  name: string;
  label: string;
  swatches: readonly ColourSwatch[];
  value: string;
  onChange: (next: string) => void;
}) {
  const known = swatches.some((swatch) => swatch.name.toLowerCase() === value.toLowerCase());
  return (
    <fieldset>
      <legend className="mb-2.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 xl:grid-cols-6">
        {swatches.map((swatch) => {
          const checked = swatch.name.toLowerCase() === value.toLowerCase();
          return (
            <label key={swatch.name} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                className="peer sr-only"
                checked={checked}
                onChange={() => onChange(swatch.name)}
                onClick={() => {
                  // A second click on the chosen colour clears it.
                  if (checked) onChange('');
                }}
              />
              <span
                aria-hidden
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full border border-black/15 shadow-inner ring-offset-2 ring-offset-card peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                  checked && 'ring-2 ring-primary',
                )}
                style={{ backgroundColor: swatch.hex }}
              >
                {checked ? (
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      ['White', 'Silver', 'Beige', 'Yellow', 'Gold'].includes(swatch.name)
                        ? 'bg-black'
                        : 'bg-white',
                    )}
                  />
                ) : null}
              </span>
              {swatch.name}
            </label>
          );
        })}
      </div>
      {value && !known ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Currently “{value}”. Choose a colour above to replace it.
        </p>
      ) : null}
    </fieldset>
  );
}

function RadioRow<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="h-4 w-4 accent-primary"
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function Section({
  id,
  title,
  required,
  description,
  children,
}: {
  id: string;
  title: string;
  required?: boolean;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-section={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-32 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7 lg:scroll-mt-24"
    >
      <h2
        id={`${id}-heading`}
        tabIndex={-1}
        className="text-lg font-semibold tracking-tight outline-none"
      >
        {title}
        {required ? <span className="text-primary">*</span> : null}
      </h2>
      {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </section>
  );
}

const YEARS = Array.from({ length: maxModelYear() - 1949 }, (_, index) =>
  String(maxModelYear() - index),
);

const QUALITY_ICON: Record<ListingQualityArea, typeof ImageIcon> = {
  PHOTOS: ImageIcon,
  DESCRIPTION: ListChecks,
  VEHICLE_DATA: Info,
};

// --- The form ------------------------------------------------------------------

export interface ListingFormProps {
  initial: ListingDraft;
  /** Set when editing an existing listing. */
  vehicleId?: string;
  status?: ListingStatus;
}

/**
 * The dealer's listing form: one long page of sections, a timeline beside it
 * showing what is done and what is missing, and a bar pinned to the bottom to
 * cancel, save a draft or publish. The same form edits an existing listing.
 */
export function ListingForm({ initial, vehicleId, status }: ListingFormProps) {
  const isEditing = Boolean(vehicleId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useUser();

  const [draft, setDraft] = useState<ListingDraft>(() => {
    // A new listing starts where the dealership is.
    if (isEditing || initial.province || initial.city) return initial;
    return {
      ...initial,
      province: user?.dealer?.province ?? user?.province ?? '',
      city: user?.dealer?.city ?? user?.city ?? '',
    };
  });
  const [touched, setTouched] = useState<ReadonlySet<DraftField>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [active, setActive] = useState(LISTING_SECTIONS[0]!.id);
  const [saved, setSaved] = useState(false);

  const set = useCallback(<K extends DraftField>(field: K, value: ListingDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSaved(false);
  }, []);
  const touch = (field: DraftField) =>
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const quality = useMemo(() => draftQuality(draft), [draft]);
  const states = useMemo(
    () =>
      Object.fromEntries(
        LISTING_SECTIONS.map((section) => [
          section.id,
          sectionState(section, draft, errors, quality),
        ]),
      ) as Record<string, SectionState>,
    [draft, errors, quality],
  );

  // The server has the last word; its field errors show beside the field too.
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const shown = (field: DraftField): string | undefined =>
    serverErrors[field] ?? (attempted || touched.has(field) ? errors[field] : undefined);
  const bind = (field: DraftField) => ({
    id: `listing-${field}`,
    onBlur: () => touch(field),
    'aria-invalid': Boolean(shown(field)) || undefined,
    'aria-describedby': undefined,
  });

  // --- Which section is on screen ---------------------------------------------
  useEffect(() => {
    const elements = LISTING_SECTIONS.map((section) => document.getElementById(section.id)).filter(
      (element): element is HTMLElement => element !== null,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          const top = visible.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0]!;
          setActive(top.target.id);
        }
      },
      { rootMargin: '-25% 0px -65% 0px' },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    setActive(id);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
  };

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // --- Makes and models to suggest ---------------------------------------------
  const makes = useQuery({
    queryKey: ['car-value', 'makes'],
    queryFn: () => api.get<CarValueOption[]>('/car-value/makes'),
    staleTime: 10 * 60_000,
  });
  const models = useQuery({
    queryKey: ['car-value', 'models', draft.make.trim().toLowerCase()],
    queryFn: () =>
      api.get<CarValueOption[]>(`/car-value/models?make=${encodeURIComponent(draft.make.trim())}`),
    enabled: draft.make.trim().length > 0,
    staleTime: 10 * 60_000,
  });

  // --- Decode ------------------------------------------------------------------
  const decode = useMutation({
    mutationFn: (vin: string) => api.get<VinDecodeResult>(`/vin/${encodeURIComponent(vin)}`),
    onSuccess: (decoded) => {
      setDraft((current) => draftFromDecode(current, decoded));
      setDirty(true);
    },
  });

  // --- Photos ------------------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<UploadedVehicleImage>('/uploads/images', file),
  });

  async function addFiles(list: FileList | File[] | null) {
    setUploadError(null);
    const files = Array.from(list ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    const room = MAX_LISTING_IMAGES - draft.images.length;
    const chosen = files.slice(0, Math.max(0, room));
    if (chosen.length < files.length) {
      setUploadError(`A listing can have at most ${MAX_LISTING_IMAGES} photos.`);
    }
    setUploading((count) => count + chosen.length);
    // One at a time, so the photos keep the order they were chosen in.
    for (const file of chosen) {
      try {
        const stored = await upload.mutateAsync(file);
        setDraft((current) => ({ ...current, images: [...current.images, { url: stored.url }] }));
        setDirty(true);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'A photo could not be uploaded.');
      } finally {
        setUploading((count) => count - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  // --- Video -------------------------------------------------------------------
  const [videoText, setVideoText] = useState(initial.videoUrl);
  const videoId = youTubeVideoId(draft.videoUrl);
  const videoTextInvalid = videoText.trim() !== '' && !youTubeVideoId(videoText);

  // --- Saving ------------------------------------------------------------------
  const save = useMutation({
    mutationFn: async (mode: 'draft' | 'publish' | 'save') => {
      if (!isEditing) {
        return api.post<VehicleDetail>(
          '/vehicles',
          toPayload(draft, { status: mode === 'publish' ? 'PENDING_REVIEW' : 'DRAFT' }),
        );
      }
      const updated = await api.patch<VehicleDetail>(
        `/vehicles/${vehicleId}`,
        toPayload(draft, {}),
      );
      if (mode === 'publish' && (status === 'DRAFT' || status === 'ARCHIVED')) {
        return api.patch<VehicleDetail>(`/vehicles/${vehicleId}/status`, {
          status: 'PENDING_REVIEW',
        });
      }
      return updated;
    },
    onSuccess: (vehicle, mode) => {
      setDirty(false);
      setServerErrors({});
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['dealer-inventory-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      if (isEditing) {
        void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
        setSaved(true);
        if (mode === 'publish') router.push(`/dealer/inventory?open=${vehicle.id}`);
      } else {
        router.push(`/dealer/inventory?open=${vehicle.id}`);
      }
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      const next: DraftErrors = {};
      for (const field of Object.keys(BLANK_DRAFT) as DraftField[]) {
        const message = error.fieldError(field);
        if (message) next[field] = message;
      }
      setServerErrors(next);
    },
  });

  function submit(mode: 'draft' | 'publish' | 'save') {
    setAttempted(true);
    const firstBad = LISTING_SECTIONS.find((section) =>
      section.fields.some((field) => errors[field]),
    );
    if (firstBad) {
      goTo(firstBad.id);
      return;
    }
    save.mutate(mode);
  }

  // Clear a server error as soon as its field is edited.
  useEffect(() => {
    setServerErrors((current) => (Object.keys(current).length ? {} : current));
  }, [draft]);

  const headline = autoTitle(draft) || (isEditing ? 'Edit vehicle' : 'New vehicle');
  const vin = draft.vin.trim().toUpperCase();
  const vinComplete = vin.length === 17 && !errors.vin;
  const priceCriteria: Array<{ label: string; value: string | null }> = [
    { label: 'Brand', value: draft.make.trim() || null },
    {
      label: 'Mileage',
      value: draft.mileageKm.trim() ? formatKm(Number(draft.mileageKm.replace(/\D/g, ''))) : null,
    },
    { label: 'Model', value: draft.model.trim() || null },
    { label: 'Fuel type', value: draft.fuelType ? formatEnum(draft.fuelType) : null },
    { label: 'Model year', value: draft.year || null },
    { label: 'Transmission', value: draft.transmission ? formatEnum(draft.transmission) : null },
    { label: 'Vehicle condition', value: draft.condition ? formatEnum(draft.condition) : null },
    { label: 'Cylinders', value: draft.cylinders.trim() || null },
    { label: 'Body style', value: draft.bodyType ? formatEnum(draft.bodyType) : null },
    {
      label: 'Asking price',
      value: draft.priceCad.trim() ? formatPrice(Number(draft.priceCad.replace(/\D/g, ''))) : null,
    },
    { label: 'Number of doors', value: draft.doors.trim() || null },
    {
      label: 'MSRP price',
      value: draft.msrpCad.trim() ? formatPrice(Number(draft.msrpCad.replace(/\D/g, ''))) : null,
    },
  ];

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit(isEditing ? 'save' : 'publish');
      }}
      className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]"
    >
      <ListingTimeline
        title={headline}
        sections={LISTING_SECTIONS}
        states={states}
        active={active}
        onSelect={goTo}
      />

      <div className="flex min-w-0 flex-col gap-4 pb-4">
        {/* 1. VIN & model */}
        <Section id="vin-model" title="VIN & model" required>
          <div className="grid max-w-2xl gap-5">
            <FormField
              label="Vehicle identification number (VIN)"
              htmlFor="listing-vin"
              error={
                shown('vin') ?? (decode.error instanceof Error ? decode.error.message : undefined)
              }
              hint={
                vinComplete
                  ? vinCheckDigitMatches(vin)
                    ? 'Your VIN is valid.'
                    : 'The check digit does not match — look at the VIN again. Some imported vehicles do not have one.'
                  : 'VIN or stock number required.'
              }
              counter={`${vin.length}/17`}
            >
              <div className="flex gap-3">
                <Input
                  {...bind('vin')}
                  value={draft.vin}
                  maxLength={17}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono uppercase tracking-[0.15em]"
                  onChange={(event) =>
                    set('vin', event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  disabled={!vinComplete}
                  loading={decode.isPending}
                  onClick={() => decode.mutate(vin)}
                >
                  Decode
                </Button>
              </div>
            </FormField>
            {decode.isSuccess ? (
              <p className="flex items-center gap-2 rounded-md border-l-4 border-success bg-success/10 px-3 py-2 text-sm">
                <Check className="h-4 w-4 text-success" aria-hidden />
                Filled in from the VIN: {decode.data.year} {decode.data.make} {decode.data.model}
                {decode.data.trim ? ` ${decode.data.trim}` : ''}. Check each field before
                publishing.
              </p>
            ) : null}

            <FormField
              label="Stock number"
              htmlFor="listing-stockNumber"
              error={shown('stockNumber')}
              hint="Your own reference. VIN or stock number required."
              counter={`${draft.stockNumber.length}/50`}
            >
              <Input
                {...bind('stockNumber')}
                value={draft.stockNumber}
                maxLength={50}
                placeholder="Please enter"
                onChange={(event) => set('stockNumber', event.target.value)}
              />
            </FormField>

            {draft.style ? (
              <FormField label="Style" htmlFor="listing-style" hint="From the VIN decoder.">
                <Input id="listing-style" value={draft.style} disabled readOnly />
              </FormField>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Brand" htmlFor="listing-make" required error={shown('make')}>
                <Input
                  {...bind('make')}
                  list="listing-makes"
                  value={draft.make}
                  maxLength={60}
                  placeholder="e.g. Honda"
                  onChange={(event) => set('make', event.target.value)}
                />
                <datalist id="listing-makes">
                  {(makes.data ?? []).map((option) => (
                    <option key={option.value} value={option.value} />
                  ))}
                </datalist>
              </FormField>
              <FormField label="Model" htmlFor="listing-model" required error={shown('model')}>
                <Input
                  {...bind('model')}
                  list="listing-models"
                  value={draft.model}
                  maxLength={60}
                  placeholder="e.g. CR-V"
                  onChange={(event) => set('model', event.target.value)}
                />
                <datalist id="listing-models">
                  {(models.data ?? []).map((option) => (
                    <option key={option.value} value={option.value} />
                  ))}
                </datalist>
              </FormField>
              <FormField label="Model year" htmlFor="listing-year" required error={shown('year')}>
                <Select
                  {...bind('year')}
                  value={draft.year}
                  onChange={(event) => set('year', event.target.value)}
                >
                  <option value="">Please select</option>
                  {YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Trim" htmlFor="listing-trim" hint="e.g. SE, XLE, Sport">
                <Input
                  {...bind('trim')}
                  value={draft.trim}
                  maxLength={60}
                  onChange={(event) => set('trim', event.target.value)}
                />
              </FormField>
              <FormField
                label="Body style"
                htmlFor="listing-bodyType"
                required
                error={shown('bodyType')}
              >
                <Select
                  {...bind('bodyType')}
                  value={draft.bodyType}
                  onChange={(event) => set('bodyType', event.target.value)}
                >
                  <option value="">Please select</option>
                  {BODY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {formatEnum(type)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="Listing headline"
                htmlFor="listing-title"
                error={shown('title')}
                hint="Leave blank to use the year, brand, model and trim."
              >
                <Input
                  {...bind('title')}
                  value={draft.title}
                  maxLength={160}
                  placeholder={autoTitle(draft) || 'e.g. 2000 Honda CR-V SE'}
                  onChange={(event) => set('title', event.target.value)}
                />
              </FormField>
              <FormField
                label="Province"
                htmlFor="listing-province"
                required
                error={shown('province')}
              >
                <Select
                  {...bind('province')}
                  value={draft.province}
                  onChange={(event) => set('province', event.target.value)}
                >
                  <option value="">Please select</option>
                  {PROVINCES.map((province) => (
                    <option key={province} value={province}>
                      {PROVINCE_LABELS[province]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="City" htmlFor="listing-city" required error={shown('city')}>
                <Input
                  {...bind('city')}
                  value={draft.city}
                  maxLength={80}
                  onChange={(event) => set('city', event.target.value)}
                />
              </FormField>
            </div>
          </div>
        </Section>

        {/* 2. Features */}
        <Section id="features" title="Features">
          <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
            <FormField label="Number of doors" htmlFor="listing-doors" error={shown('doors')}>
              <Input
                {...bind('doors')}
                inputMode="numeric"
                value={draft.doors}
                onChange={(event) => set('doors', event.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            <FormField label="Number of seats" htmlFor="listing-seats" error={shown('seats')}>
              <Input
                {...bind('seats')}
                inputMode="numeric"
                value={draft.seats}
                onChange={(event) => set('seats', event.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          </div>
          <SwatchGroup
            name="exterior-colour"
            label="Exterior colour"
            swatches={EXTERIOR_COLOURS}
            value={draft.exteriorColour}
            onChange={(next) => set('exteriorColour', next)}
          />
          <FormField
            label="Manufacturer colour name"
            htmlFor="listing-manufacturerColour"
            error={shown('manufacturerColour')}
            hint="The maker's name for the paint, e.g. Satin Silver Metallic."
            counter={`${draft.manufacturerColour.length}/30`}
            className="max-w-md"
          >
            <Input
              {...bind('manufacturerColour')}
              value={draft.manufacturerColour}
              maxLength={30}
              placeholder="Please enter"
              onChange={(event) => set('manufacturerColour', event.target.value)}
            />
          </FormField>
          <SwatchGroup
            name="interior-colour"
            label="Interior colour"
            swatches={INTERIOR_COLOURS}
            value={draft.interiorColour}
            onChange={(next) => set('interiorColour', next)}
          />
          <FormField
            label="Vehicle empty weight"
            htmlFor="listing-curbWeightLbs"
            error={shown('curbWeightLbs')}
            className="max-w-md"
          >
            <AffixInput
              {...bind('curbWeightLbs')}
              suffix="lbs"
              inputMode="numeric"
              placeholder="Please enter"
              invalid={Boolean(shown('curbWeightLbs'))}
              value={draft.curbWeightLbs}
              onChange={(event) => set('curbWeightLbs', event.target.value.replace(/[^\d,]/g, ''))}
            />
          </FormField>
        </Section>

        {/* 3. Condition */}
        <Section id="condition" title="Condition" required>
          <div className="grid max-w-md gap-5">
            <FormField
              label="Vehicle condition"
              htmlFor="listing-condition"
              required
              error={shown('condition')}
              hint="Certified pre-owned only when it passed the maker's certification program."
            >
              <Select
                {...bind('condition')}
                value={draft.condition}
                onChange={(event) => set('condition', event.target.value)}
              >
                {VEHICLE_CONDITIONS.map((condition) => (
                  <option key={condition} value={condition}>
                    {formatEnum(condition)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Is the vehicle damaged?">
              <RadioRow
                name="listing-damaged"
                value={draft.isDamaged}
                options={[
                  { value: '', label: 'Unknown' },
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                onChange={(next) => set('isDamaged', next)}
              />
            </FormField>
            <FormField
              label="Mileage"
              htmlFor="listing-mileageKm"
              required
              error={shown('mileageKm')}
            >
              <AffixInput
                {...bind('mileageKm')}
                suffix="km"
                inputMode="numeric"
                placeholder="Please enter"
                invalid={Boolean(shown('mileageKm'))}
                value={draft.mileageKm}
                onChange={(event) => set('mileageKm', event.target.value.replace(/[^\d,]/g, ''))}
              />
            </FormField>
            <FormField label="Vehicle owners" htmlFor="listing-ownerCount">
              <Select
                {...bind('ownerCount')}
                value={draft.ownerCount}
                onChange={(event) => set('ownerCount', event.target.value)}
              >
                <option value="">Please select</option>
                {OWNER_COUNT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {ownerCountLabel(count)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Availability" htmlFor="listing-availability">
              <Select
                {...bind('availability')}
                value={draft.availability}
                onChange={(event) => set('availability', event.target.value)}
              >
                <option value="">Please select</option>
                {VEHICLE_AVAILABILITIES.map((availability) => (
                  <option key={availability} value={availability}>
                    {VEHICLE_AVAILABILITY_LABELS[availability]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Do you offer an additional warranty for this vehicle?"
              htmlFor="listing-extendedWarranty"
              hint="If an additional warranty is offered here, it must be included in the vehicle price."
            >
              <Select
                {...bind('extendedWarranty')}
                value={draft.extendedWarranty}
                onChange={(event) =>
                  set('extendedWarranty', event.target.value as '' | 'yes' | 'no')
                }
              >
                <option value="">Please select</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </FormField>
            <FormField
              label="Title"
              htmlFor="listing-titleStatus"
              hint="Left unset if you do not say. Vintrax never assumes a title is clean."
            >
              <Select
                {...bind('titleStatus')}
                value={draft.titleStatus}
                onChange={(event) => set('titleStatus', event.target.value as TitleStatus | '')}
              >
                <option value="">Not stated</option>
                {TITLE_STATUSES.map((titleStatus) => (
                  <option key={titleStatus} value={titleStatus}>
                    {TITLE_STATUS_LABELS[titleStatus]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        </Section>

        {/* 4. Equipment */}
        <Section
          id="equipment"
          title="Equipment"
          description={`${draft.equipment.length} selected. Buyers filter on these, so tick everything the vehicle has.`}
        >
          {EQUIPMENT_GROUPS.map((group) => (
            <fieldset key={group.name}>
              <legend className="mb-2.5 text-sm font-semibold">{group.name}</legend>
              <div className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {group.items.map((item) => {
                  const checked = draft.equipment.includes(item);
                  return (
                    <label key={item} className="flex cursor-pointer items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px] shrink-0 rounded accent-primary"
                        checked={checked}
                        onChange={(event) =>
                          set(
                            'equipment',
                            event.target.checked
                              ? [...draft.equipment, item]
                              : draft.equipment.filter((entry) => entry !== item),
                          )
                        }
                      />
                      {item}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <FormField
            label="Other features"
            htmlFor="listing-otherFeatures"
            hint="Anything not in the list above, separated by commas."
            className="max-w-2xl"
          >
            <Input
              {...bind('otherFeatures')}
              value={draft.otherFeatures}
              placeholder="e.g. Block heater, Tonneau cover"
              onChange={(event) => set('otherFeatures', event.target.value)}
            />
          </FormField>
        </Section>

        {/* 5. Transmission & engine */}
        <Section id="engine" title="Transmission & engine" required>
          <div className="grid max-w-md gap-5">
            <FormField
              label="Fuel type"
              htmlFor="listing-fuelType"
              required
              error={shown('fuelType')}
            >
              <Select
                {...bind('fuelType')}
                value={draft.fuelType}
                onChange={(event) => set('fuelType', event.target.value)}
              >
                <option value="">Please select</option>
                {FUEL_TYPES.map((fuel) => (
                  <option key={fuel} value={fuel}>
                    {formatEnum(fuel)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Drive type"
              htmlFor="listing-drivetrain"
              required
              error={shown('drivetrain')}
            >
              <Select
                {...bind('drivetrain')}
                value={draft.drivetrain}
                onChange={(event) => set('drivetrain', event.target.value)}
              >
                <option value="">Please select</option>
                {DRIVETRAINS.map((drive) => (
                  <option key={drive} value={drive}>
                    {drive === 'FOUR_WHEEL_DRIVE' ? '4x4' : formatEnum(drive)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Transmission"
              htmlFor="listing-transmission"
              required
              error={shown('transmission')}
            >
              <Select
                {...bind('transmission')}
                value={draft.transmission}
                onChange={(event) => set('transmission', event.target.value)}
              >
                <option value="">Please select</option>
                {TRANSMISSIONS.map((transmission) => (
                  <option key={transmission} value={transmission}>
                    {formatEnum(transmission)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Power (HP)" htmlFor="listing-horsepower" error={shown('horsepower')}>
              <AffixInput
                {...bind('horsepower')}
                suffix="hp"
                inputMode="numeric"
                invalid={Boolean(shown('horsepower'))}
                value={draft.horsepower}
                onChange={(event) => set('horsepower', event.target.value.replace(/\D/g, ''))}
              />
            </FormField>
            <FormField label="Engine" htmlFor="listing-engine" hint="e.g. 2.0L 4-cylinder turbo">
              <Input
                {...bind('engine')}
                value={draft.engine}
                maxLength={80}
                onChange={(event) => set('engine', event.target.value)}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Engine size"
                htmlFor="listing-engineSizeL"
                error={shown('engineSizeL')}
              >
                <AffixInput
                  {...bind('engineSizeL')}
                  suffix="L"
                  inputMode="decimal"
                  invalid={Boolean(shown('engineSizeL'))}
                  value={draft.engineSizeL}
                  onChange={(event) =>
                    set('engineSizeL', event.target.value.replace(/[^\d.]/g, ''))
                  }
                />
              </FormField>
              <FormField label="Cylinders" htmlFor="listing-cylinders" error={shown('cylinders')}>
                <Input
                  {...bind('cylinders')}
                  inputMode="numeric"
                  value={draft.cylinders}
                  onChange={(event) => set('cylinders', event.target.value.replace(/\D/g, ''))}
                />
              </FormField>
            </div>
          </div>
        </Section>

        {/* 6. Image & video */}
        <Section
          id="media"
          title="Image & video"
          description={`Upload up to ${MAX_LISTING_IMAGES} photos — the more angles, the better. Drag a photo to the front to make it the cover.`}
        >
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              'Clean the vehicle',
              'Cover the licence plate',
              'Highlight the special equipment',
              'Also show defects',
              `Upload up to ${MAX_LISTING_IMAGES} images`,
            ].map((tip) => (
              <li key={tip} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-success" aria-hidden />
                {tip}
              </li>
            ))}
          </ul>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDropping(false);
              void addFiles(event.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dropping ? 'border-primary bg-primary/5' : 'border-border bg-secondary/30',
            )}
          >
            {uploading > 0 ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
            )}
            <p className="text-sm">
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => fileInput.current?.click()}
                disabled={draft.images.length >= MAX_LISTING_IMAGES}
              >
                Select images
              </button>{' '}
              or drag and drop them here
            </p>
            <p className="text-xs text-muted-foreground">
              {uploading > 0
                ? `Uploading ${uploading} photo${uploading === 1 ? '' : 's'}…`
                : `JPG, PNG, WebP or AVIF · ${draft.images.length}/${MAX_LISTING_IMAGES}`}
            </p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              aria-label="Upload vehicle photos"
              onChange={(event) => void addFiles(event.target.files)}
            />
          </div>
          {uploadError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {uploadError}
            </p>
          ) : null}
          <PhotoOrganizer images={draft.images} onChange={(next) => set('images', next)} />

          <FormField
            label="YouTube video URL"
            htmlFor="listing-video"
            error={videoTextInvalid ? 'Use a YouTube video or Shorts link.' : shown('videoUrl')}
            hint="A walk-around video. Shown on the listing under the photos."
          >
            <div className="flex gap-3">
              <Input
                id="listing-video"
                value={videoText}
                placeholder="YouTube video or Shorts URL"
                onChange={(event) => setVideoText(event.target.value)}
                aria-invalid={videoTextInvalid || undefined}
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                disabled={!videoText.trim() || videoTextInvalid}
                onClick={() => set('videoUrl', videoText.trim())}
              >
                Add video
              </Button>
            </div>
          </FormField>
          {videoId ? (
            <div className="flex items-center gap-3 rounded-lg border border-border p-2 pr-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
                alt=""
                className="h-14 w-24 rounded bg-secondary object-cover"
                // Without the thumbnail the row still reads: the link and its icon stay.
                onError={(event) => {
                  event.currentTarget.style.visibility = 'hidden';
                }}
              />
              <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <Youtube className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{draft.videoUrl}</span>
              </p>
              <button
                type="button"
                aria-label="Remove the video"
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => {
                  set('videoUrl', '');
                  setVideoText('');
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </Section>

        {/* 7. Description */}
        <Section id="description" title="Description" required>
          <FormField
            label="Tell buyers about this vehicle"
            htmlFor="listing-description"
            required
            error={shown('description')}
            hint="Service history, recent work, tires, and why it is a good buy. Each sentence shows on its own line."
            counter={`${draft.description.length}/8000`}
          >
            <Textarea
              {...bind('description')}
              rows={9}
              maxLength={8000}
              value={draft.description}
              onChange={(event) => set('description', event.target.value)}
            />
          </FormField>
        </Section>

        {/* 8. Price */}
        <Section
          id="price"
          title="Price"
          required
          description="Buyers see the asking price. The other prices are for your own records — only you and Vintrax administrators see them."
        >
          <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
            <FormField
              label="Asking price"
              htmlFor="listing-priceCad"
              required
              error={shown('priceCad')}
            >
              <AffixInput
                {...bind('priceCad')}
                suffix="$"
                inputMode="numeric"
                invalid={Boolean(shown('priceCad'))}
                value={draft.priceCad}
                onChange={(event) => set('priceCad', event.target.value.replace(/[^\d,]/g, ''))}
              />
            </FormField>
            {(
              [
                ['salePriceCad', 'Sale price'],
                ['msrpCad', 'MSRP price'],
                ['invoicePriceCad', 'Invoice price'],
                ['retailPriceCad', 'Retail price'],
                ['wholesalePriceCad', 'Wholesale price'],
              ] as const
            ).map(([field, label]) => (
              <FormField
                key={field}
                label={label}
                htmlFor={`listing-${field}`}
                error={shown(field)}
              >
                <AffixInput
                  {...bind(field)}
                  suffix="$"
                  inputMode="numeric"
                  invalid={Boolean(shown(field))}
                  value={draft[field]}
                  onChange={(event) => set(field, event.target.value.replace(/[^\d,]/g, ''))}
                />
              </FormField>
            ))}
            <FormField label="How it sells" htmlFor="listing-saleChannel">
              <Select
                {...bind('saleChannel')}
                value={draft.saleChannel}
                onChange={(event) => set('saleChannel', event.target.value)}
              >
                <option value="FIXED_PRICE">Fixed price</option>
                <option value="ACCEPTING_OFFERS">Accepting offers</option>
              </Select>
            </FormField>
          </div>

          <div className="rounded-lg bg-secondary/50 p-4 sm:p-5">
            <h3 className="font-semibold">Improve your price label</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fill in the details below so buyers can judge the price fairly.
            </p>
            <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              {priceCriteria.map((criterion) => (
                <li key={criterion.label} className="flex items-center gap-2">
                  {criterion.value ? (
                    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  )}
                  <span className="font-medium">
                    {criterion.label}
                    {criterion.value ? `: ${criterion.value}` : ''}
                  </span>
                  <span className="sr-only">{criterion.value ? ', filled in' : ', missing'}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* 9. Listing quality */}
        <Section id="quality" title="Listing quality">
          <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Improve your listing quality</h3>
                <p
                  className={cn(
                    'mt-1 text-2xl font-bold tabular-nums',
                    quality.score >= 80
                      ? 'text-success'
                      : quality.score >= 50
                        ? 'text-warning'
                        : 'text-primary',
                  )}
                >
                  {quality.score}%
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Updates as you type
              </span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label="Listing quality"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={quality.score}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  quality.score >= 80
                    ? 'bg-success'
                    : quality.score >= 50
                      ? 'bg-warning'
                      : 'bg-primary',
                )}
                style={{ width: `${quality.score}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Listing quality affects how many enquiries you receive.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {quality.tips.map((tip) => {
                const Icon = QUALITY_ICON[tip.area];
                return (
                  <li key={tip.area} className="flex gap-3 text-sm">
                    <Icon
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        tip.done ? 'text-success' : 'text-muted-foreground',
                      )}
                      aria-hidden
                    />
                    <div>
                      <p className="font-medium">
                        {tip.area === 'PHOTOS'
                          ? 'Photos'
                          : tip.area === 'DESCRIPTION'
                            ? 'Description'
                            : 'Vehicle data'}
                      </p>
                      <p className="text-muted-foreground">{tip.message}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {quality.tips.some((tip) => tip.area === 'PHOTOS' && !tip.done) ? (
              <ul className="ml-7 mt-3 list-disc space-y-1 text-sm text-muted-foreground">
                <li>Choose a well-lit background in a different colour from the vehicle.</li>
                <li>Stand about ten steps away.</li>
                <li>Take the first photo diagonally from the front.</li>
                <li>Avoid oversized dealership logos.</li>
              </ul>
            ) : null}
          </div>
        </Section>

        <ErrorAlert error={save.error} />

        {/* The bar that stays at the bottom of the screen. */}
        <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.2)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:pr-20">
          {/* Clear of the help button in the corner, on every screen size. */}
          <div className="flex flex-wrap items-center justify-between gap-3 pr-16 sm:pr-0">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {saved
                ? 'Saved.'
                : isEditing
                  ? 'Please check all information before saving.'
                  : 'Please check all information before publishing. New listings go live once approved.'}
            </p>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push('/dealer/inventory')}
              >
                Cancel
              </Button>
              {isEditing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    loading={save.isPending && save.variables === 'save'}
                    onClick={() => submit('save')}
                  >
                    Save changes
                  </Button>
                  {status === 'DRAFT' || status === 'ARCHIVED' ? (
                    <Button
                      type="button"
                      loading={save.isPending && save.variables === 'publish'}
                      onClick={() => submit('publish')}
                    >
                      Publish
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    loading={save.isPending && save.variables === 'draft'}
                    onClick={() => submit('draft')}
                  >
                    Save as draft
                  </Button>
                  <Button type="submit" loading={save.isPending && save.variables === 'publish'}>
                    Publish
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
