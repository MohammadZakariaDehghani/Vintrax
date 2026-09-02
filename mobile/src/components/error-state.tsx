'use client';

import { describeError } from '@/lib/errors';
import { Button, StateMessage } from '@/components/ui';

/** Renders whatever a query threw, using the shared error mapping. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, description, retryable } = describeError(error);

  return (
    <StateMessage
      tone="error"
      title={title}
      description={description}
      action={
        retryable && onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null
      }
    />
  );
}
