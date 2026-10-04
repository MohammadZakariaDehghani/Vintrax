'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, ErrorAlert, Spinner } from '@/components/ui';
import { PageHeader, useAcctQuery } from '@/components/accounting/ui';
import { useQueryClient } from '@tanstack/react-query';

interface Finding {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  count: number;
  links: Array<{ label: string; href: string }>;
}

interface Health {
  checkedAt: string;
  healthy: boolean;
  errors: number;
  warnings: number;
  findings: Finding[];
}

const ICON = { ERROR: XCircle, WARNING: AlertTriangle, INFO: Info } as const;
const TONE = { ERROR: 'text-destructive', WARNING: 'text-warning', INFO: 'text-primary' } as const;

export default function HealthPage() {
  const client = useQueryClient();
  const { data, error, isPending, isFetching } = useAcctQuery<Health>(['health'], '/health');
  return (
    <>
      <PageHeader
        title="Accounting health"
        description="Checks the books for anything an accountant would want to look at: unbalanced or orphaned entries, ledgers that do not match their documents, unreconciled bank activity, duplicates and old drafts."
        actions={
          <Button
            variant="outline"
            loading={isFetching}
            onClick={() => void client.invalidateQueries({ queryKey: ['acct'] })}
          >
            Run again
          </Button>
        }
      />
      <ErrorAlert error={error} />
      {isPending && !data ? <Spinner label="Checking the books" /> : null}
      {data ? (
        <>
          <Card
            className={`mb-6 ${data.healthy ? 'border-success' : data.errors ? 'border-destructive' : 'border-warning'}`}
          >
            <CardContent className="flex items-center gap-3 pt-5">
              {data.healthy ? (
                <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
              )}
              <div>
                <p className="font-semibold">
                  {data.healthy
                    ? 'No problems found'
                    : `${data.errors} errors · ${data.warnings} warnings`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Checked {new Date(data.checkedAt).toLocaleString('en-CA')}
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="space-y-3">
            {data.findings.map((finding) => {
              const Icon = ICON[finding.severity];
              return (
                <Card key={finding.code}>
                  <CardContent className="flex gap-3 pt-5">
                    <Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[finding.severity]}`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {finding.title}{' '}
                        <Badge variant="outline" className="ml-1">
                          {finding.count}
                        </Badge>
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
                      {finding.links.length ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {finding.links.map((link, index) => (
                            <Link
                              key={`${link.href}-${index}`}
                              href={link.href}
                              className="text-primary hover:underline"
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
