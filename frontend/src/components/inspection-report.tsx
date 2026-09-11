'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { InspectionDetail } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn, formatDate, formatEnum, formatKm, formatPrice } from '@/lib/utils';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';

const RATING_STYLE: Record<string, string> = {
  EXCELLENT: 'text-success',
  GOOD: 'text-foreground',
  FAIR: 'text-warning',
  POOR: 'text-destructive',
  NOT_APPLICABLE: 'text-muted-foreground',
};

export function InspectionReport({ vehicleId }: { vehicleId: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['inspection', vehicleId],
    queryFn: () => api.get<InspectionDetail | null>(`/inspections/vehicle/${vehicleId}`),
  });

  if (isPending) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-2 pt-5">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-success" aria-hidden />
            Inspection report
          </CardTitle>
          {data.overallGrade ? (
            <Badge variant="success">{formatEnum(data.overallGrade)} overall</Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent>
        {/* Structural damage is the single most material buyer signal, so it is
            stated before anything else rather than buried in the section list. */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge variant={data.hasFrameDamage ? 'destructive' : 'success'}>
            {data.hasFrameDamage ? (
              <AlertTriangle className="h-3 w-3" aria-hidden />
            ) : (
              <ShieldCheck className="h-3 w-3" aria-hidden />
            )}
            {data.hasFrameDamage ? 'Frame damage reported' : 'No frame damage'}
          </Badge>
          <Badge variant={data.hasAccidentHistory ? 'warning' : 'success'}>
            {data.hasAccidentHistory ? 'Accident history' : 'No accident history'}
          </Badge>
          {data.estimatedReconditioningCad ? (
            <Badge variant="outline">
              Reconditioning est. {formatPrice(data.estimatedReconditioningCad)}
            </Badge>
          ) : null}
        </div>

        {data.summary ? (
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{data.summary}</p>
        ) : null}

        <dl className="grid gap-3 sm:grid-cols-2">
          {data.sections.map((section) => (
            <div key={section.section} className="border-b border-border pb-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {formatEnum(section.section)}
              </dt>
              <dd className={cn('mt-0.5 text-sm font-semibold', RATING_STYLE[section.rating])}>
                {formatEnum(section.rating)}
                {section.notes ? (
                  <span className="block font-normal text-muted-foreground">{section.notes}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs text-muted-foreground">
          Inspected by {data.inspectorName}
          {data.odometerReadingKm ? ` · Odometer ${formatKm(data.odometerReadingKm)}` : ''}
          {data.completedAt ? ` · ${formatDate(data.completedAt)}` : ''}
        </p>
      </CardContent>
    </Card>
  );
}
