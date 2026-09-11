import { cookies } from 'next/headers';
import { DICTIONARIES, isLocale, type Dictionary, type Locale } from '@/i18n/dictionary';

/**
 * The locale, on the server.
 *
 * It lives in a cookie rather than only in `localStorage` precisely so this
 * can exist: the home page and the listing pages are server components, and a
 * value the server cannot read would leave them in English while the header
 * around them switched to French. A half-translated page is worse than an
 * untranslated one.
 *
 * Reading a cookie opts the route out of static rendering. These pages already
 * fetch live inventory with `cache: 'no-store'`, so nothing is lost.
 */
export const LOCALE_COOKIE = 'vintrax.locale';

export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : 'en';
}

export async function getServerDictionary(): Promise<Dictionary> {
  return DICTIONARIES[await getServerLocale()];
}
