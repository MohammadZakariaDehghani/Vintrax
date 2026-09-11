'use client';

import Link from 'next/link';
import { Logo } from '@/components/logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useT } from '@/i18n/provider';

/** Section and link labels are dictionary keys, resolved at render. */
const SECTIONS = [
  {
    title: 'marketplace',
    links: [
      { href: '/vehicles', key: 'browseVehicles' },
      { href: '/auctions', key: 'liveAuctions' },
      { href: '/vehicles?saleChannel=FIXED_PRICE', key: 'buyNow' },
      { href: '/vehicles?inspectedOnly=true', key: 'inspectedVehicles' },
    ],
  },
  {
    title: 'sell',
    links: [
      { href: '/register?role=SELLER', key: 'sellYourVehicle' },
      { href: '/register?role=DEALER', key: 'dealerRegistration' },
      { href: '/dealer/dashboard', key: 'dealerPortal' },
    ],
  },
  {
    title: 'platform',
    links: [
      { href: '/dashboard', key: 'myAccount' },
      { href: '/dashboard/my-bids', key: 'myBids' },
      { href: '/dashboard/purchases', key: 'purchases' },
    ],
  },
] as const;

export function SiteFooter() {
  const t = useT();

  return (
    <footer className="border-t border-border bg-card">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo descriptor={t.brand.descriptor} />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t.brand.tagline}</p>
          <LanguageSwitcher className="mt-4" />
        </div>

        {SECTIONS.map((section) => (
          <nav key={section.title} aria-label={t.footer[section.title]}>
            <h2 className="text-sm font-semibold">{t.footer[section.title]}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t.footer[link.key]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border py-5">
        <div className="container flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
          <p>
            © {new Date().getFullYear()} Vintrax. {t.footer.demonstration}
          </p>
          <p>{t.footer.currency}</p>
        </div>
      </div>
    </footer>
  );
}
