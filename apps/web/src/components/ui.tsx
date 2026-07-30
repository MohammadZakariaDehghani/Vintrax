import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-client';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status">
      <div className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/**
 * Renders an error for the user. Field-level validation detail belongs next to
 * the inputs, so only the summary message is shown here.
 */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Something went wrong. Please try again.';

  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'accent' | 'danger';
}) {
  const toneClass = tone === 'neutral' ? '' : ` badge-${tone}`;
  return <span className={`badge${toneClass}`}>{children}</span>;
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        ← Previous
      </button>
      <span className="page-info" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next →
      </button>
    </nav>
  );
}

/** Falls back to a striped placeholder when a listing has no photos. */
export function ListingImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={`media-placeholder ${className ?? ''}`} aria-label="No photo available">
        No photo
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}
