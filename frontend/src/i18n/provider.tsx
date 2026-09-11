'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICTIONARIES, isLocale, type Dictionary, type Locale } from '@/i18n/dictionary';

const STORAGE_KEY = 'vintrax.locale';
/** One year: a language choice is not something to ask about every week. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Language state.
 *
 * Context rather than the session store, because the choice belongs to the
 * browser rather than the account: someone who is not signed in still reads the
 * site in French.
 *
 * `initialLocale` comes from the layout, which read the cookie on the server.
 * Starting from the same value the server rendered is what keeps hydration
 * quiet — deriving it here from storage would flash English first.
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();

  // The document language drives screen-reader pronunciation and the browser's
  // own translation prompt, so it has to track the choice.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      persist(next);
      setLocaleState(next);
      // Server components rendered in the previous language; refresh so the
      // page and its chrome change together rather than in two steps.
      router.refresh();
    },
    [router],
  );

  useEffect(() => {
    // First visit with no cookie: take the choice from storage, or negotiate it
    // from the browser once. `fr-CA` and `fr` both count.
    if (document.cookie.includes(`${STORAGE_KEY}=`)) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const preferred: Locale | null =
      (isLocale(stored) && stored) ||
      (navigator.languages?.some((tag) => tag.toLowerCase().startsWith('fr')) ? 'fr' : null);
    if (preferred && preferred !== locale) setLocale(preferred);
    else persist(locale);
    // Runs once: afterwards the cookie exists and the guard above returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: DICTIONARIES[locale] }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Writes the choice where both the client and the server can find it. */
function persist(locale: Locale): void {
  document.cookie = `${STORAGE_KEY}=${locale};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A private window can refuse storage. The cookie is the one that matters.
  }
}

function useLocaleContext(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider');
  return context;
}

/** The current locale and the setter, for the language switcher. */
export function useLocale(): Omit<LocaleContextValue, 't'> {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

/** The dictionary for the current locale: `const t = useT(); t.nav.browse`. */
export function useT(): Dictionary {
  return useLocaleContext().t;
}

/**
 * Formats a number of results with the right noun for the locale. English and
 * French agree on plural rules here, but the noun differs, so this keeps the
 * choice in one place rather than at every call site.
 */
export function useCount(): (count: number, one: string, other: string) => string {
  const { locale } = useLocaleContext();
  return useCallback(
    (count, one, other) =>
      `${new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-CA').format(count)} ${
        count === 1 ? one : other
      }`,
    [locale],
  );
}
