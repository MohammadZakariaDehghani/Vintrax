import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import { TabBar } from '@/components/tab-bar';
import { OfflineBanner } from '@/components/connectivity';
import { ServiceWorkerRegistration } from '@/components/service-worker';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Vintrax Mobile',
    template: '%s · Vintrax',
  },
  description: 'Browse inventory, bid in live auctions and manage listings from your phone.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Vintrax Mobile',
  appleWebApp: {
    capable: true,
    title: 'Vintrax',
    // Translucent lets the page background show through the status bar, which
    // is why the layout pads for the safe-area inset itself.
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon.svg',
  },
  formatDetection: {
    // iOS otherwise linkifies VINs and stock numbers as phone numbers.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom stays available: disabling it fails WCAG 1.4.4, and a used-car
  // photo is exactly the thing someone will want to zoom into.
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <OfflineBanner />
          <main
            id="main"
            className="mx-auto min-h-screen max-w-lg"
            // Clears the fixed tab bar and, under it, the home indicator.
            style={{ paddingBottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {children}
          </main>
          <TabBar />
          <ServiceWorkerRegistration />
        </Providers>
      </body>
    </html>
  );
}
