import { ApiError } from '@vintrax/client';

export interface ErrorPresentation {
  title: string;
  description: string;
  /** Whether offering a retry makes sense, or would just repeat the rejection. */
  retryable: boolean;
}

/**
 * Turns whatever a request threw into something a person can act on.
 *
 * Dealership staff should never see a status code or a stack trace, but they
 * do need to know whether to retry, sign in again, or stop. Kept separate from
 * the component that renders it so the mapping can be tested directly — it is
 * the part that is easy to get subtly wrong.
 */
export function describeError(error: unknown): ErrorPresentation {
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
          // The API's message names the missing permission, which is more
          // useful than anything this layer could invent.
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
        // A conflict means the world moved, not that the request was wrong —
        // retrying after looking at the new state is exactly right.
        return { title: 'Something changed', description: error.message, retryable: true };
      case 422:
        return { title: 'Check the details', description: error.message, retryable: false };
      case 429:
        return {
          title: 'Too many requests',
          description: 'Wait a moment and try again.',
          retryable: true,
        };
      default:
        if (error.status >= 500) {
          return {
            title: 'Vintrax is having trouble',
            description: 'The server could not complete that request.',
            retryable: true,
          };
        }
        return { title: 'That did not work', description: error.message, retryable: true };
    }
  }

  // fetch throws a TypeError when the connection fails, which is what a dead
  // spot on a dealership lot looks like from here.
  return {
    title: 'No connection',
    description: 'Check your signal and try again.',
    retryable: true,
  };
}
