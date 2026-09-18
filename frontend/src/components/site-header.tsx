'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import { Bell, ChevronDown, Heart, Menu, MessagesSquare, Moon, Sun, X } from 'lucide-react';
import {
  BODY_TYPES,
  BODY_TYPE_PLURAL_LABELS,
  type ArticleSummary,
  type Paginated,
} from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuthStore, useIsAdmin, useIsSeller, useUser } from '@/store/auth-store';
import { Logo } from '@/components/logo';
import { useLocale, useT } from '@/i18n/provider';
import { LOCALE_LABELS, type Locale } from '@/i18n/dictionary';
import type { Dictionary } from '@/i18n/dictionary';

/**
 * The bar across the top of every page.
 *
 * Laid out the way large marketplaces lay this out: a solid brand band, two or
 * three verbs rather than nouns — Buying, Selling, Research — each opening a
 * panel of columns, then a cluster on the right of icon shortcuts, a divider,
 * the account control, the language switch and one outlined pill for the
 * action the business most wants.
 *
 * The band is carbon rather than the red the pattern usually comes in. Red is
 * reserved (D-020), and the point of following the layout was never to
 * reproduce someone else's identity.
 *
 * Every item in every panel is a filter or a page Vintrax actually has. The
 * reference menus carry boats, RVs and snowmobiles; those would be entries
 * leading nowhere, and a menu that lies is worse than a short one.
 */

type MenuKey = 'buying' | 'selling' | 'research';

interface MenuColumn {
  heading: string;
  links: Array<{ href: string; label: string }>;
}

function buildColumns(t: Dictionary, key: MenuKey): MenuColumn[] {
  if (key === 'buying') {
    return [
      {
        heading: t.menu.cars,
        links: [
          { href: '/vehicles?condition=NEW', label: t.menu.newCars },
          { href: '/vehicles?condition=USED', label: t.menu.usedCars },
          { href: '/vehicles?condition=CERTIFIED_PRE_OWNED', label: t.menu.certified },
          { href: '/vehicles', label: t.menu.allVehicles },
        ],
      },
      {
        heading: t.menu.byBodyType,
        links: BODY_TYPES.map((bodyType) => ({
          href: `/vehicles?bodyType=${bodyType}`,
          label: BODY_TYPE_PLURAL_LABELS[bodyType],
        })),
      },
      {
        heading: t.menu.waysToBuy,
        links: [
          { href: '/auctions', label: t.menu.liveAuctions },
          { href: '/vehicles?saleChannel=FIXED_PRICE', label: t.menu.buyNow },
          { href: '/vehicles?inspectedOnly=true', label: t.menu.inspected },
          { href: '/vehicles?maxPrice=30000', label: t.menu.underThirty },
          { href: '/vehicles?fuelType=ELECTRIC', label: t.menu.electric },
        ],
      },
    ];
  }

  if (key === 'selling') {
    return [
      {
        heading: t.menu.sellYourCar,
        links: [
          { href: '/register?role=SELLER', label: t.menu.sellVehicle },
          { href: '/dealer/add-vehicle', label: t.menu.listVehicle },
          { href: '/auctions/new', label: t.menu.startAuction },
        ],
      },
      {
        heading: t.menu.forDealers,
        links: [
          { href: '/register?role=DEALER', label: t.menu.registerDealer },
          { href: '/dealer/dashboard', label: t.menu.dealerPortal },
          { href: '/dealer/inventory', label: t.menu.dealerInventory },
        ],
      },
    ];
  }

  return [
    {
      heading: t.menu.editorial,
      links: [{ href: '/blog', label: t.menu.allArticles }],
    },
    {
      heading: t.menu.popularSearches,
      links: [
        { href: '/vehicles?inspectedOnly=true', label: t.menu.inspected },
        { href: '/vehicles?fuelType=ELECTRIC', label: t.menu.electric },
        { href: '/vehicles?maxPrice=30000', label: t.menu.underThirty },
        { href: '/vehicles?bodyType=SUV', label: BODY_TYPE_PLURAL_LABELS.SUV },
        { href: '/vehicles?bodyType=TRUCK', label: BODY_TYPE_PLURAL_LABELS.TRUCK },
      ],
    },
  ];
}

/**
 * The three latest posts, shown inside the research panel.
 *
 * Fetched only once that panel has been opened. A menu nobody opens should not
 * cost a request on every page load.
 */
function LatestArticles({ enabled }: { enabled: boolean }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ['articles', 'latest'],
    queryFn: () => api.get<Paginated<ArticleSummary>>('/articles?page=1&pageSize=3'),
    enabled,
    staleTime: 5 * 60_000,
  });

  return (
    <div>
      <p className="mb-3 text-sm font-bold text-foreground">{t.menu.latest}</p>
      <ul className="space-y-2.5">
        {data?.items.length ? (
          data.items.map((article) => (
            <li key={article.id}>
              <Link
                href={`/blog/${article.slug}`}
                className="group flex gap-3 rounded-md p-1 -m-1 transition-colors hover:bg-secondary"
              >
                <span className="relative h-11 w-[68px] shrink-0 overflow-hidden rounded bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={article.heroImageUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="line-clamp-2 text-sm leading-snug text-muted-foreground group-hover:text-foreground">
                  {article.title}
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="text-sm text-muted-foreground">{t.menu.noArticles}</li>
        )}
      </ul>
    </div>
  );
}

/**
 * A single "FR" or "EN" toggle rather than a pair.
 *
 * With exactly two languages, showing both means one of them is always inert.
 * The button shows the language you would switch *to*, which is the only one
 * worth a click.
 */
function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const other: Locale = locale === 'en' ? 'fr' : 'en';

  return (
    <button
      type="button"
      lang={other}
      onClick={() => setLocale(other)}
      className={cn(
        'rounded px-2 py-1.5 text-sm font-semibold uppercase text-header-foreground/90 transition-colors hover:bg-white/10 hover:text-header-foreground',
        className,
      )}
    >
      <span className="sr-only">{LOCALE_LABELS[other]}</span>
      <span aria-hidden>{other}</span>
    </button>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useT();

  // Theme is unknown until hydration; rendering the resolved icon before then
  // would mismatch the server output.
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      aria-label={resolvedTheme === 'dark' ? t.theme.toLight : t.theme.toDark}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-header-foreground/90 transition-colors hover:bg-white/10 hover:text-header-foreground"
    >
      {mounted && resolvedTheme === 'dark' ? (
        <Sun className="h-[18px] w-[18px]" aria-hidden />
      ) : (
        <Moon className="h-[18px] w-[18px]" aria-hidden />
      )}
    </button>
  );
}

/** An icon shortcut on the bar, with an unread count when there is one. */
function IconLink({
  href,
  label,
  count,
  children,
  className,
}: {
  href: string;
  label: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={count ? `${count} · ${label}` : label}
      className={cn(
        'relative inline-flex h-9 w-9 items-center justify-center rounded-md text-header-foreground/90 transition-colors hover:bg-white/10 hover:text-header-foreground',
        className,
      )}
    >
      {children}
      {count ? (
        <span className="absolute right-0.5 top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-foreground">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useUser();
  const isSeller = useIsSeller();
  const isAdmin = useIsAdmin();
  const logout = useAuthStore((state) => state.logout);
  const t = useT();

  /**
   * Signing out always lands on the home page, and drops every cached query
   * with it. Without both, whoever signs in next on this tab could briefly
   * see the outgoing account's page (an admin screen a dealer has no
   * business on, showing a permission error) or its cached dashboard data —
   * `RequireAuth` guards the route, but only once it has re-rendered, and a
   * stale cache entry keyed the same for every user would answer before that
   * happens.
   */
  async function handleLogout() {
    await logout();
    queryClient.clear();
    router.push('/');
  }

  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [researchOpened, setResearchOpened] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLDivElement | null>(null);

  const notifications = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  const conversations = useQuery({
    queryKey: ['conversations', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/conversations/unread-count'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  // Navigating with a panel open would leave it hanging over the new page.
  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!openMenu) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenMenu(null);
    }
    function onPointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenu]);

  function toggle(key: MenuKey) {
    if (key === 'research') setResearchOpened(true);
    setOpenMenu((current) => (current === key ? null : key));
  }

  const dashboardHref = isAdmin
    ? '/admin/dashboard'
    : isSeller
      ? '/dealer/dashboard'
      : '/dashboard';
  // Signed-in sellers already have an account, so the pill takes them straight
  // to the form rather than back through registration.
  const sellHref = isSeller ? '/dealer/add-vehicle' : '/register?role=SELLER';

  const MENUS: Array<{ key: MenuKey; label: string }> = [
    { key: 'buying', label: t.menu.buying },
    { key: 'selling', label: t.menu.selling },
    { key: 'research', label: t.menu.research },
  ];

  return (
    <header className="sticky top-0 z-40">
      <div className="bg-header text-header-foreground">
        <div ref={navRef} className="container relative flex h-16 items-center gap-2">
          <Link href="/" aria-label="Vintrax" className="shrink-0">
            {/* The supplied artwork, at one size on every breakpoint: it is a
                single finished lockup, so there is no descriptor to drop on a
                narrow screen. 54px of the 64px band, which puts it at 136px
                wide — still leaving room for the menu button on a phone. Height
                only; a width here would stretch it. */}
            <Logo className="h-[54px]" />
          </Link>

          <nav
            className="relative ml-3 hidden items-stretch self-stretch md:flex"
            aria-label="Main"
          >
            {MENUS.map((menu) => {
              const open = openMenu === menu.key;
              return (
                <button
                  key={menu.key}
                  type="button"
                  aria-expanded={open}
                  aria-haspopup="true"
                  onClick={() => toggle(menu.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap px-4 text-sm font-semibold transition-colors',
                    open ? 'bg-card text-foreground' : 'text-header-foreground hover:bg-white/10',
                  )}
                >
                  {menu.label}
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </button>
              );
            })}

            {/* Hung from the bar's lower edge and anchored to the trigger row,
                not to the container, so the columns start under the word that
                opened them whatever the logo happens to be wide. */}
            {openMenu ? (
              <div className="absolute left-0 top-full w-max max-w-[min(64rem,90vw)] rounded-b-lg bg-card text-card-foreground shadow-xl ring-1 ring-border">
                <div className="grid gap-x-12 gap-y-6 p-7 grid-flow-col auto-cols-max">
                  {buildColumns(t, openMenu).map((column) => (
                    <div key={column.heading}>
                      <p className="mb-3 text-sm font-bold text-foreground">{column.heading}</p>
                      <ul className="space-y-2.5">
                        {column.links.map((link) => (
                          <li key={link.href + link.label}>
                            <Link
                              href={link.href}
                              className="block text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline"
                            >
                              {link.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {openMenu === 'research' ? (
                    <div className="w-[18rem]">
                      <LatestArticles enabled={researchOpened} />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-0.5">
            <IconLink
              href="/dashboard/favorites"
              label={t.nav.saved}
              className="hidden sm:inline-flex"
            >
              <Heart className="h-[18px] w-[18px]" aria-hidden />
            </IconLink>
            <IconLink
              href="/dashboard/notifications"
              label={t.nav.notifications}
              count={notifications.data?.unread}
              className="hidden sm:inline-flex"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
            </IconLink>
            {user ? (
              <IconLink
                href="/dashboard/messages"
                label={t.nav.messages}
                count={conversations.data?.unread}
                className="hidden sm:inline-flex"
              >
                <MessagesSquare className="h-[18px] w-[18px]" aria-hidden />
              </IconLink>
            ) : null}

            <span className="mx-2 hidden h-6 w-px bg-header-border sm:block" aria-hidden />

            {user ? (
              <>
                <Link
                  href={dashboardHref}
                  className="hidden whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-header-foreground transition-colors hover:bg-white/10 sm:inline-block"
                >
                  {t.nav.dashboard}
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="hidden whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-header-foreground/90 transition-colors hover:bg-white/10 hover:text-header-foreground sm:inline-block"
                >
                  {t.auth.signOut}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="hidden whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-header-foreground transition-colors hover:bg-white/10 sm:inline-block"
              >
                {t.menu.logInSignUp}
              </Link>
            )}

            <ThemeToggle />
            <LanguageToggle className="hidden sm:inline-flex" />

            <Link
              href={sellHref}
              className="ml-2 hidden whitespace-nowrap rounded-full border border-header-foreground/70 px-5 py-2 text-sm font-semibold text-header-foreground transition-colors hover:bg-header-foreground hover:text-header sm:inline-block"
            >
              {t.menu.sellMyCar}
            </Link>

            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-header-foreground hover:bg-white/10 md:hidden"
              aria-label={mobileOpen ? `${t.nav.close} ${t.nav.menu}` : t.nav.menu}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen ? (
        <nav
          className="max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-border bg-card px-5 py-4 md:hidden"
          aria-label="Mobile"
        >
          {MENUS.map((menu) => (
            <section key={menu.key} className="mb-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {menu.label}
              </p>
              {buildColumns(t, menu.key).map((column) => (
                <div key={column.heading} className="mb-3">
                  <p className="mb-1.5 text-sm font-semibold">{column.heading}</p>
                  <ul className="space-y-1">
                    {column.links.map((link) => (
                      <li key={link.href + link.label}>
                        <Link
                          href={link.href}
                          className="block rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {user ? (
              <>
                <Link
                  href={dashboardHref}
                  className="rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary"
                >
                  {t.nav.dashboard}
                </Link>
                {/* The icon shortcuts are hidden below `sm`, so without these
                    the pages are unreachable on a narrow screen. */}
                <Link
                  href="/dashboard/messages"
                  className="rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary"
                >
                  {t.nav.messages}
                </Link>
                <Link
                  href="/dashboard/notifications"
                  className="rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary"
                >
                  {t.nav.notifications}
                </Link>
                <Link
                  href="/dashboard/favorites"
                  className="rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary"
                >
                  {t.nav.saved}
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="rounded-md px-2 py-2 text-left text-sm font-medium hover:bg-secondary"
                >
                  {t.auth.signOut}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md px-2 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t.menu.logInSignUp}
              </Link>
            )}
            <Link
              href={sellHref}
              className="mt-1 rounded-full border border-primary px-5 py-2 text-center text-sm font-semibold text-primary"
            >
              {t.menu.sellMyCar}
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
