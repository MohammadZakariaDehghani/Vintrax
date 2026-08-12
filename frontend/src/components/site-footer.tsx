import Link from 'next/link';

const SECTIONS = [
  {
    title: 'Marketplace',
    links: [
      { href: '/vehicles', label: 'Browse vehicles' },
      { href: '/auctions', label: 'Live auctions' },
      { href: '/vehicles?saleChannel=FIXED_PRICE', label: 'Buy now' },
      { href: '/vehicles?inspectedOnly=true', label: 'Inspected vehicles' },
    ],
  },
  {
    title: 'Sell',
    links: [
      { href: '/register?role=SELLER', label: 'Sell your vehicle' },
      { href: '/register?role=DEALER', label: 'Dealer registration' },
      { href: '/dealer/dashboard', label: 'Dealer portal' },
    ],
  },
  {
    title: 'Platform',
    links: [
      { href: '/dashboard', label: 'My account' },
      { href: '/dashboard/my-bids', label: 'My bids' },
      { href: '/dashboard/purchases', label: 'Purchases' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-sm font-black text-primary-foreground"
              aria-hidden
            >
              A
            </span>
            Atlas
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            A Canadian vehicle marketplace connecting buyers with dealerships and private sellers,
            with live auctions and independent inspection reports.
          </p>
        </div>

        {SECTIONS.map((section) => (
          <nav key={section.title} aria-label={section.title}>
            <h2 className="text-sm font-semibold">{section.title}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border py-5">
        <div className="container flex flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Atlas. Demonstration platform.</p>
          <p>Prices in Canadian dollars.</p>
        </div>
      </div>
    </footer>
  );
}
