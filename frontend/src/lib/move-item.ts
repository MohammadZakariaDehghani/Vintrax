/**
 * A copy of `items` with the entry at `from` taken out and put back at `to`,
 * everything between shifting one place to close the gap — the way a dragged
 * photo moves along a row. An index out of range returns the list unchanged
 * rather than inventing or dropping an entry.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length ||
    !Number.isInteger(from) ||
    !Number.isInteger(to)
  ) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}
