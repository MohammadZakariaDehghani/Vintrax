/**
 * Sets the page on an existing query string.
 *
 * Appending `&page=N` instead would produce a duplicate parameter when the
 * caller's query already carries one, and the API's coercion reads a repeated
 * parameter as an array — which fails validation with "expected number,
 * received nan" and shows the user an empty list. Replacing is the only safe
 * way to page a query someone else built.
 */
export function withPage(query: string, page: number): string {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  params.set('page', String(page));
  return `?${params.toString()}`;
}
