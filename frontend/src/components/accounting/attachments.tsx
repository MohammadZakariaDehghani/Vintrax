'use client';

import { useRef, useState } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import { Button, ErrorAlert } from '@/components/ui';
import { acct, isoDate } from '@/lib/accounting';
import { useAccounting } from './context';
import { useAcctMutation, useAcctQuery } from './ui';

interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Receipts, auction invoices and statements on a record. Files are private:
 * they download through the API, only for this dealership.
 */
export function Attachments({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { can } = useAccounting();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<unknown>(null);
  const list = useAcctQuery<Attachment[]>(
    ['attachments', entityType, entityId],
    `/attachments/${entityType}/${entityId}`,
  );
  const upload = useAcctMutation((file: File) =>
    acct.upload(`/attachments/${entityType}/${entityId}`, file),
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4" aria-hidden /> Attachments
        </h3>
        {can('accounting.create') ? (
          <>
            <input
              ref={input}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) upload.mutate(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden /> Attach a file
            </Button>
          </>
        ) : null}
      </div>
      <ErrorAlert error={upload.error ?? list.error ?? error} className="mb-2" />
      {list.data && list.data.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {list.data.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <button
                type="button"
                className="min-w-0 truncate text-left text-primary hover:underline"
                onClick={() => {
                  setError(null);
                  acct.save(`/attachments/${file.id}`, file.fileName).catch(setError);
                }}
              >
                {file.fileName}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {isoDate(file.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No files attached. PDF, JPEG or PNG.</p>
      )}
    </div>
  );
}
