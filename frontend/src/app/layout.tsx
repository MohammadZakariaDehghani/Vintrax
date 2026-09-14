import type { Metadata, Viewport } from 'next';
import { Inter, Oswald } from 'next/font/google';
import { Providers } from './providers';
import { getServerLocale } from '@/i18n/server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
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
  title: {
    default: 'Vintrax — Canadian vehicle marketplace and auctions',
    template: '%s · Vintrax',
  },
  description:
    'Buy and sell vehicles across Canada. Dealer inventory, private listings, live auctions and independent inspection reports.',
  keywords: ['vehicle marketplace', 'car auction', 'dealer inventory', 'Canada', 'used cars'],
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
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
