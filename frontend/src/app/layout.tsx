import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { getServerLocale } from '@/i18n/server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import './globals.css';

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
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendering the right `lang` on the server matters for screen readers and for
  // the browser's own translation prompt, which both read it before hydration.
  const locale = await getServerLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
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
