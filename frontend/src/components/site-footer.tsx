'use client';

import Link from 'next/link';
import {
  FOOTER_COLUMNS,
  SOCIAL_FOOTER_ICONS,
  type FooterLink,
  type FooterSection,
  type SiteSettings,
} from '@vintrax/shared';
import { Logo } from '@/components/logo';
import { FOOTER_GLYPHS, SocialBadge } from '@/components/footer-icons';

/** A site path goes through Next's router; anything else is a plain anchor. */
function isInternalHref(href: string): boolean {
  return href.startsWith('/');
}

/** An `https://` address leaves the site and opens in its own tab; a `mailto:` or `tel:` address hands off to another program instead, so it opens in place. */
function isExternalPage(href: string): boolean {
  return href.startsWith('https://');
}

/** A social network's link is drawn as a round badge in a row; everything else is a labelled link. */
function isSocial(link: FooterLink): boolean {
  return link.icon !== null && SOCIAL_FOOTER_ICONS.includes(link.icon);
}

function FooterAnchor({
  link,
  className,
  children,
  label,
}: {
  link: FooterLink;
  className: string;
  children: React.ReactNode;
  /** For a badge, which has no visible words. */
  label?: string;
}) {
  if (isInternalHref(link.href)) {
    return (
      <Link href={link.href} className={className} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={link.href}
      className={className}
      aria-label={label}
      // https:// leaves the site, so it opens its own tab; `noopener` keeps
      // that tab from reaching back into this one through `window.opener`.
      // mailto: and tel: hand off to another program instead of navigating,
      // so they open in place, the way a plain link would.
      {...(isExternalPage(link.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

function FooterSectionBlock({ section }: { section: FooterSection }) {
  const textLinks = section.links.filter((link) => !isSocial(link));
  const socialLinks = section.links.filter(isSocial);

  return (
    <nav aria-label={section.title}>
      {/* The body face, not the condensed display face every other heading
          uses: the reference footer's headings are plain bold text. */}
      <h2 className="font-sans text-[15px] font-bold">{section.title}</h2>
      {textLinks.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-4">
          {textLinks.map((link) => {
            const Glyph = link.icon ? FOOTER_GLYPHS[link.icon] : null;
            return (
              <li key={link.id}>
                <FooterAnchor
                  link={link}
                  className="inline-flex items-center gap-2 text-[15px] text-white/95 underline-offset-4 hover:underline"
                >
                  {link.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={link.imageUrl} alt="" className="h-5 w-5 object-contain" />
                  ) : Glyph ? (
                    <Glyph className="h-5 w-5" />
                  ) : null}
                  {link.label}
                </FooterAnchor>
              </li>
            );
          })}
        </ul>
      ) : null}
      {socialLinks.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-1.5">
          {socialLinks.map((link) => (
            <li key={link.id}>
              <FooterAnchor
                link={link}
                label={link.label}
                className="block rounded-full transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <SocialBadge icon={link.icon} imageUrl={link.imageUrl} />
              </FooterAnchor>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/**
 * The site footer, drawn after the reference design: four columns on the
 * header's black, so the page is framed top and bottom in one colour, social networks as a row of round badges in their own
 * colours, then a rule, the copyright lines and the logo.
 *
 * Everything in it is administrator-authored — sections, their column, links,
 * icons or uploaded icon images from `GET /admin/footer`, and the copyright
 * lines from the site settings — and fetched by `app/layout.tsx`, the server
 * component that renders this, so the first paint already has it.
 *
 * `sections` is `null` only when the fetch itself failed (the API was
 * unreachable), never when an administrator has genuinely emptied the
 * footer: a real empty footer renders as just the copyright bar.
 *
 * There is no language switcher here: the header's FR / EN toggle is on every
 * page already.
 */
export function SiteFooter({
  sections,
  settings,
}: {
  sections: FooterSection[] | null;
  settings: SiteSettings | null;
}) {
  const columns = Array.from({ length: FOOTER_COLUMNS }, (_, index) =>
    (sections ?? []).filter(
      (section) => Math.min(Math.max(section.column, 1), FOOTER_COLUMNS) === index + 1,
    ),
  ).filter((column) => column.length > 0);

  return (
    <footer className="bg-header text-header-foreground">
      <div className="container max-w-6xl pb-6 pt-8">
        {columns.length > 0 ? (
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {columns.map((column, index) => (
              <div key={index} className="flex flex-col gap-10">
                {column.map((section) => (
                  <FooterSectionBlock key={section.id} section={section} />
                ))}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-4 border-t border-white/25 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="text-[13px] leading-relaxed">
            <p>
              © Copyright {new Date().getFullYear()} {settings?.footerCopyright || 'Vintrax.'}
            </p>
            {settings?.footerNote ? <p>{settings.footerNote}</p> : null}
          </div>
          <Logo className="h-14" />
        </div>
      </div>
    </footer>
  );
}
