import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BODY_TYPES,
  DRIVETRAINS,
  FUEL_TYPES,
  LISTING_STATUSES,
  MAX_LISTING_IMAGES,
  PROVINCES,
  PROVINCE_LABELS,
  TRANSMISSIONS,
  VEHICLE_CONDITIONS,
  type ListingDetail,
} from '@atlas/shared';
import { ApiError, api } from '../lib/api-client';
import { ErrorAlert, Field, Spinner } from '../components/ui';
import { formatEnum } from '../lib/format';

interface FormImage {
  url: string;
  alt?: string;
}

const BLANK_FORM = {
  title: '',
  description: '',
  make: '',
  model: '',
  trim: '',
  year: String(new Date().getFullYear()),
  priceCad: '',
  mileageKm: '',
  condition: 'USED',
  bodyType: 'SUV',
  transmission: 'AUTOMATIC',
  fuelType: 'GASOLINE',
  drivetrain: 'FWD',
  exteriorColour: '',
  vin: '',
  province: 'ON',
  city: '',
  status: 'DRAFT',
};

type FormState = typeof BLANK_FORM;

export function ListingFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [images, setImages] = useState<FormImage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: existing, isPending: loadingExisting } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => api.get<ListingDetail>(`/listings/${id}`),
    enabled: isEditing,
  });

  // Populate the form once the listing being edited arrives.
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
      mileageKm: String(existing.mileageKm),
      condition: existing.condition,
      bodyType: existing.bodyType,
      transmission: existing.transmission,
      fuelType: existing.fuelType,
      drivetrain: existing.drivetrain,
      exteriorColour: existing.exteriorColour ?? '',
      vin: existing.vin ?? '',
      province: existing.province,
      city: existing.city,
      status: existing.status,
    });
    setImages(existing.images.map((image) => ({ url: image.url, alt: image.alt ?? undefined })));
  }, [existing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing
        ? api.patch<ListingDetail>(`/listings/${id}`, payload)
        : api.post<ListingDetail>('/listings', payload),
    onSuccess: (listing) => {
      void queryClient.invalidateQueries({ queryKey: ['my-listings'] });
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
      void queryClient.invalidateQueries({ queryKey: ['listing', listing.id] });
      navigate('/dashboard');
    },
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ url: string }>('/uploads/images', file),
    onSuccess: (result) => setImages((previous) => [...previous, { url: result.url }]),
  });

  function handleFiles(files: FileList | null) {
    setUploadError(null);
    if (!files?.length) return;

    // Trim the selection to the remaining slots rather than uploading files
    // the listing cannot hold and failing later at save time.
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

    // Reset so selecting the same file again still fires a change event.
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
      condition: form.condition,
      bodyType: form.bodyType,
      transmission: form.transmission,
      fuelType: form.fuelType,
      drivetrain: form.drivetrain,
      ...(form.exteriorColour ? { exteriorColour: form.exteriorColour } : {}),
      ...(form.vin ? { vin: form.vin } : {}),
      province: form.province,
      city: form.city,
      status: form.status,
      images,
    });
  }

  const error = save.error instanceof ApiError ? save.error : null;
  const fieldError = (field: string) => error?.fieldError(field);

  if (isEditing && loadingExisting) return <Spinner label="Loading listing" />;

  return (
    <>
      <p style={{ marginBottom: '1rem' }}>
        <Link to="/dashboard">← Back to my listings</Link>
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h1>{isEditing ? 'Edit listing' : 'Create a listing'}</h1>
          <p className="muted">
            Save as a draft while you gather photos and details, then publish when it is ready.
          </p>

          <ErrorAlert error={save.error} />

          <Field
            label="Listing title"
            htmlFor="title"
            hint="e.g. 2022 Toyota RAV4 XLE AWD"
            error={fieldError('title')}
          >
            <input
              id="title"
              type="text"
              required
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              aria-invalid={Boolean(fieldError('title'))}
            />
          </Field>

          <div className="form-grid">
            <Field label="Make" htmlFor="make" error={fieldError('make')}>
              <input
                id="make"
                type="text"
                required
                value={form.make}
                onChange={(event) => set('make', event.target.value)}
                aria-invalid={Boolean(fieldError('make'))}
              />
            </Field>

            <Field label="Model" htmlFor="model" error={fieldError('model')}>
              <input
                id="model"
                type="text"
                required
                value={form.model}
                onChange={(event) => set('model', event.target.value)}
                aria-invalid={Boolean(fieldError('model'))}
              />
            </Field>

            <Field label="Trim (optional)" htmlFor="trim" error={fieldError('trim')}>
              <input
                id="trim"
                type="text"
                value={form.trim}
                onChange={(event) => set('trim', event.target.value)}
              />
            </Field>

            <Field label="Model year" htmlFor="year" error={fieldError('year')}>
              <input
                id="year"
                type="number"
                required
                value={form.year}
                onChange={(event) => set('year', event.target.value)}
                aria-invalid={Boolean(fieldError('year'))}
              />
            </Field>

            <Field label="Price (CAD)" htmlFor="price" error={fieldError('priceCad')}>
              <input
                id="price"
                type="number"
                min={1}
                required
                value={form.priceCad}
                onChange={(event) => set('priceCad', event.target.value)}
                aria-invalid={Boolean(fieldError('priceCad'))}
              />
            </Field>

            <Field label="Mileage (km)" htmlFor="mileage" error={fieldError('mileageKm')}>
              <input
                id="mileage"
                type="number"
                min={0}
                required
                value={form.mileageKm}
                onChange={(event) => set('mileageKm', event.target.value)}
                aria-invalid={Boolean(fieldError('mileageKm'))}
              />
            </Field>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2>Specifications</h2>
          <div className="form-grid">
            <Field label="Condition" htmlFor="condition">
              <select
                id="condition"
                value={form.condition}
                onChange={(event) => set('condition', event.target.value)}
              >
                {VEHICLE_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatEnum(value)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Body type" htmlFor="bodyType">
              <select
                id="bodyType"
                value={form.bodyType}
                onChange={(event) => set('bodyType', event.target.value)}
              >
                {BODY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnum(value)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Transmission" htmlFor="transmission">
              <select
                id="transmission"
                value={form.transmission}
                onChange={(event) => set('transmission', event.target.value)}
              >
                {TRANSMISSIONS.map((value) => (
                  <option key={value} value={value}>
                    {formatEnum(value)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fuel type" htmlFor="fuelType">
              <select
                id="fuelType"
                value={form.fuelType}
                onChange={(event) => set('fuelType', event.target.value)}
              >
                {FUEL_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {formatEnum(value)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drivetrain" htmlFor="drivetrain">
              <select
                id="drivetrain"
                value={form.drivetrain}
                onChange={(event) => set('drivetrain', event.target.value)}
              >
                {DRIVETRAINS.map((value) => (
                  <option key={value} value={value}>
                    {formatEnum(value)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Exterior colour (optional)" htmlFor="colour">
              <input
                id="colour"
                type="text"
                value={form.exteriorColour}
                onChange={(event) => set('exteriorColour', event.target.value)}
              />
            </Field>

            <Field
              label="VIN (optional)"
              htmlFor="vin"
              hint="17 characters. Builds buyer trust."
              error={fieldError('vin')}
            >
              <input
                id="vin"
                type="text"
                maxLength={17}
                value={form.vin}
                onChange={(event) => set('vin', event.target.value.toUpperCase())}
                aria-invalid={Boolean(fieldError('vin'))}
              />
            </Field>

            <Field label="Province" htmlFor="province">
              <select
                id="province"
                value={form.province}
                onChange={(event) => set('province', event.target.value)}
              >
                {PROVINCES.map((value) => (
                  <option key={value} value={value}>
                    {PROVINCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="City" htmlFor="city" error={fieldError('city')}>
              <input
                id="city"
                type="text"
                required
                value={form.city}
                onChange={(event) => set('city', event.target.value)}
                aria-invalid={Boolean(fieldError('city'))}
              />
            </Field>
          </div>
        </div>

        <div className="panel" style={{ marginBottom: '1.5rem' }}>
          <h2>Photos</h2>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            The first photo is used as the main image. Up to {MAX_LISTING_IMAGES} photos.
          </p>

          {uploadError ? (
            <div className="alert alert-error" role="alert">
              {uploadError}
            </div>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            aria-label="Upload listing photos"
            disabled={images.length >= MAX_LISTING_IMAGES || upload.isPending}
            onChange={(event) => handleFiles(event.target.files)}
          />

          {upload.isPending ? <p className="muted">Uploading…</p> : null}

          {images.length > 0 ? (
            <div className="image-strip">
              {images.map((image, index) => (
                <figure key={`${image.url}-${index}`}>
                  <img src={image.url} alt={image.alt ?? `Photo ${index + 1}`} />
                  <button
                    type="button"
                    className="image-remove"
                    aria-label={`Remove photo ${index + 1}`}
                    onClick={() => setImages(images.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </figure>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel">
          <h2>Description</h2>
          <Field
            label="Tell buyers about this vehicle"
            htmlFor="description"
            hint="Service history, features, and anything a buyer should know. Minimum 20 characters."
            error={fieldError('description')}
          >
            <textarea
              id="description"
              required
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              aria-invalid={Boolean(fieldError('description'))}
            />
          </Field>

          <Field label="Status" htmlFor="status" error={fieldError('status')}>
            <select
              id="status"
              value={form.status}
              onChange={(event) => set('status', event.target.value)}
            >
              {LISTING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {formatEnum(value)}
                </option>
              ))}
            </select>
          </Field>

          <div className="form-actions">
            <button type="submit" className="btn" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create listing'}
            </button>
            <Link to="/dashboard" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
