import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';

/**
 * A metric. Give it an `href` when the number is something to act on rather
 * than only to read — a count of things waiting for you is a dead end without
 * one.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  href?: string;
}) {
  const tile = (
    <Card className={href ? 'h-full transition-colors hover:border-primary/40' : undefined}>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="tabular mt-1 text-2xl font-bold">{value}</p>
            {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          {Icon ? (
            <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return tile;

  return (
    <Link
      href={href}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {tile}
    </Link>
  );
}
