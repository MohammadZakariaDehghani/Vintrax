import type { Metadata, Viewport } from 'next';
import { Inter, Oswald } from 'next/font/google';
import type { FooterSection, SiteSettings } from '@vintrax/shared';
import { Providers } from './providers';
import { getServerLocale } from '@/i18n/server';
import { serverFetch } from '@/lib/api-client';
import { siteUrl } from '@/lib/site-url';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { CompareBar } from '@/components/compare-bar';
import { CompareToast } from '@/components/compare-toast';
import { SiteChat } from '@/components/site-chat';
import './globals.css';

/**
 * Two faces, matching the supplied design.
 *
 * `Oswald` is the condensed grotesque the headings and the large figures are
 * set in — it is what gives a price, a countdown and a heading their stance.
 * `Inter` carries everything else, because a condensed face at 14px in a table
 * of options is slower to read, and this interface is mostly small text.
 *
 * Self-hosted through next/font rather than a <link> to Google: the files are
 * emitted into the bundle, so there is no third-party request at runtime, no
 * layout shift while a webfont arrives, and no cross-origin dependency for a
 * page that must render.
 *
 * `display: 'swap'` deliberately. A price rendered late in a fallback face is
 * better than a price that is invisible for three seconds.
 */
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const display = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  // Resolves relative canonical and Open Graph URLs against the public origin.
  metadataBase: new URL(siteUrl()),
  title: {
    default: 'Vintrax — Canadian vehicle marketplace and auctions',
    template: '%s · Vintrax',
  },
  description:
    'Buy and sell vehicles across Canada. Dealer inventory, private listings, live auctions and independent inspection reports.',
  keywords: ['vehicle marketplace', 'car auction', 'dealer inventory', 'Canada', 'used cars'],
  openGraph: { type: 'website', siteName: 'Vintrax', locale: 'en_CA' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#100d0d' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendering the right `lang` on the server matters for screen readers and for
  // the browser's own translation prompt, which both read it before hydration.
  const locale = await getServerLocale();
  // Fetched here, on every page, because the footer renders on every page —
  // the same reasoning `serverFetch` documents for the home page's inventory.
  // `null` on failure rather than `[]`, so `SiteFooter` can tell an API
  // hiccup apart from an administrator who genuinely emptied the footer.
  const [footer, siteSettings] = await Promise.all([
    serverFetch<FooterSection[]>('/admin/footer'),
    serverFetch<SiteSettings>('/admin/site-settings/public'),
  ]);

  return (
    <html lang={locale} suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers initialLocale={locale}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter sections={footer} settings={siteSettings} />
          </div>
          {/* One fixed-to-the-viewport stack rather than two independently
              `fixed` elements: a visitor who has already started comparing
              vehicles before answering the cookie prompt would otherwise see
              them overlap at the same edge of the screen. */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col">
            {/* The chat launcher sits above the bars rather than over them.
                The stack spans the viewport's width, so only what is drawn
                in it takes clicks; the empty space beside the launcher
                does not cover the page. */}
            <SiteChat />
            <div className="pointer-events-auto">
              <CompareBar />
              <CookieConsentBanner />
            </div>
          </div>
          <CompareToast />
        </Providers>
      </body>
    </html>
  );
}
