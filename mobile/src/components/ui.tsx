'use client';

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * The mobile UI kit.
 *
 * Every interactive element here is at least 44px tall, which is the floor
 * below which thumbs start missing. That constraint is the main reason this is
 * a separate kit from the web application's rather than a shared one — the web
 * components are sized for a cursor.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type ButtonSize = 'default' | 'large' | 'compact';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground active:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground active:bg-secondary/80',
  outline: 'border border-input bg-transparent active:bg-secondary',
  ghost: 'bg-transparent text-foreground active:bg-secondary',
  destructive: 'bg-destructive text-destructive-foreground active:bg-destructive/90',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  compact: 'min-h-touch px-3 text-sm',
  default: 'min-h-touch px-4 text-base',
  large: 'min-h-[3.25rem] px-5 text-base',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'default',
    loading,
    fullWidth,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button stays in the tab order and keeps its label, so a
      // screen reader is not left on a button that vanished.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
});

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-border bg-card text-card-foreground', className)}
      {...props}
    >
      {children}
    </div>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id, className, ...props },
  ref,
) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          'min-h-touch w-full rounded-lg border bg-background px-3 py-2.5 text-base',
          'placeholder:text-muted-foreground',
          error ? 'border-destructive' : 'border-input',
          className,
        )}
        {...props}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'destructive' | 'primary';
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-secondary text-secondary-foreground',
    success: 'bg-success text-success-foreground',
    warning: 'bg-warning text-warning-foreground',
    destructive: 'bg-destructive text-destructive-foreground',
    primary: 'bg-primary text-primary-foreground',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Skeleton block for a list that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative overflow-hidden rounded-lg bg-muted', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-background/60 to-transparent" />
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-8 text-muted-foreground"
    >
      <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * The empty, error and unauthorised states every list needs. Having one
 * component for them is what stops a screen from silently rendering nothing
 * when a request fails.
 */
export function StateMessage({
  title,
  description,
  action,
  tone = 'neutral',
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className="flex flex-col items-center gap-2 px-6 py-12 text-center"
    >
      <p className={cn('text-base font-semibold', tone === 'error' && 'text-destructive')}>
        {title}
      </p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
