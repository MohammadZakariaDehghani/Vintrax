'use client';

import { ApiError } from '@/lib/api-client';
import { Button, StateMessage } from '@/components/ui';

/**
 * Turns whatever a query threw into something a person can act on.
 *
 * Dealership staff should never see a status code or a stack trace, but they
 * do need to know whether to retry, sign in again, or stop.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, description, retryable } = describe(error);

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

function describe(error: unknown): { title: string; description: string; retryable: boolean } {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return {
          title: 'Please sign in again',
          description: 'Your session has ended.',
          retryable: false,
        };
      case 403:
        return {
          title: 'Not allowed',
          description: error.message,
          retryable: false,
        };
      case 404:
        return {
          title: 'Not found',
          description: 'This may have been removed or sold.',
          retryable: false,
        };
      case 409:
        return { title: 'Something changed', description: error.message, retryable: true };
      case 429:
        return {
          title: 'Too many requests',
          description: 'Wait a moment and try again.',
          retryable: true,
        };
      default:
        return error.status >= 500
          ? {
              title: 'Atlas is having trouble',
              description: 'The server could not complete that request.',
              retryable: true,
            }
          : { title: 'That did not work', description: error.message, retryable: true };
    }
  }

  // A thrown TypeError from fetch is what a dropped connection looks like.
  return {
    title: 'No connection',
    description: 'Check your signal and try again.',
    retryable: true,
  };
}
