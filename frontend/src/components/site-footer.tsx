'use client';

import Link from 'next/link';
import { Facebook, Instagram, Linkedin, Mail, Phone, Twitter, Youtube } from 'lucide-react';
import type { FooterLinkIcon, FooterSection } from '@vintrax/shared';
import { Logo } from '@/components/logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useT } from '@/i18n/provider';

/** One per `FooterLinkIcon` value — decorative, chosen by an administrator. */
const ICONS: Record<FooterLinkIcon, React.ComponentType<{ className?: string }>> = {
  FACEBOOK: Facebook,
  INSTAGRAM: Instagram,
  TWITTER: Twitter,
  YOUTUBE: Youtube,
  LINKEDIN: Linkedin,
  EMAIL: Mail,
  PHONE: Phone,
};

/** A site path goes through Next's router; anything else is a plain anchor. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/');
}

/** An `https://` address leaves the site and opens in its own tab; a `mailto:` or `tel:` address hands off to another program instead, so it opens in place. */
function isExternalPage(href: string): boolean {
  return href.startsWith('https://');
}

/**
 * The footer's content — sections, their links and any social icon — is
 * administrator-authored and fetched from `GET /admin/footer` by the server
 * component that renders this (`app/layout.tsx`), the same way the home
 * page's body-type photos are. Passed in as a prop rather than fetched here
 * because this component also needs `useT()`/`LanguageSwitcher`, which need a
 * client component, and a client-side fetch would show an empty footer for a
 * beat on every page's first paint.
 *
 * `sections` is `null` only when the fetch itself failed (the API was
 * unreachable), never when an administrator has genuinely emptied the
 * footer — those are different situations and are not conflated: a real
 * empty footer renders as just the logo and copyright bar, the way it should.
 */
export function SiteFooter({ sections }: { sections: FooterSection[] | null }) {
  const t = useT();

  return (
    <footer className="border-t border-border bg-card">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo className="h-14" />
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t.brand.tagline}</p>
          <LanguageSwitcher className="mt-4" />
        </div>

        {(sections ?? []).map((section) => (
          <nav key={section.id} aria-label={section.title}>
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {section.links.map((link) => {
                const Icon = link.icon ? ICONS[link.icon] : null;
                const content = (
                  <>
                    {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                    {link.label}
                  </>
                );
                const linkClassName =
                  'flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground';

                return (
                  <li key={link.id}>
                    {isInternalHref(link.href) ? (
                      <Link href={link.href} className={linkClassName}>
                        {content}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className={linkClassName}
                        // https:// leaves the site, so it opens its own tab;
                        // `noopener` keeps that tab from reaching back into
                        // this one through `window.opener`. mailto: and tel:
                        // hand off to another program instead of navigating,
                        // so they open in place, the way a plain link would.
                        {...(isExternalPage(link.href)
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {content}
                      </a>
                    )}
                  </li>
                );
              })}
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
