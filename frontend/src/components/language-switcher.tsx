'use client';

import { Languages } from 'lucide-react';
import { LOCALES, LOCALE_LABELS } from '@/i18n/dictionary';
import { useLocale, useT } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * English/French switch.
 *
 * A pair of buttons rather than a dropdown: there are two options, and a
 * dropdown would hide the one you want behind a click. Each option carries its
 * own `lang`, so a screen reader pronounces "Français" in French rather than
 * reading it as English.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="group"
      aria-label={t.language.change}
    >
      <Languages aria-hidden className="mr-0.5 h-4 w-4 text-muted-foreground" />
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            onClick={() => setLocale(option)}
            className={cn(
              'rounded px-1.5 py-1 text-xs font-semibold uppercase transition-colors',
              active
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="sr-only">{LOCALE_LABELS[option]}</span>
            <span aria-hidden>{option}</span>
          </button>
        );
      })}
    </div>
  );
}
