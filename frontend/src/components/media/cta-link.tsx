import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';

/**
 * A call-to-action link: a page on Vintrax goes through Next's router, a
 * website opens in its own tab — with `noopener` so it cannot reach back
 * into this one. Content links are validated on save to be one or the other.
 */
export function CtaLink({
  href,
  className,
  children,
  icon = true,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  icon?: boolean;
}) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={className}>
        {children}
        {icon ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      {icon ? <ExternalLink className="h-4 w-4" aria-hidden /> : null}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
