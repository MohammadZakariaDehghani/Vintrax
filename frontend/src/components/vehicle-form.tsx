'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import {
  BODY_TYPES,
  CREATABLE_LISTING_STATUSES,
  DRIVETRAINS,
  FUEL_TYPES,
  MAX_LISTING_IMAGES,
  PROVINCES,
  PROVINCE_LABELS,
  TITLE_STATUSES,
  TITLE_STATUS_LABELS,
  type TitleStatus,
  SELLER_STATUS_TRANSITIONS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type ListingStatus,
  type UploadedVehicleImage,
  type VehicleDetail,
} from '@vintrax/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatEnum } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '@/components/ui';
import { PhotoOrganizer } from '@/components/photo-organizer';

interface FormImage {
  url: string;
  alt?: string;
}

const BLANK = {
  title: '',
  description: '',
  make: '',
  model: '',
  trim: '',
  year: String(new Date().getFullYear()),
  priceCad: '',
  reservePriceCad: '',
  mileageKm: '',
  condition: 'USED',
  bodyType: 'SUV',
  transmission: 'AUTOMATIC',
  fuelType: 'GASOLINE',
  drivetrain: 'FWD',
  engine: '',
  exteriorColour: '',
  interiorColour: '',
  vin: '',
  province: 'ON',
  city: '',
  titleStatus: '' as TitleStatus | '',
  status: 'DRAFT',
  saleChannel: 'FIXED_PRICE',
};

/**
 * The save control that closes every section.
 *
 * Every one of these submits the whole form, and that is deliberate rather than
 * a shortcut. A listing is validated as a whole — a price without a mileage is
 * not a valid half — so a per-section save would either write an invalid record
 * or refuse with an error about a field two sections away. What was asked for
 * was not having to scroll to the bottom of a long form to save, and this gives
 * that without inventing partial-save semantics the server does not have.
 *
 * Declared here rather than inside the form so it keeps one identity across
 * renders; a component defined in a render body is a different type each pass
 * and is remounted every keystroke.
 */
function SaveSection({
  isEditing,
  pending,
  saved,
}: {
  isEditing: boolean;
  pending: boolean;
  saved: boolean;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <Button type="submit" loading={pending}>
        <Save className="mr-2 h-4 w-4" aria-hidden />
        {isEditing ? 'Save changes' : 'Create listing'}
      </Button>
      <span className="text-sm text-muted-foreground">
        {saved ? 'Saved.' : 'Saves the whole listing, not only this section.'}
      </span>
    </div>
  );
}

/**
 * Moves a listing between the statuses its seller actually controls.
 *
 * The options come from `SELLER_STATUS_TRANSITIONS`, the same table the API
 * enforces, so the control cannot offer a move the server will refuse. `ACTIVE`
 * is in none of them: a seller submits for review and an administrator
 * publishes.
 */
function ListingStatusControl({
  vehicleId,
  status,
  onChanged,
}: {
  vehicleId: string;
  status: ListingStatus;
  onChanged: () => void;
}) {
  const allowed = SELLER_STATUS_TRANSITIONS[status];
  const [next, setNext] = useState<string>(allowed[0] ?? '');

  const change = useMutation({
    mutationFn: (to: string) =>
      api.patch<VehicleDetail>(`/vehicles/${vehicleId}/status`, { status: to }),
    onSuccess: onChanged,
  });

  const explanation: Partial<Record<ListingStatus, string>> = {
    DRAFT: 'Not visible to buyers. Submit it for review to go live.',
    PENDING_REVIEW: 'Waiting for an administrator to approve it.',
    ACTIVE: 'Live on the marketplace.',
    IN_AUCTION: 'In a live auction — its status is set by the auction.',
    SOLD: 'Sold and off the market. Reopen it as a draft if the deal fell through.',
    ARCHIVED: 'Delisted. Restore it to draft to work on it again.',
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">Status</span>
      <p className="text-sm">
        <Badge variant={status === 'ACTIVE' ? 'success' : 'outline'}>{formatEnum(status)}</Badge>
      </p>
      <p className="text-xs text-muted-foreground">{explanation[status]}</p>

      {allowed.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <label htmlFor="next-status" className="sr-only">
            Move this listing to
          </label>
          <Select
            id="next-status"
            className="w-auto"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          >
            {allowed.map((option) => (
              <option key={option} value={option}>
                {formatEnum(option)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={change.isPending}
            onClick={() => change.mutate(next)}
          >
            Update status
          </Button>
        </div>
      ) : null}

      <ErrorAlert error={change.error} className="mt-2" />
    </div>
  );
}

export function VehicleForm({ vehicleId }: { vehicleId?: string }) {
  const isEditing = Boolean(vehicleId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState(BLANK);
  const [images, setImages] = useState<FormImage[]>([]);
  const [features, setFeatures] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Cleared by the next edit, so "Saved." never sits over unsaved changes. */
  const [saved, setSaved] = useState(false);

  const { data: existing, isPending: loadingExisting } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      title: existing.title,
      description: existing.description,
      make: existing.make,
      model: existing.model,
      trim: existing.trim ?? '',
      year: String(existing.year),
      priceCad: String(existing.priceCad),
      reservePriceCad: '',
      mileageKm: String(existing.mileageKm),
      condition: existing.condition,
      bodyType: existing.bodyType,
      transmission: existing.transmission,
      fuelType: existing.fuelType,
      drivetrain: existing.drivetrain,
      engine: existing.engine ?? '',
      exteriorColour: existing.exteriorColour ?? '',
      interiorColour: existing.interiorColour ?? '',
      vin: existing.vin ?? '',
      province: existing.province,
      city: existing.city,
      titleStatus: existing.titleStatus ?? '',
      status: existing.status,
      saleChannel: existing.saleChannel,
    });
    setImages(existing.images.map((image) => ({ url: image.url, alt: image.alt ?? undefined })));
    setFeatures(existing.features.join(', '));
  }, [existing]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setSaved(false);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<VehicleDetail>(`/vehicles/${vehicleId}`, payload)
        : api.post<VehicleDetail>('/vehicles', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });

      // Editing stays put. Now that every section ends with a save control,
      // navigating away on each one would throw a dealer back to the inventory
      // list halfway down the form they were filling in — which is the opposite
      // of what those buttons are for. Creating still leaves, because the form
      // has no id to keep editing and staying would invite a second create.
      if (isEditing) {
        setSaved(true);
        void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
        void queryClient.invalidateQueries({ queryKey: ['vehicle-history', vehicleId] });
      } else {
        router.push('/dealer/inventory');
      }
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<UploadedVehicleImage>('/uploads/images', file),
    onSuccess: (result) => {
      setSaved(false);
      setImages((previous) => [...previous, { url: result.url }]);
    },
  });

  function handleFiles(files: FileList | null) {
    setUploadError(null);
    if (!files?.length) return;

    // Trim to the remaining slots rather than uploading files the listing
    // cannot hold and failing later at save time.
    const remaining = MAX_LISTING_IMAGES - images.length;
    const selected = Array.from(files).slice(0, Math.max(0, remaining));
    if (selected.length < files.length) {
      setUploadError(`A listing can have at most ${MAX_LISTING_IMAGES} photos.`);
    }

    for (const file of selected) {
      upload.mutate(file, {
        onError: (error) =>
          setUploadError(error instanceof Error ? error.message : 'Upload failed'),
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      title: form.title,
      description: form.description,
      make: form.make,
      model: form.model,
      // Optional strings must be omitted when blank, not sent as "".
      ...(form.trim ? { trim: form.trim } : {}),
      year: Number(form.year),
      priceCad: Number(form.priceCad),
      mileageKm: Number(form.mileageKm),
      ...(form.reservePriceCad ? { reservePriceCad: Number(form.reservePriceCad) } : {}),
      condition: form.condition,
      bodyType: form.bodyType,
      transmission: form.transmission,
      fuelType: form.fuelType,
      drivetrain: form.drivetrain,
      ...(form.engine ? { engine: form.engine } : {}),
      ...(form.exteriorColour ? { exteriorColour: form.exteriorColour } : {}),
      ...(form.interiorColour ? { interiorColour: form.interiorColour } : {}),
      ...(form.vin ? { vin: form.vin } : {}),
      province: form.province,
      city: form.city,
      // Sent as an empty string when cleared, not omitted: omitting it on an
      // edit would leave the stored value in place, so a seller could never
      // remove a link or a brand once set.
      titleStatus: form.titleStatus === '' ? undefined : form.titleStatus,
      saleChannel: form.saleChannel,
      // Only on create. `updateVehicleSchema` omits `status`, so sending it on
      // an edit is silently stripped — the save appears to work and the status
      // does not move. It has its own endpoint; see ListingStatusControl.
      ...(isEditing ? {} : { status: form.status }),
      features: features
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      images,
    });
  }

  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (field: string) => error?.fieldError(field);

  if (isEditing && loadingExisting) return <Spinner label="Loading vehicle" />;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? 'Edit vehicle' : 'Add a vehicle'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ErrorAlert error={save.error} />

          <Field
            label="Listing title"
            htmlFor="title"
            hint="e.g. 2022 Toyota RAV4 XLE AWD"
            error={fieldError('title')}
          >
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              aria-invalid={Boolean(fieldError('title'))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Make" htmlFor="make" error={fieldError('make')}>
              <Input
                id="make"
                required
                value={form.make}
                onChange={(e) => set('make', e.target.value)}
              />
            </Field>
            <Field label="Model" htmlFor="model" error={fieldError('model')}>
              <Input
                id="model"
                required
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
              />
            </Field>
            <Field label="Trim (optional)" htmlFor="trim">
              <Input id="trim" value={form.trim} onChange={(e) => set('trim', e.target.value)} />
            </Field>
            <Field label="Model year" htmlFor="year" error={fieldError('year')}>
              <Input
                id="year"
                type="number"
                required
                value={form.year}
                onChange={(e) => set('year', e.target.value)}
              />
            </Field>
            <Field label="Price (CAD)" htmlFor="priceCad" error={fieldError('priceCad')}>
              <Input
                id="priceCad"
                type="number"
                min={1}
                required
                value={form.priceCad}
                onChange={(e) => set('priceCad', e.target.value)}
              />
            </Field>
            <Field label="Mileage (km)" htmlFor="mileageKm" error={fieldError('mileageKm')}>
              <Input
                id="mileageKm"
                type="number"
                min={0}
                required
                value={form.mileageKm}
                onChange={(e) => set('mileageKm', e.target.value)}
              />
            </Field>
          </div>

          <SaveSection isEditing={isEditing} pending={save.isPending} saved={saved} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['condition', 'Condition', VEHICLE_CONDITIONS],
                ['bodyType', 'Body type', BODY_TYPES],
                ['transmission', 'Transmission', TRANSMISSIONS],
                ['fuelType', 'Fuel type', FUEL_TYPES],
                ['drivetrain', 'Drivetrain', DRIVETRAINS],
              ] as const
            ).map(([key, label, options]) => (
              <Field key={key} label={label} htmlFor={key}>
                <Select id={key} value={form[key]} onChange={(e) => set(key, e.target.value)}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {formatEnum(option)}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}

            <Field label="Engine (optional)" htmlFor="engine">
              <Input
                id="engine"
                value={form.engine}
                onChange={(e) => set('engine', e.target.value)}
                placeholder="2.5L I4"
              />
            </Field>
            <Field label="Exterior colour" htmlFor="exteriorColour">
              <Input
                id="exteriorColour"
                value={form.exteriorColour}
                onChange={(e) => set('exteriorColour', e.target.value)}
              />
            </Field>
            <Field label="Interior colour" htmlFor="interiorColour">
              <Input
                id="interiorColour"
                value={form.interiorColour}
                onChange={(e) => set('interiorColour', e.target.value)}
              />
            </Field>
            <Field
              label="VIN (optional)"
              htmlFor="vin"
              hint="17 characters. Builds buyer trust."
              error={fieldError('vin')}
            >
              <Input
                id="vin"
                maxLength={17}
                value={form.vin}
                onChange={(e) => set('vin', e.target.value.toUpperCase())}
                aria-invalid={Boolean(fieldError('vin'))}
              />
            </Field>
            <Field label="Province" htmlFor="province">
              <Select
                id="province"
                value={form.province}
                onChange={(e) => set('province', e.target.value)}
              >
                {PROVINCES.map((province) => (
                  <option key={province} value={province}>
                    {PROVINCE_LABELS[province]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="City" htmlFor="city" error={fieldError('city')}>
              <Input
                id="city"
                required
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </Field>
            {/* CARFAX moved to its own "Vehicle history" section below, on the
                edit page only — the link, the two report badges, reading the
                report and the timeline editor now live together in one place
                instead of being split across this form and three more cards.
                A brand-new listing has no id to attach any of that to, so
                Title is the field that used to share this row with it. */}
            <Field
              label="Title"
              htmlFor="titleStatus"
              error={fieldError('titleStatus')}
              hint="Left unset if you do not say. Vintrax will not assume a title is clean."
            >
              <Select
                id="titleStatus"
                value={form.titleStatus}
                onChange={(e) => set('titleStatus', e.target.value as TitleStatus | '')}
              >
                <option value="">Not stated</option>
                {TITLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TITLE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Features (comma separated)" htmlFor="features" className="mt-4">
            <Input
              id="features"
              value={features}
              onChange={(e) => {
                setSaved(false);
                setFeatures(e.target.value);
              }}
              placeholder="Sunroof, Heated seats, Apple CarPlay"
            />
          </Field>

          <SaveSection isEditing={isEditing} pending={save.isPending} saved={saved} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            The first photo is the main photo, shown in search results. Up to {MAX_LISTING_IMAGES}{' '}
            photos.
          </p>

          {uploadError ? (
            <div
              role="alert"
              className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {uploadError}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            aria-label="Upload vehicle photos"
            disabled={images.length >= MAX_LISTING_IMAGES || upload.isPending}
            onChange={(e) => handleFiles(e.target.files)}
            className="text-sm"
          />

          {upload.isPending ? (
            <p className="mt-2 text-sm text-muted-foreground">Uploading…</p>
          ) : null}

          <PhotoOrganizer
            images={images}
            onChange={(next) => {
              setSaved(false);
              setImages(next);
            }}
          />

          <SaveSection isEditing={isEditing} pending={save.isPending} saved={saved} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Description and status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            label="Tell buyers about this vehicle"
            htmlFor="description"
            hint="Service history, features, and anything a buyer should know. Minimum 20 characters."
            error={fieldError('description')}
          >
            <Textarea
              id="description"
              required
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              aria-invalid={Boolean(fieldError('description'))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {isEditing ? (
              // Status is not part of the update payload — the API rejects the
              // field, because publishing is a moderation decision. It moves
              // through its own endpoint, which is a separate action with its
              // own rules, so it gets its own control rather than riding along
              // with "Save changes" and silently doing nothing.
              <ListingStatusControl
                vehicleId={vehicleId!}
                status={existing?.status ?? 'DRAFT'}
                onChanged={() => {
                  void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
                  void queryClient.invalidateQueries({ queryKey: ['my-inventory'] });
                }}
              />
            ) : (
              <Field
                label="Status"
                htmlFor="status"
                hint="A new listing starts as a draft. Submitting for review sends it to an administrator to publish."
                error={fieldError('status')}
              >
                <Select
                  id="status"
                  value={form.status}
                  onChange={(e) => set('status', e.target.value)}
                >
                  {CREATABLE_LISTING_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatEnum(status)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="How it sells" htmlFor="saleChannel">
              <Select
                id="saleChannel"
                value={form.saleChannel}
                onChange={(e) => set('saleChannel', e.target.value)}
              >
                <option value="FIXED_PRICE">Fixed price</option>
                <option value="ACCEPTING_OFFERS">Accepting offers</option>
              </Select>
            </Field>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" loading={save.isPending}>
              <Save className="mr-2 h-4 w-4" aria-hidden />
              {isEditing ? 'Save changes' : 'Create listing'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/dealer/inventory')}
            >
              Cancel
            </Button>
            {saved ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
