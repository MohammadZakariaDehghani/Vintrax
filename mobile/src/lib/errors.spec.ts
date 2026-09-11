import { describe, expect, it } from 'vitest';
import { ApiError } from '@vintrax/client';
import { describeError } from './errors';

/**
 * How the app reacts to a failing request. The distinction that matters is
 * retryable versus not: offering "try again" on a 403 sends staff into a loop
 * that can never succeed.
 */
describe('describeError', () => {
  it('treats an expired session as final, not retryable', () => {
    const result = describeError(new ApiError(401, 'Unauthorized'));
    expect(result.retryable).toBe(false);
    expect(result.title).toMatch(/sign in/i);
  });

  it('does not offer a retry on a permission failure', () => {
    // Retrying a 403 repeats the same rejection forever.
    expect(describeError(new ApiError(403, 'Missing permission vehicle:write')).retryable).toBe(
      false,
    );
  });

  it("passes the API's own message through for 403, which names the permission", () => {
    const result = describeError(new ApiError(403, 'Missing permission vehicle:write'));
    expect(result.description).toBe('Missing permission vehicle:write');
  });

  it('offers a retry on a bid conflict, because the state moved rather than the request being wrong', () => {
    const result = describeError(new ApiError(409, 'Another bid landed at the same moment.'));
    expect(result.retryable).toBe(true);
    expect(result.description).toMatch(/another bid/i);
  });

  it('offers a retry after rate limiting', () => {
    expect(describeError(new ApiError(429, 'Too many requests')).retryable).toBe(true);
  });

  it('treats a server error as retryable without exposing the status', () => {
    const result = describeError(new ApiError(500, 'Internal server error: connection reset'));
    expect(result.retryable).toBe(true);
    expect(result.title).not.toMatch(/500/);
    expect(result.description).not.toMatch(/connection reset/);
  });

  it('reports a missing record as gone rather than broken', () => {
    const result = describeError(new ApiError(404, 'Not found'));
    expect(result.retryable).toBe(false);
    expect(result.description).toMatch(/removed or sold/i);
  });

  it('reads a thrown TypeError as a dropped connection', () => {
    // This is what fetch throws in a dead spot, and it is the most common
    // failure on a phone.
    const result = describeError(new TypeError('Failed to fetch'));
    expect(result.title).toMatch(/no connection/i);
    expect(result.retryable).toBe(true);
  });

  it('handles something that is not an Error at all', () => {
    expect(() => describeError('kaboom')).not.toThrow();
    expect(describeError(undefined).retryable).toBe(true);
  });
});
