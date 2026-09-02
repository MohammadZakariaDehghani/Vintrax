'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, X } from 'lucide-react';
import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  PROVINCES,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  createVehicleSchema,
} from '@atlas/shared';
import { ApiError } from '@/lib/api-client';
import { atlas } from '@/lib/atlas';
import { keys } from '@/lib/queries';
import { formatEnum } from '@/lib/format';
import { Button, Card, Field } from '@/components/ui';
import { AppBar } from '@/components/app-bar';
import { RequireAuth } from '@/components/require-auth';
import { CameraCapture } from '@/components/camera-capture';
import { useOnline } from '@/components/connectivity';

export default function AddVehiclePage() {
  return (
    <>
      <AppBar title="Add a vehicle" back />
      <RequireAuth permission="vehicle:write">
        <AddVehicleForm />
      </RequireAuth>
    </>
  );
}

interface UploadedPhoto {
  url: string;
  /** Only set while the upload is in flight, for the local preview. */
  localUrl?: string;
  uploading: boolean;
}

function AddVehicleForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useOnline();

  const [cameraOpen, setCameraOpen] = useState(false);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    make: '',
    model: '',
    year: '',
    priceCad: '',
    mileageKm: '',
    city: '',
    province: 'BC',
    condition: 'USED',
    bodyType: 'SUV',
    transmission: 'AUTOMATIC',
    fuelType: 'GASOLINE',
    drivetrain: 'AWD',
    description: '',
  });

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const fieldError = (field: string) =>
    error instanceof ApiError ? error.fieldError(field) : undefined;

  /**
   * Photos upload as they are taken rather than all at once on submit: on a
   * phone that keeps each upload small, and the seller sees progress instead
   * of one long wait at the end.
   */
  async function addPhoto(file: File) {
    const localUrl = URL.createObjectURL(file);
    const placeholder: UploadedPhoto = { url: '', localUrl, uploading: true };
    setPhotos((current) => [...current, placeholder]);

    try {
      const stored = await atlas.uploads.image(file);
      setPhotos((current) =>
        current.map((photo) =>
          photo.localUrl === localUrl ? { url: stored.url, uploading: false } : photo,
        ),
      );
    } catch (caught) {
      setPhotos((current) => current.filter((photo) => photo.localUrl !== localUrl));
      setError(caught instanceof Error ? caught : new Error('Photo upload failed'));
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    // Validated against the shared schema before it leaves the phone, so an
    // obvious mistake costs no round trip. The API validates it again — this
    // is a convenience, not the enforcement point.
    const candidate = {
      ...form,
      title: `${form.year} ${form.make} ${form.model}`.trim(),
      images: photos
        .filter((photo) => !photo.uploading && photo.url)
        .map((photo, index) => ({ url: photo.url, position: index })),
    };

    const parsed = createVehicleSchema.safeParse(candidate);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        details[key] = [...(details[key] ?? []), issue.message];
      }
      setError(new ApiError(400, 'Check the highlighted fields', details));
      setSubmitting(false);
      return;
    }

    try {
      const vehicle = await atlas.vehicles.create(parsed.data);
      await queryClient.invalidateQueries({ queryKey: keys.myVehicles() });
      router.replace(`/vehicles/${vehicle.slug}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Could not save the vehicle'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4 p-4" noValidate>
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Photos</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div
                key={photo.url || photo.localUrl}
                className="relative aspect-square overflow-hidden rounded-lg bg-muted"
              >
                {photo.uploading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 aria-hidden className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="sr-only">Uploading photo</span>
                  </div>
                ) : (
                  <>
                    <Image
                      src={photo.url}
                      alt={`Photo ${index + 1}`}
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X aria-hidden className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input text-xs text-muted-foreground active:bg-secondary"
            >
              <Camera aria-hidden className="h-6 w-6" />
              Add photo
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold">Vehicle</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Make"
              value={form.make}
              onChange={(event) => set('make')(event.target.value)}
              error={fieldError('make')}
              required
            />
            <Field
              label="Model"
              value={form.model}
              onChange={(event) => set('model')(event.target.value)}
              error={fieldError('model')}
              required
            />
            <Field
              label="Year"
              inputMode="numeric"
              value={form.year}
              onChange={(event) => set('year')(event.target.value.replace(/[^0-9]/g, ''))}
              error={fieldError('year')}
              required
            />
            <Field
              label="Mileage (km)"
              inputMode="numeric"
              value={form.mileageKm}
              onChange={(event) => set('mileageKm')(event.target.value.replace(/[^0-9]/g, ''))}
              error={fieldError('mileageKm')}
              required
            />
          </div>

          <Field
            label="Price (CAD)"
            inputMode="numeric"
            value={form.priceCad}
            onChange={(event) => set('priceCad')(event.target.value.replace(/[^0-9]/g, ''))}
            error={fieldError('priceCad')}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Condition"
              value={form.condition}
              options={VEHICLE_CONDITIONS}
              onChange={set('condition')}
            />
            <Select
              label="Body type"
              value={form.bodyType}
              options={BODY_TYPES}
              onChange={set('bodyType')}
            />
            <Select
              label="Transmission"
              value={form.transmission}
              options={TRANSMISSIONS}
              onChange={set('transmission')}
            />
            <Select label="Fuel" value={form.fuelType} options={FUEL_TYPES} onChange={set('fuelType')} />
            <Select
              label="Drivetrain"
              value={form.drivetrain}
              options={DRIVETRAINS}
              onChange={set('drivetrain')}
            />
            <Select
              label="Province"
              value={form.province}
              options={PROVINCES}
              onChange={set('province')}
            />
          </div>

          <Field
            label="City"
            value={form.city}
            onChange={(event) => set('city')(event.target.value)}
            error={fieldError('city')}
            required
          />

          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              rows={4}
              value={form.description}
              onChange={(event) => set('description')(event.target.value)}
              placeholder="Condition, service history, options worth calling out."
              aria-invalid={fieldError('description') ? true : undefined}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-base"
            />
            {fieldError('description') ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {fieldError('description')}
              </p>
            ) : null}
          </div>
        </section>

        {error && !(error instanceof ApiError && Object.keys(error.details).length > 0) ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error.message}
          </p>
        ) : null}

        {!online ? (
          <p role="status" className="text-sm font-medium text-warning">
            You are offline. This listing cannot be saved until the connection returns.
          </p>
        ) : null}

        <Card className="p-3">
          <p className="text-xs text-muted-foreground">
            The listing is created as a draft. Publishing and moderation stay where they already
            are — this screen does not bypass either.
          </p>
        </Card>

        <Button
          type="submit"
          size="large"
          fullWidth
          loading={submitting}
          disabled={!online || photos.some((photo) => photo.uploading)}
        >
          Save draft
        </Button>
      </form>

      {cameraOpen ? (
        <CameraCapture onCapture={(file) => void addPhoto(file)} onClose={() => setCameraOpen(false)} />
      ) : null}
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const id = `select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-touch w-full rounded-lg border border-input bg-background px-3 text-base"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {formatEnum(option)}
          </option>
        ))}
      </select>
    </div>
  );
}
