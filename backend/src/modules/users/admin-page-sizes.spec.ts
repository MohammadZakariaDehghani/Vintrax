import { MAX_PAGE_SIZE } from '@vintrax/shared';
import { listUsersQuerySchema } from './users.controller';
import { pendingReviewQuerySchema } from '../vehicles/vehicles.controller';

/**
 * The admin lists offer 10, 20, 50 and 100 per page. Moderation and Users
 * capped the page at 60, so choosing 100 answered "Validation failed" — and
 * the choice is remembered, so the page stayed broken on every visit.
 */
describe('admin list page sizes', () => {
  it.each([10, 20, 50, MAX_PAGE_SIZE])('the moderation queue accepts %i per page', (pageSize) => {
    expect(pendingReviewQuerySchema.parse({ pageSize: String(pageSize) }).pageSize).toBe(pageSize);
  });

  it.each([10, 20, 50, MAX_PAGE_SIZE])('the users list accepts %i per page', (pageSize) => {
    expect(listUsersQuerySchema.parse({ pageSize: String(pageSize) }).pageSize).toBe(pageSize);
  });

  it('still refuses more than the server-wide cap', () => {
    expect(() => pendingReviewQuerySchema.parse({ pageSize: '101' })).toThrow();
    expect(() => listUsersQuerySchema.parse({ pageSize: '101' })).toThrow();
  });
});
