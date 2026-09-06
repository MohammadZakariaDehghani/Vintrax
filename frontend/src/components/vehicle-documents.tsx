'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import type { VehicleDetail } from '@atlas/shared';
import { api } from '@/lib/api-client';
import { formatEnum } from '@/lib/utils';
import { useUser } from '@/store/auth-store';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorAlert } from '@/components/ui';

/**
 * Vehicle paperwork.
 *
 * The page around this is a server component and fetches anonymously, so it
 * never receives document links at all — the API returns them only to the
 * seller, an administrator, or the buyer on a live order. This component
 * re-fetches the vehicle with the reader's own token to find out whether they
 * are one of those, and downloads through the API rather than linking to a
 * file, because the bytes need an Authorization header.
 */
export function VehicleDocuments({
  vehicleId,
  documentCount,
}: {
  vehicleId: string;
  documentCount: number;
}) {
  const user = useUser();
  const [failed, setFailed] = useState<Error | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['vehicle-documents', vehicleId],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${vehicleId}`),
    enabled: Boolean(user) && documentCount > 0,
  });

  if (documentCount === 0) return null;

  const documents = data?.documents ?? [];

  async function open(url: string, filename: string) {
    setDownloading(url);
    setFailed(null);
    try {
      const blob = await api.download(url);
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.click();
      // Revoking immediately can cancel the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (caught) {
      setFailed(caught instanceof Error ? caught : new Error('Could not open the document'));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {documentCount === 1 ? 'One document is' : `${documentCount} documents are`} attached
              to this listing. Paperwork is shared with the buyer once an order is placed.
            </span>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li key={document.id}>
                <Button
                  variant="ghost"
                  className="h-auto justify-start gap-2 px-0 text-sm text-primary hover:underline"
                  disabled={downloading === document.url}
                  onClick={() => void open(document.url, document.filename)}
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  {formatEnum(document.type)} — {document.filename}
                  {downloading === document.url ? ' (opening…)' : ''}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {failed ? <ErrorAlert error={failed} className="mt-3" /> : null}
      </CardContent>
    </Card>
  );
}
